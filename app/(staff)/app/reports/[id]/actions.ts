"use server";

// The lead's three actions on a report (docs/domain.md §7 steps 7-9): save a section's text, sign off, publish.
// Public POST endpoints like every server action: each checks the session and the lead role, validates its input
// with zod, takes the org from the session (never the form) and writes only through lib/report/edit.ts, which
// refuses every change to a signed-off report.
import { refresh } from "next/cache";
import { z } from "zod";
import { withOrg } from "@/db/tenant";
import { getStaffOrg, type StaffOrg } from "@/lib/auth/staff";
import { signedOutAnswer } from "@/lib/auth/signed-out";
import { REFUSED, type CaseActionResult } from "@/lib/cases/action-result";
import { publishReport, saveLeadText, signOffReport, type EditRefusal, type EditResult } from "@/lib/report/edit";
import { LEAD_TEXT_MAX } from "@/lib/report/labels";
import { toWriteLine } from "@/lib/report/view";

const ReportId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const SectionKey = z.union([z.literal("consultations"), z.string().regex(/^area:[a-z_]{2,40}$/)]);

const REFUSAL: Record<EditRefusal, string> = {
  not_found: "We can't find this report. Nothing was saved.",
  not_draft: "This report is signed off, so it can't change. Start a new report for a new version.",
  invalid_section: REFUSED.invalid,
  too_long: `Keep this text under ${LEAD_TEXT_MAX.toLocaleString("en-CA")} characters. Nothing was saved.`,
  not_ready: "Not signed off yet.",
  not_signed_off: "Sign off the report before you publish it. Nothing was published.",
  already_published: "This report is already published.",
  signing_unavailable: "Sign-off isn't available just now: the report signing key isn't set up on this server. Nothing was changed.",
  evidence_failed:
    "Not signed off: the evidence check doesn't pass (a record or this report changed after it was built). Open \"Verify evidence chain\" to see what changed. Nothing was changed.",
};

/** "Not signed off yet: 7 parts still need your text." and the other reasons, in words. */
function notReady(r: Extract<EditResult, { ok: false }>): string {
  const c = r.checks;
  if (!c) return REFUSAL.not_ready;
  const why: string[] = [];
  if (!c.passes) why.push("a required check fails");
  if (c.toWrite > 0) why.push(toWriteLine(c.toWrite).toLowerCase());
  if (c.blockers.length > 0) why.push("a sentence has no sources or did not pass the sentence checks");
  return `Not signed off yet: ${why.join(", and ") || "the checks don't allow it"}. Nothing was changed.`;
}

async function leadOnly(): Promise<{ ok: true; staff: StaffOrg } | { ok: false; refusal: CaseActionResult }> {
  const staff = await getStaffOrg();
  if (!staff) return { ok: false, refusal: signedOutAnswer() };
  if (staff.role !== "lead") return { ok: false, refusal: { ok: false, message: REFUSED.role, at: Date.now() } };
  return { ok: true, staff };
}

/**
 * The action's answer. `refreshWhenStale`: when the report moved on (another tab signed it off), re-render the page as
 * it is now. Not for a section's save: the refresh would remove that section's text box together with the line that
 * says why nothing was saved; the sign-off panel's line survives it.
 */
function answer(r: EditResult, success: string, refreshWhenStale = true): CaseActionResult {
  if (r.ok) {
    refresh();
    return { ok: true, message: success, at: Date.now() };
  }
  if (refreshWhenStale && (r.reason === "not_draft" || r.reason === "already_published")) refresh();
  return { ok: false, message: r.reason === "not_ready" ? notReady(r) : REFUSAL[r.reason], at: Date.now() };
}

function failed(what: string, err: unknown): CaseActionResult {
  console.error(`[reports] ${what} failed (${err instanceof Error ? err.name : "UnknownError"})`);
  return { ok: false, message: REFUSED.failed, at: Date.now() };
}

export async function saveSectionText(form: FormData): Promise<CaseActionResult> {
  const who = await leadOnly();
  if (!who.ok) return who.refusal;
  const parsed = z
    .object({ reportId: ReportId, key: SectionKey, text: z.string().max(LEAD_TEXT_MAX * 2) })
    .safeParse({ reportId: form.get("reportId"), key: form.get("key"), text: form.get("text") ?? "" });
  if (!parsed.success) {
    const tooLong = typeof form.get("text") === "string" && (form.get("text") as string).length > LEAD_TEXT_MAX * 2;
    return { ok: false, message: tooLong ? REFUSAL.too_long : REFUSED.invalid, at: Date.now() };
  }
  const { reportId, key, text } = parsed.data;
  try {
    const r = await withOrg({ orgId: who.staff.orgId, role: "lead" }, (tx) => saveLeadText(tx, { orgId: who.staff.orgId, reportId, key, text }));
    return answer(r, text.trim() ? "Saved. The report checks are up to date." : "Cleared. This part is marked as still to write.", false);
  } catch (err) {
    return failed("saving a section's text", err);
  }
}

export async function signOff(form: FormData): Promise<CaseActionResult> {
  const who = await leadOnly();
  if (!who.ok) return who.refusal;
  const parsed = ReportId.safeParse(form.get("reportId"));
  if (!parsed.success) return { ok: false, message: REFUSED.invalid, at: Date.now() };
  try {
    const r = await withOrg({ orgId: who.staff.orgId, role: "lead" }, (tx) =>
      signOffReport(tx, { orgId: who.staff.orgId, reportId: parsed.data, memberId: who.staff.memberId, now: new Date() }),
    );
    return answer(r, "Signed off. This version can't change any more. Publish it when you are ready.");
  } catch (err) {
    return failed("signing off", err);
  }
}

export async function publish(form: FormData): Promise<CaseActionResult> {
  const who = await leadOnly();
  if (!who.ok) return who.refusal;
  const parsed = ReportId.safeParse(form.get("reportId"));
  if (!parsed.success) return { ok: false, message: REFUSED.invalid, at: Date.now() };
  try {
    const r = await withOrg({ orgId: who.staff.orgId, role: "lead" }, (tx) => publishReport(tx, { orgId: who.staff.orgId, reportId: parsed.data, now: new Date() }));
    return answer(r, "Published. Tell your regulator within 48 hours of publishing (ACR s.16).");
  } catch (err) {
    return failed("publishing", err);
  }
}
