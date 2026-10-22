"use server";

// Server actions of the staff case page (docs/domain.md §2, §3, §5). Each one is a public POST endpoint, so each
// one checks everything again: the signed-in member (no session -> /sign-in), their role, the case looked up by
// ref INSIDE their org (owners: only their assigned cases; anything else is "not found"), and the form with zod.
// Every status change goes through the frozen transition(); every other event through appendCaseEvent(); every
// tenant-table access through withOrg(). Never log form values, report text or emails.
import { refresh } from "next/cache";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { caseEvents, casePrivate, cases, orgMembers } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { getStaffOrg, type StaffOrg, type StaffRole } from "@/lib/auth/staff";
import { signedOutAnswer } from "@/lib/auth/signed-out";
import { appendCaseEvent } from "@/lib/case-events";
import { canRun, type CaseCommand } from "@/lib/cases/access";
import {
  REFUSED,
  staleMessage,
  type CaseActionResult,
  type FieldErrors,
  type HidePreviewResult,
  type RevealResult,
} from "@/lib/cases/action-result";
import { afterAssigned, ownerToldSentence, type OwnerTold } from "@/lib/cases/after-assign";
import { afterFixLogged } from "@/lib/cases/after-fix";
import { caseByRef, duplicateOriginalOf } from "@/lib/cases/duplicates";
import { CASE_REF } from "@/lib/cases/labels";
import { NOTE_KINDS, NOTE_KIND_LABELS, scrubNote } from "@/lib/cases/notes";
import { acknowledgementStep, reporterGaveEmail, retestAskSentence, type RetestAsk } from "@/lib/cases/messages";
import {
  HIDE_WORDS_MAX,
  HIDE_WORDS_MAX_ITEMS,
  PII_TYPES,
  WORDS_NOT_FOUND,
  type AddedWords,
} from "@/lib/cases/redaction-labels";
import {
  buildReview,
  cleanWords,
  containsHiddenValue,
  finalizeApproval,
  parseSpans,
  usableWords,
  wordsFound,
} from "@/lib/cases/redaction-review";
import { findStaffCase, latestEvent, type StaffCaseRow } from "@/lib/cases/staff-case";
import {
  EVIDENCE_URL_MAX,
  FIX_DESCRIPTION_MAX,
  NOTE_MAX,
  PUBLIC_SUMMARY_MAX,
  checkEvidenceUrl,
} from "@/lib/cases/triage";
import { decrypt } from "@/lib/crypto";
import { checkPastDate, instantForDate, isIsoDate, zonedDate, zonedNoon } from "@/lib/dates";
import { queueAckEmail, queueRetestReminder } from "@/lib/email/case-emails";
import { deliverEmail, type QueuedEmail, type SentEmail } from "@/lib/email/send";
import { formatDateLong } from "@/lib/format";
import { dueAtForDate, dueDateOf } from "@/lib/metrics/queue";
import { detectPatterns } from "@/lib/redaction/patterns";
import { PRIORITY_AREAS } from "@/lib/report/headings";
import {
  STOP_WAITING_DAYS,
  TransitionError,
  WORK_STARTED_EVENTS,
  closeReasonsFor,
  transition,
  workStartedFrom,
  type Action,
} from "@/lib/state-machine";
import { CLOSED_REASONS, staffStatusLabel } from "@/lib/status";

/* ------------------------------------------------------------------ plumbing */

/**
 * A calm answer decided inside the transaction (it rolls back whatever ran before it). `refreshPage`: the case
 * moved on, so the page should show where it is now. A case that is "not found" is not refreshed: the answer
 * says so, and a refresh would replace the whole page.
 */
class Refusal extends Error {
  constructor(
    readonly result: CaseActionResult,
    readonly refreshPage = false,
  ) {
    super("refused");
  }
}

const now = () => Date.now();
const fail = (message: string, fieldErrors?: FieldErrors): CaseActionResult => ({ ok: false, message, fieldErrors, at: now() });

/** The roles that can ever run a step, whatever the case (an auditor runs nothing). */
function roleMayEver(cmd: CaseCommand, role: StaffRole): boolean {
  if (role === "lead") return true;
  return role === "owner" && (cmd === "log_fix" || cmd === "note");
}

/** The signed-in member, or null: the action then answers signedOutAnswer() (the form keeps what was typed). */
async function signedIn(): Promise<StaffOrg | null> {
  return getStaffOrg();
}

const field = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

const RefSchema = z.string().regex(/^BAR-\d{4,6}$/);

function logFailure(what: string, err: unknown) {
  console.error(`[case] ${what} (${err instanceof Error ? err.name : "UnknownError"})`);
}

/**
 * Run one step on a case: role check, then the case locked inside the member's org, then the step's own check
 * (lib/cases/access.ts canRun), then `work`. Refusals and TransitionErrors become calm answers; a step that
 * no longer applies refreshes the page so it shows where the case is now.
 */
async function onCase(
  staff: StaffOrg,
  ref: string,
  cmd: CaseCommand,
  work: (tx: Tx, c: StaffCaseRow) => Promise<CaseActionResult>,
): Promise<CaseActionResult> {
  if (!roleMayEver(cmd, staff.role)) return fail(REFUSED.role);
  if (!RefSchema.safeParse(ref).success) return fail(REFUSED.notFound);
  try {
    const result = await withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
      const c = await findStaffCase(tx, staff, ref, { forUpdate: true });
      if (!c) throw new Refusal(fail(REFUSED.notFound));
      const facts = { status: c.status, assignedTo: c.assignedTo, redactionApproved: c.redactionApprovedAt !== null };
      if (!canRun(cmd, staff, facts)) throw new Refusal(fail(staleMessage(staffStatusLabel(c.status))), true);
      return work(tx, c);
    });
    if (result.ok) refresh();
    return result;
  } catch (err) {
    if (err instanceof Refusal) {
      if (err.refreshPage) refresh();
      return err.result;
    }
    if (err instanceof TransitionError) {
      refresh();
      return fail(staleMessage(await currentStatusLabel(staff, ref)));
    }
    logFailure(`could not ${cmd.replace("_", " ")}`, err);
    return fail(REFUSED.failed);
  }
}

async function currentStatusLabel(staff: StaffOrg, ref: string): Promise<string> {
  try {
    const c = await withOrg({ orgId: staff.orgId, role: staff.role }, (tx) => findStaffCase(tx, staff, ref));
    return c ? staffStatusLabel(c.status) : "unknown";
  } catch {
    return "unknown";
  }
}

const staffActor = (staff: StaffOrg) => ({ kind: "staff" as const, memberId: staff.memberId, role: staff.role });

async function move(tx: Tx, staff: StaffOrg, c: StaffCaseRow, action: Action) {
  return transition(tx, staff.orgId, c.id, action, staffActor(staff));
}

/** The original report text (lead only: case_private's RLS needs app.role = 'lead'). */
async function originalOf(tx: Tx, c: StaffCaseRow) {
  const [p] = await tx.select().from(casePrivate).where(and(eq(casePrivate.orgId, c.orgId), eq(casePrivate.caseId, c.id))).limit(1);
  if (!p) throw new Error("case_private row missing");
  return p;
}

const othersOf = (c: StaffCaseRow) => ({ summary: c.summary, aiSummary: c.aiSummary, locationDetail: c.locationDetail });

/**
 * Lead only (case_private): a check for staff text that would bring back a value the redaction hides (the
 * approved spans; before an approval, the proposed ones). Public summaries, close notes, reopen reasons and a
 * lead's fix description all land in the append-only log, which owners and auditors read (domain §2: redacted
 * text only), and the public summary in public reports (domain §7).
 */
async function hiddenValueCheck(tx: Tx, c: StaffCaseRow): Promise<(text: string) => boolean> {
  const raw = decrypt((await originalOf(tx, c)).rawTextEnc);
  const decided =
    (await latestEvent(tx, c.orgId, c.id, "redaction_approved")) ?? (await latestEvent(tx, c.orgId, c.id, "redaction_proposed"));
  const spans = parseSpans(decided?.payload.spans, raw.length);
  return (text) => text.length > 0 && containsHiddenValue(text, raw, spans);
}

/** Refuse the step with a field error when `text` brings back a hidden value (see hiddenValueCheck). */
async function refuseHiddenValue(tx: Tx, c: StaffCaseRow, fieldName: string, what: string, text: string) {
  const hides = await hiddenValueCheck(tx, c);
  if (hides(text)) {
    const msg = `${what} includes a detail that is hidden in the report. Take it out.`;
    throw new Refusal(fail(msg, { [fieldName]: msg }));
  }
}

const AddedSchema = z
  .array(z.object({ text: z.string().min(1).max(HIDE_WORDS_MAX), type: z.enum(PII_TYPES) }))
  .max(HIDE_WORDS_MAX_ITEMS);

function parseAdded(raw: string): AddedWords[] | null {
  if (!raw) return [];
  try {
    const parsed = AddedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ redaction review (layer 3) */

const ALREADY_HIDDEN = "These words are already hidden everywhere they appear. Nothing new to hide.";

/** Every span of `base` kept: the approval a revision starts from (a revision only ever hides more). */
const keepAll = (base: unknown[]) => base.map((_, i) => i);

/** Would hiding `added` on top of the `base` spans change any text staff read (the report, a summary, the place)? */
function hidesMore(raw: string, base: ReturnType<typeof parseSpans>, added: AddedWords[], c: StaffCaseRow): boolean {
  const before = finalizeApproval(raw, base, keepAll(base), [], othersOf(c));
  const after = finalizeApproval(raw, base, keepAll(base), added, othersOf(c));
  if ("problem" in before || "problem" in after) return false;
  return (
    after.redactedText !== before.redactedText ||
    after.summary !== before.summary ||
    after.aiSummary !== before.aiSummary ||
    after.locationDetail !== before.locationDetail
  );
}

/** "Hide these words": map the exact words onto the original and preview the review. Saves nothing. */
export async function previewHiddenWords(form: FormData): Promise<HidePreviewResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const at = now();
  if (staff.role !== "lead") return { ok: false, message: REFUSED.role, at };
  const ref = field(form, "ref");
  const words = cleanWords(field(form, "words"));
  const type = z.enum(PII_TYPES).safeParse(field(form, "type"));
  const added = parseAdded(field(form, "added"));
  // "revise": after the approval, hide a detail it missed (reviseRedaction saves it); otherwise the review itself.
  const revise = field(form, "mode") === "revise";
  if (!RefSchema.safeParse(ref).success || added === null) return { ok: false, message: REFUSED.invalid, at };

  const errors: FieldErrors = {};
  if (!words) errors.words = "Type the exact words to hide.";
  else if (words.length > HIDE_WORDS_MAX) errors.words = `Keep the words to hide under ${HIDE_WORDS_MAX} characters.`;
  else if (!usableWords(words)) errors.words = "Type at least 2 characters, without [ or ].";
  else if (added.some((a) => cleanWords(a.text) === words)) errors.words = "You already added these words.";
  else if (added.length >= HIDE_WORDS_MAX_ITEMS) errors.words = `You can add up to ${HIDE_WORDS_MAX_ITEMS} sets of words.`;
  if (!type.success) errors.type = "Choose what kind of detail it is.";
  if (Object.keys(errors).length || !type.success) return { ok: false, message: Object.values(errors)[0], fieldErrors: errors, at };
  const kind = type.data;

  try {
    return await withOrg({ orgId: staff.orgId, role: "lead" }, async (tx) => {
      const c = await findStaffCase(tx, staff, ref);
      if (!c) return { ok: false as const, message: REFUSED.notFound, at };
      if ((c.redactionApprovedAt !== null) !== revise) return { ok: false as const, message: staleMessage(staffStatusLabel(c.status)), at };
      const raw = decrypt((await originalOf(tx, c)).rawTextEnc);
      const next: AddedWords = { text: words, type: kind };
      if (!wordsFound(raw, next, othersOf(c))) {
        return { ok: false as const, message: WORDS_NOT_FOUND, fieldErrors: { words: WORDS_NOT_FOUND }, at };
      }
      // The review starts from the proposal; a revision from what was approved last (every detail it hides stays hidden).
      const base = await latestEvent(tx, c.orgId, c.id, revise ? "redaction_approved" : "redaction_proposed");
      const proposed = parseSpans(base?.payload.spans, raw.length);
      if (revise && !hidesMore(raw, proposed, [next], c)) {
        return { ok: false as const, message: ALREADY_HIDDEN, fieldErrors: { words: ALREADY_HIDDEN }, at };
      }
      const all = [...added, next];
      const review = buildReview(raw, proposed, all, othersOf(c));
      const item = review.items[review.items.length - 1];
      const where = item.inReport ? "" : " It is not in the report itself, only in the summary or the place detail.";
      const saved = revise ? "It is saved when you save the corrected redaction." : "It is saved when you approve the redaction.";
      return {
        ok: true as const,
        review,
        added: all,
        message: `Hidden in ${item.places === 1 ? "1 place" : `${item.places} places`}.${where} ${saved}`,
        at,
      };
    });
  } catch (err) {
    logFailure("could not preview hidden words", err);
    return { ok: false, message: REFUSED.failed, at };
  }
}

/** "Approve redaction": recompute the final spans from the stored proposal and the lead's words; save them. */
export async function approveRedaction(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const keep = form.getAll("keep").map((k) => (typeof k === "string" && /^\d{1,5}$/.test(k) ? Number(k) : -1));
  const added = parseAdded(field(form, "added"));
  const proposalSeq = Number(field(form, "proposalSeq"));
  if (added === null || !Number.isInteger(proposalSeq)) return fail(REFUSED.invalid);

  return onCase(staff, ref, "review", async (tx, c) => {
    const [already] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(caseEvents)
      .where(and(eq(caseEvents.caseId, c.id), eq(caseEvents.type, "redaction_approved")));
    if ((already?.n ?? 0) > 0) throw new Refusal(fail(staleMessage(staffStatusLabel(c.status))), true);

    const raw = decrypt((await originalOf(tx, c)).rawTextEnc);
    const proposal = await latestEvent(tx, c.orgId, c.id, "redaction_proposed");
    if ((proposal?.seq ?? 0) !== proposalSeq) throw new Refusal(fail(REFUSED.invalid));
    const proposed = parseSpans(proposal?.payload.spans, raw.length);

    const approval = finalizeApproval(raw, proposed, keep, added, othersOf(c));
    if ("problem" in approval) {
      throw new Refusal(
        fail(approval.problem === "bad_index" ? REFUSED.invalid : "Some words you added are no longer in the report. Untick them, then approve again."),
      );
    }

    const approvedAt = new Date();
    await tx
      .update(cases)
      .set({
        redactedText: approval.redactedText,
        summary: approval.summary,
        aiSummary: approval.aiSummary,
        locationDetail: approval.locationDetail,
        redactionApprovedAt: approvedAt,
        needsManualRedaction: false,
        updatedAt: approvedAt,
      })
      .where(and(eq(cases.orgId, c.orgId), eq(cases.id, c.id)));
    await appendCaseEvent(tx, {
      orgId: c.orgId,
      caseId: c.id,
      type: "redaction_approved",
      actorKind: "staff",
      actorId: staff.memberId,
      createdAt: approvedAt,
      payload: {
        spans: approval.spans.map(({ start, end, type, source }) => ({ start, end, type, source })),
        ...approval.counts,
      },
    });
    const n = approval.spans.length;
    const hidden = n === 1 ? "1 detail stays hidden" : `${n} details stay hidden`;
    return {
      ok: true,
      message: `Redaction approved. ${hidden}.${c.status === "new" ? " Next: triage the case." : ""}`,
      at: now(),
    };
  });
}

/** The words as whole words, in any letter case and spacing (the containsHiddenValue rule), anywhere in `text`. */
function mentionsAny(text: string, words: AddedWords[]): boolean {
  return words.some((w) => {
    const parts = cleanWords(w.text).split(/\s+/).filter(Boolean);
    if (parts.join(" ").length < 2) return false;
    const pattern = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(text);
  });
}

/**
 * "Save the corrected redaction" (lead only, after the approval; Phase 7 T2): hide a detail the approved redaction
 * missed. Every detail the last approval hides stays hidden (a revision can only hide more); the lead's exact words
 * are added; the report, the summaries and the place detail are redacted again from the original; and a NEW
 * `redaction_approved` event records the corrected spans (`revision: true`). Earlier events are never edited (the
 * log is append-only): the answer says when the words also appear in the public summary or in earlier records.
 */
export async function reviseRedaction(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const added = parseAdded(field(form, "added"));
  const approvalSeq = Number(field(form, "approvalSeq"));
  if (added === null || !Number.isInteger(approvalSeq)) return fail(REFUSED.invalid);
  if (!added.length) return fail("Nothing was saved: hide the words first, with \"Hide these words\".");

  return onCase(staff, ref, "revise_redaction", async (tx, c) => {
    const raw = decrypt((await originalOf(tx, c)).rawTextEnc);
    const last = await latestEvent(tx, c.orgId, c.id, "redaction_approved");
    if (!last) throw new Refusal(fail(staleMessage(staffStatusLabel(c.status))), true);
    if (last.seq !== approvalSeq) {
      throw new Refusal(fail("Nothing was saved: the redaction was changed after this page was opened. The page now shows it."), true);
    }
    const base = parseSpans(last.payload.spans, raw.length);
    const approval = finalizeApproval(raw, base, keepAll(base), added, othersOf(c));
    if ("problem" in approval) {
      throw new Refusal(fail(approval.problem === "bad_index" ? REFUSED.invalid : "Some words you added are no longer in the report. Start again."));
    }
    if (!hidesMore(raw, base, added, c)) throw new Refusal(fail(`Nothing was saved: ${ALREADY_HIDDEN}`));

    const at = new Date();
    await tx
      .update(cases)
      .set({
        redactedText: approval.redactedText,
        summary: approval.summary,
        aiSummary: approval.aiSummary,
        locationDetail: approval.locationDetail,
        updatedAt: at,
      })
      .where(and(eq(cases.orgId, c.orgId), eq(cases.id, c.id)));
    const earlier = (await eventsOf(tx, c)).filter((e) => mentionsAny(JSON.stringify(e.payload ?? {}), added)).length;
    await appendCaseEvent(tx, {
      orgId: c.orgId,
      caseId: c.id,
      type: "redaction_approved",
      actorKind: "staff",
      actorId: staff.memberId,
      createdAt: at,
      payload: {
        spans: approval.spans.map(({ start, end, type, source }) => ({ start, end, type, source })),
        kept: base.length,
        removed: 0,
        added: added.length,
        revision: true,
      },
    });
    const n = approval.spans.length;
    const parts = [`Redaction corrected: ${n === 1 ? "1 detail is" : `${n} details are`} hidden now.`];
    if (c.publicSummary && mentionsAny(c.publicSummary, added)) {
      parts.push(
        c.status === "triaged" || c.status === "assigned"
          ? "The words are also in the public summary: use \"Correct the triage\" to take them out."
          : "The words are also in the public summary, which can no longer be corrected for this case.",
      );
    }
    if (earlier > 0) {
      parts.push(
        `They also appear in ${earlier === 1 ? "1 earlier record" : `${earlier} earlier records`} of the history, which can't be changed: the history is append-only.`,
      );
    }
    return { ok: true, message: parts.join(" "), at: now() };
  });
}

/** "Show original" (lead only): log the view, then hand the decrypted text to this browser only. */
export async function revealOriginal(form: FormData): Promise<RevealResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const at = now();
  const ref = field(form, "ref");
  if (staff.role !== "lead") return { ok: false, message: REFUSED.role, at };
  if (!RefSchema.safeParse(ref).success) return { ok: false, message: REFUSED.notFound, at };
  try {
    const shown = await withOrg({ orgId: staff.orgId, role: "lead" }, async (tx) => {
      const c = await findStaffCase(tx, staff, ref);
      if (!c) return null;
      const p = await originalOf(tx, c);
      const text = decrypt(p.rawTextEnc);
      const email = p.reporterEmailEnc ? decrypt(p.reporterEmailEnc) : null;
      const contact = p.reporterContactEnc ? decrypt(p.reporterContactEnc) : null;
      // The view is in the evidence chain before anyone sees the text (domain §5: "Reveal ... is logged").
      await appendCaseEvent(tx, {
        orgId: c.orgId,
        caseId: c.id,
        type: "private_revealed",
        actorKind: "staff",
        actorId: staff.memberId,
        payload: { shown: ["text", ...(email ? ["email"] : []), ...(contact ? ["contact"] : [])] },
      });
      return { text, email, contact };
    });
    if (!shown) return { ok: false, message: REFUSED.notFound, at };
    refresh(); // the History now shows "Original viewed by ..."
    return { ok: true, ...shown, message: "The original report is shown below. Your view is recorded in the history.", at };
  } catch (err) {
    logFailure("could not show the original", err);
    return { ok: false, message: REFUSED.failed, at };
  }
}

/* ------------------------------------------------------------------ triage, assign, fix, close, reopen */

const TriageSchema = z.object({
  priorityArea: z.enum(PRIORITY_AREAS),
  publicSummary: z.string().trim().min(1).max(PUBLIC_SUMMARY_MAX),
});

export async function saveTriage(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const publicSummary = field(form, "publicSummary").trim();
  const errors: FieldErrors = {};
  if (!z.enum(PRIORITY_AREAS).safeParse(field(form, "priorityArea")).success) errors.priorityArea = "Choose the area this barrier belongs to.";
  if (!publicSummary) errors.publicSummary = "Write a public summary.";
  else if (publicSummary.length > PUBLIC_SUMMARY_MAX) errors.publicSummary = `Keep the public summary under ${PUBLIC_SUMMARY_MAX} characters.`;
  else if (detectPatterns(publicSummary).length > 0) {
    errors.publicSummary = "The public summary has contact details in it (like a phone number or an email). Take them out.";
  }
  if (Object.keys(errors).length) return fail(Object.values(errors)[0], errors);
  const parsed = TriageSchema.parse({ priorityArea: field(form, "priorityArea"), publicSummary });

  return onCase(staff, ref, "triage", async (tx, c) => {
    // A detail the lead hid in the report must not come back through the public summary (domain §7).
    await refuseHiddenValue(tx, c, "publicSummary", "The public summary", parsed.publicSummary);
    await move(tx, staff, c, { kind: "triage", priorityArea: parsed.priorityArea, publicSummary: parsed.publicSummary });
    return { ok: true, message: `Triage saved. Status: ${staffStatusLabel("triaged")}.`, at: now() };
  });
}

/** The latest due date the "Assign" form accepts, in years from today. */
const DUE_MAX_YEARS = 3;

const DUE_IN_THE_PAST = "Choose today or a later date for the due date.";

/**
 * The due date typed on the "Assign" form (decision D8): "" is none; otherwise a real date up to DUE_MAX_YEARS
 * ahead (display time zone). `past`: before today, which is allowed only when it is the case's due date already (a
 * lead reassigning an overdue case keeps its date unless they change it). An error sentence says what to do.
 */
function checkDueDate(raw: string, today: string): { ok: true; on: string | null; past: boolean } | { ok: false; error: string } {
  const v = raw.trim();
  if (!v) return { ok: true, on: null, past: false };
  if (!isIsoDate(v)) return { ok: false, error: "Enter the due date as a full date, or leave it empty for no due date." };
  if (v > `${Number(today.slice(0, 4)) + DUE_MAX_YEARS}${today.slice(4)}`) {
    return { ok: false, error: `Choose a due date within the next ${DUE_MAX_YEARS} years.` };
  }
  return { ok: true, on: v, past: v < today };
}

export async function assignCase(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const memberId = z.uuid().safeParse(field(form, "memberId"));
  const choose = "Choose who will fix it.";
  const due = checkDueDate(field(form, "dueOn"), zonedDate(new Date()));
  const errors: FieldErrors = {};
  if (!memberId.success) errors.memberId = choose;
  if (!due.ok) errors.dueOn = due.error;
  if (!memberId.success || !due.ok) return fail(Object.values(errors)[0], errors);
  const dueAt = due.on ? dueAtForDate(due.on) : null;
  const dueWords = due.on ? `, due ${formatDateLong(zonedNoon(due.on))}` : "";

  // Tell the assignee only when the case is newly theirs, and never the lead who assigned it to themself.
  const tell: { value: { caseId: string; orgId: string; memberId: string; name: string } | null } = { value: null };
  const result = await onCase(staff, ref, "assign", async (tx, c) => {
    const [m] = await tx
      .select({ id: orgMembers.id, displayName: orgMembers.displayName })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, c.orgId), eq(orgMembers.id, memberId.data), inArray(orgMembers.role, ["owner", "lead"])))
      .limit(1);
    if (!m) throw new Refusal(fail(choose, { memberId: choose }));
    if (due.past && !(c.status === "assigned" && c.dueAt && dueDateOf(c.dueAt) === due.on)) {
      throw new Refusal(fail(DUE_IN_THE_PAST, { dueOn: DUE_IN_THE_PAST }));
    }
    const sameAssignee = c.status === "assigned" && c.assignedTo === m.id;
    await move(tx, staff, c, { kind: "assign", memberId: m.id, dueAt });
    if (!sameAssignee && m.id !== staff.memberId) tell.value = { caseId: c.id, orgId: c.orgId, memberId: m.id, name: m.displayName };
    if (sameAssignee) {
      // Only the due date changed (D8): same person, same status.
      const what = due.on ? `Due date set to ${formatDateLong(zonedNoon(due.on))}` : "No due date now";
      return { ok: true, message: `${what}. Still assigned to ${m.displayName}.`, at: now() };
    }
    return { ok: true, message: `Assigned to ${m.displayName}${dueWords}. Status: ${staffStatusLabel("assigned")}.`, at: now() };
  });
  const t = tell.value;
  if (!result.ok || !t) return result;
  // The email goes out after the assignment is saved (an email problem never undoes it), and the answer says what
  // really happened to it.
  let told: OwnerTold | null;
  try {
    told = await afterAssigned({ orgId: t.orgId, caseId: t.caseId, ref, memberId: t.memberId, assignedBy: staff.memberId });
  } catch (err) {
    logFailure("after the case was assigned", err); // the assignment itself is saved
    told = { kind: "not_sent" };
  }
  return told ? { ...result, message: `${result.message} ${ownerToldSentence(told, t.name)}` } : result;
}

export async function logFix(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const description = field(form, "description").trim();
  const evidence = checkEvidenceUrl(field(form, "evidenceUrl").slice(0, EVIDENCE_URL_MAX + 1));
  const errors: FieldErrors = {};
  if (!description) errors.description = "Say what you fixed.";
  else if (description.length > FIX_DESCRIPTION_MAX) errors.description = `Keep the fix description under ${FIX_DESCRIPTION_MAX.toLocaleString("en-CA")} characters.`;
  if (!evidence.ok) errors.evidenceUrl = evidence.error;
  if (Object.keys(errors).length || !evidence.ok) return fail(Object.values(errors)[0], errors);

  const fixed: { value: { caseId: string; orgId: string; retest: boolean; round: number } | null } = { value: null };
  const result = await onCase(staff, ref, "log_fix", async (tx, c) => {
    // A lead has read the original, so their words are checked for hidden details. An owner never saw them
    // (and RLS keeps case_private from an owner's transaction); layer 1 still runs on both (transition()).
    if (staff.role === "lead") await refuseHiddenValue(tx, c, "description", "The fix description", description);
    const r = await move(tx, staff, c, { kind: "log_fix", description, evidenceUrl: evidence.url });
    fixed.value = { caseId: c.id, orgId: c.orgId, retest: r.requestRetest, round: r.case.retestRound };
    return { ok: true, message: `Fix logged. Status: ${staffStatusLabel(r.case.status)}.`, at: now() };
  });
  const done = fixed.value;
  if (!result.ok || !done || !done.retest) return result;
  // The re-test request goes out after the fix is saved (an email problem never undoes a fix), and the answer says
  // what really happened: emailed, logged (simulated email), failed, or no email to send it to.
  let ask: RetestAsk | null;
  try {
    ask = await afterFixLogged({
      orgId: done.orgId,
      caseId: done.caseId,
      ref,
      retestRequested: true,
      round: done.round,
      viewerSeesContact: staff.role === "lead",
    });
  } catch (err) {
    logFailure("after the fix was logged", err); // the fix itself is saved
    ask = { kind: "not_sent" };
  }
  return ask ? { ...result, message: `${result.message} ${retestAskSentence(ask)}` } : result;
}

const CLOSE_REASON_AFTER_ASSIGN =
  "Once a case has been assigned or fixed, it can only be closed as a duplicate or as no action possible. Choose one of those.";

/** Phase 7 T2 item 8: a duplicate names its original, a case of the same org (the field's answers). */
const ORIGINAL_ERRORS = {
  missing: "Type the reference of the case this one repeats, for example BAR-0003.",
  format: "A case reference looks like BAR-0003. Check the one you typed.",
  notFound: (ref: string) => `There is no case ${ref} in this organization. Check the reference.`,
  itself: (ref: string) => `${ref} is this case. Type the reference of the other case it repeats.`,
  chained: (ref: string, root: string | null) =>
    root
      ? `${ref} is itself closed as a duplicate of ${root}. Use ${root} instead.`
      : `${ref} is itself closed as a duplicate. Use the case it repeats instead.`,
};

export async function closeCase(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const reason = z.enum(CLOSED_REASONS).safeParse(field(form, "reason"));
  const note = field(form, "note").trim();
  // "bar-3" or " BAR-0003 " are typed by people: compare in the stored form (upper case, no spaces).
  const originalRef = field(form, "duplicateOf").replace(/\s+/g, "").toUpperCase();
  const errors: FieldErrors = {};
  if (!reason.success) errors.reason = "Choose why you are closing it.";
  else if (reason.data === "duplicate") {
    if (!originalRef) errors.duplicateOf = ORIGINAL_ERRORS.missing;
    else if (!CASE_REF.test(originalRef)) errors.duplicateOf = ORIGINAL_ERRORS.format;
  }
  if (note.length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX.toLocaleString("en-CA")} characters.`;
  if (Object.keys(errors).length || !reason.success) return fail(Object.values(errors)[0], errors);

  return onCase(staff, ref, "close", async (tx, c) => {
    // D1: "spam" and "out of scope" only before the case was ever assigned or fixed (the state machine refuses
    // them too, from the same events).
    const work = await tx.select({ type: caseEvents.type }).from(caseEvents)
      .where(and(eq(caseEvents.caseId, c.id), inArray(caseEvents.type, [...WORK_STARTED_EVENTS])))
      .limit(1);
    if (!closeReasonsFor(c.status, workStartedFrom(work)).includes(reason.data)) {
      throw new Refusal(fail(CLOSE_REASON_AFTER_ASSIGN, { reason: CLOSE_REASON_AFTER_ASSIGN }));
    }
    let original: { id: string; ref: string } | null = null;
    if (reason.data === "duplicate") {
      // Looked up inside the lead's org only (withOrg + org_id): another org's BAR-0003 is "no case".
      const o = await caseByRef(tx, c.orgId, originalRef);
      const refuse = (msg: string) => new Refusal(fail(msg, { duplicateOf: msg }));
      if (!o) throw refuse(ORIGINAL_ERRORS.notFound(originalRef));
      if (o.id === c.id) throw refuse(ORIGINAL_ERRORS.itself(o.ref));
      if (o.status === "closed" && o.closedReason === "duplicate") {
        throw refuse(ORIGINAL_ERRORS.chained(o.ref, (await duplicateOriginalOf(tx, c.orgId, o.id))?.ref ?? null));
      }
      original = { id: o.id, ref: o.ref };
    }
    if (note) await refuseHiddenValue(tx, c, "note", "The note", note);
    await move(tx, staff, c, { kind: "close", reason: reason.data, note: note || undefined, duplicateOf: original?.id });
    const how = original ? ` as a duplicate of ${original.ref}` : "";
    return { ok: true, message: `Case closed${how}. Status: ${staffStatusLabel("closed")}.`, at: now() };
  });
}

export async function reopenCase(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const reason = field(form, "reason").trim();
  const errors: FieldErrors = {};
  if (!reason) errors.reason = "Say why you are reopening it.";
  else if (reason.length > NOTE_MAX) errors.reason = `Keep the reason under ${NOTE_MAX.toLocaleString("en-CA")} characters.`;
  if (Object.keys(errors).length) return fail(Object.values(errors)[0], errors);

  return onCase(staff, ref, "reopen", async (tx, c) => {
    await refuseHiddenValue(tx, c, "reason", "The reason", reason);
    const r = await move(tx, staff, c, { kind: "reopen", reason });
    const next =
      r.case.status === "assigned"
        ? ""
        : r.case.status === "triaged"
          ? " Assign it to someone to fix it."
          : " Check the redaction, then triage it.";
    return { ok: true, message: `Case reopened. Status: ${staffStatusLabel(r.case.status)}.${next}`, at: now() };
  });
}

/* ------------------------------------------------------------------ retriage (D2) and stop waiting (D3) */

const NOTHING_CHANGED = "Nothing was saved: change the area or the public summary, or both.";

/** "Correct the triage": a new area and/or public summary for a triaged or assigned case, with a reason (lead only). */
export async function retriageCase(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const area = z.enum(PRIORITY_AREAS).safeParse(field(form, "priorityArea"));
  const publicSummary = field(form, "publicSummary").trim();
  const reason = field(form, "reason").trim();
  const errors: FieldErrors = {};
  if (!area.success) errors.priorityArea = "Choose the area this barrier belongs to.";
  if (!publicSummary) errors.publicSummary = "Write a public summary.";
  else if (publicSummary.length > PUBLIC_SUMMARY_MAX) errors.publicSummary = `Keep the public summary under ${PUBLIC_SUMMARY_MAX} characters.`;
  else if (detectPatterns(publicSummary).length > 0) {
    errors.publicSummary = "The public summary has contact details in it (like a phone number or an email). Take them out.";
  }
  if (!reason) errors.reason = "Say why you are correcting it.";
  else if (reason.length > NOTE_MAX) errors.reason = `Keep the reason under ${NOTE_MAX.toLocaleString("en-CA")} characters.`;
  if (Object.keys(errors).length || !area.success) return fail(Object.values(errors)[0], errors);

  return onCase(staff, ref, "retriage", async (tx, c) => {
    const newArea = area.data !== c.priorityArea ? area.data : undefined;
    const newSummary = publicSummary !== c.publicSummary ? publicSummary : undefined;
    if (newArea === undefined && newSummary === undefined) throw new Refusal(fail(NOTHING_CHANGED));
    // A detail the lead hid in the report must not come back through the public summary or the log (domain §7).
    if (newSummary !== undefined) await refuseHiddenValue(tx, c, "publicSummary", "The public summary", newSummary);
    await refuseHiddenValue(tx, c, "reason", "The reason", reason);
    try {
      await move(tx, staff, c, { kind: "retriage", priorityArea: newArea, publicSummary: newSummary, reason });
    } catch (err) {
      // The summary differed only before layer-1 redaction: in the log it reads the same as before.
      if (err instanceof TransitionError && /nothing to change/.test(err.message)) throw new Refusal(fail(NOTHING_CHANGED));
      throw err;
    }
    const what =
      newArea !== undefined && newSummary !== undefined ? "Area and public summary" : newArea !== undefined ? "Area" : "Public summary";
    return { ok: true, message: `${what} corrected. Status: ${staffStatusLabel(c.status)}.`, at: now() };
  });
}

/** "Stop waiting": 14 days or more after the re-test request, the lead ends the round as unanswered (lead only). */
export async function stopWaiting(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  return onCase(staff, ref, "stop_waiting", async (tx, c) => {
    const requested = await latestEvent(tx, c.orgId, c.id, "retest_requested");
    const allowedFrom = requested ? new Date(requested.createdAt.getTime() + STOP_WAITING_DAYS * 86_400_000) : null;
    if (!allowedFrom) throw new Refusal(fail(staleMessage(staffStatusLabel(c.status))), true);
    if (allowedFrom.getTime() > Date.now()) {
      throw new Refusal(
        fail(`Nothing was saved: you can stop waiting from ${formatDateLong(allowedFrom)}, ${STOP_WAITING_DAYS} days after the reporter was asked.`),
        true,
      );
    }
    const r = await move(tx, staff, c, { kind: "stop_waiting" });
    return {
      ok: true,
      message: `Stopped waiting for the reporter. Status: ${staffStatusLabel(r.case.status)}. The fix counts as not verified by the reporter.`,
      at: now(),
    };
  });
}

/* ------------------------------------------------------------------ acknowledgement (ACR s.9(4)) and the reminder */

const SIMULATED = "logged, not sent (email is simulated in this prototype; the Outbox shows it)";

/**
 * An email step: `queue` records the email inside the case's transaction (onCase), and once that has committed the
 * email is sent with no transaction open and its result recorded in a second short one (lib/email/send.ts); `done`
 * then words the answer from what really happened.
 */
async function emailStep(
  staff: StaffOrg,
  ref: string,
  cmd: CaseCommand,
  queue: (tx: Tx, c: StaffCaseRow) => Promise<QueuedEmail>,
  done: (sent: SentEmail) => CaseActionResult,
): Promise<CaseActionResult> {
  const pending: { value: QueuedEmail | null } = { value: null };
  const queued = await onCase(staff, ref, cmd, async (tx, c) => {
    pending.value = await queue(tx, c);
    return { ok: true, message: "", at: now() };
  });
  const q = pending.value;
  if (!queued.ok || !q) return queued;
  try {
    return done(await deliverEmail(q));
  } catch (err) {
    logFailure(`could not record the ${cmd} email`, err);
    return fail(REFUSED.failed);
  }
}

async function eventsOf(tx: Tx, c: StaffCaseRow) {
  return tx
    .select({ type: caseEvents.type, payload: caseEvents.payload, createdAt: caseEvents.createdAt })
    .from(caseEvents)
    .where(and(eq(caseEvents.orgId, c.orgId), eq(caseEvents.caseId, c.id)))
    .orderBy(asc(caseEvents.seq));
}

const ACK_DONE = "Nothing was saved: this case needs no acknowledgement now (it is anonymous, came from the web form, or is already acknowledged). The page now shows where it is.";

/** The other acknowledgement step was asked for (a crafted POST, or a page from before): say which one applies. */
const ACK_RECORD_INSTEAD = (words: string) =>
  `Nothing was sent: this feedback is acknowledged ${words}, not with an email from AccessLoop. Record the day you acknowledged it instead.`;
const ACK_EMAIL_INSTEAD =
  "Nothing was saved: this feedback came by email and the address is on file, so AccessLoop sends the acknowledgement. Use \"Send acknowledgement email\".";

/** "Send acknowledgement email": feedback that came by email is acknowledged by email (lead only). */
export async function sendAcknowledgementEmail(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  return emailStep(
    staff,
    ref,
    "acknowledge",
    async (tx, c) => {
      const step = acknowledgementStep(c, reporterGaveEmail(await eventsOf(tx, c)));
      if (step?.kind === "manual") throw new Refusal(fail(ACK_RECORD_INSTEAD(step.words)), true);
      if (step?.kind !== "email") throw new Refusal(fail(ACK_DONE), true);
      const r = await queueAckEmail(tx, c, { kind: "staff", memberId: staff.memberId });
      if (!r.ok) {
        throw new Refusal(fail(r.reason === "no_email" ? "Nothing was sent: there is no email address on file for this case." : ACK_DONE), true);
      }
      return r.queued;
    },
    (sent) => {
      if (sent.status === "failed") {
        // The failed attempt stays on record (message_sent, status failed); no acknowledgement is recorded.
        return fail("The acknowledgement email could not be sent, so no acknowledgement was recorded. Try again later.");
      }
      const how = sent.status === "skipped_fake" ? SIMULATED : "sent";
      return { ok: true, message: `Acknowledgement email ${how}. Recorded: acknowledged by email on ${formatDateLong(sent.at)}.`, at: now() };
    },
  );
}

const ACK_DATE_ERRORS = {
  missing: "Enter the date you acknowledged it.",
  invalid: "Enter the date as year, month and day, for example 2026-10-19.",
  future: "The date can't be in the future.",
};

/** "Record acknowledgement": the lead acknowledged it by phone, mail, in person or another way (lead only). */
export async function recordAcknowledgement(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const on = field(form, "ackDate").trim();
  return onCase(staff, ref, "acknowledge", async (tx, c) => {
    const step = acknowledgementStep(c, reporterGaveEmail(await eventsOf(tx, c)));
    if (step?.kind === "email") throw new Refusal(fail(ACK_EMAIL_INSTEAD), true);
    if (step?.kind !== "manual") throw new Refusal(fail(ACK_DONE), true);
    const nowAt = new Date();
    const receivedOn = zonedDate(c.receivedAt);
    const problem = checkPastDate(on, nowAt, receivedOn);
    if (problem) {
      const msg =
        problem === "missing" || problem === "invalid" || problem === "future"
          ? ACK_DATE_ERRORS[problem]
          : `The date can't be before the day the feedback arrived (${formatDateLong(c.receivedAt)}).`;
      throw new Refusal(fail(msg, { ackDate: msg }));
    }
    const ackAt = instantForDate(on, nowAt);
    await appendCaseEvent(tx, {
      orgId: c.orgId,
      caseId: c.id,
      type: "ack_recorded",
      actorKind: "staff",
      actorId: staff.memberId,
      createdAt: nowAt,
      payload: { channel: step.channel, manual: true, on },
    });
    await tx.update(cases).set({ ackAt, updatedAt: nowAt }).where(and(eq(cases.orgId, c.orgId), eq(cases.id, c.id)));
    return { ok: true, message: `Acknowledgement recorded: acknowledged ${step.words} on ${formatDateLong(zonedNoon(on))}.`, at: now() };
  });
}

/** "Send a reminder email": the one reminder of this re-test round (domain §3), to a reporter who gave an email. */
export async function sendReminder(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  let round = 0;
  return emailStep(
    staff,
    ref,
    "remind",
    async (tx, c) => {
      const r = await queueRetestReminder(tx, c, { kind: "staff", memberId: staff.memberId });
      if (!r.ok) {
        const msg =
          r.reason === "already_sent"
            ? "Nothing was sent: the one reminder for this round already went out."
            : r.reason === "no_email"
              ? "Nothing was sent: the reporter did not give an email address."
              : staleMessage(staffStatusLabel(c.status));
        throw new Refusal(fail(msg), true);
      }
      round = c.retestRound;
      return r.queued;
    },
    (sent) => {
      if (sent.status === "failed") return fail("The reminder email could not be sent. Nothing else changed. You can try again later.");
      const how = sent.status === "skipped_fake" ? SIMULATED : "sent";
      return { ok: true, message: `Reminder email ${how}. It is the only reminder for round ${round}.`, at: now() };
    },
  );
}

/* ------------------------------------------------------------------ notes and interim accommodations (Phase 7 T2 item 4) */

const NoteKindSchema = z.enum(NOTE_KINDS);

/**
 * "Add note": an internal note, or an interim accommodation (what the person was offered while the barrier is being
 * fixed), by the lead or the owner the case is assigned to, in any status. It is a `note_added` event appended with
 * appendCaseEvent (never edited afterwards), its text layer-1 redacted first; for staff only (the reporter's page
 * never reads it, and no metric counts it).
 */
export async function addNote(form: FormData): Promise<CaseActionResult> {
  const staff = await signedIn();
  if (!staff) return signedOutAnswer();
  const ref = field(form, "ref");
  const kind = NoteKindSchema.safeParse(field(form, "kind"));
  const text = field(form, "note").trim();
  const errors: FieldErrors = {};
  if (!kind.success) errors.kind = "Choose what kind of note it is.";
  if (!text) errors.note = kind.success && kind.data === "interim_accommodation" ? "Say what the person was offered." : "Write the note.";
  else if (text.length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX.toLocaleString("en-CA")} characters.`;
  if (Object.keys(errors).length || !kind.success) return fail(Object.values(errors)[0], errors);

  return onCase(staff, ref, "note", async (tx, c) => {
    // A lead has read the original, so their words are checked for hidden details. An owner never saw them (and RLS
    // keeps case_private from an owner's transaction); layer 1 runs on both.
    if (staff.role === "lead") await refuseHiddenValue(tx, c, "note", "The note", text);
    await appendCaseEvent(tx, {
      orgId: c.orgId,
      caseId: c.id,
      type: "note_added",
      actorKind: "staff",
      actorId: staff.memberId,
      payload: { kind: kind.data, note: scrubNote(text) },
    });
    return {
      ok: true,
      message: `${NOTE_KIND_LABELS[kind.data]} added. It is in the case history, for staff only: the reporter does not see it.`,
      at: now(),
    };
  });
}
