// `npm run pilot:ingest`: build the pilot tenant (data/pilot/submissions.json, lib/pilot.ts) through the REAL intake.
// Each made-up submission goes through the same code the product uses: a web report through buildPreview() (layer-1
// redaction, flagPii and structure() with whatever AI backend .env.local selects) and prepareCase(); any other channel
// through prepareStaffCase(), as "Log feedback" does; then the frozen createCase(). Its planned steps are then played
// like a lead, an owner and the reporter would: the redaction approved as proposed (approveRedaction's own
// finalizeApproval), the manual acknowledgement, then triage, assign, log_fix, closes and verdicts through
// transition() only. A verdict is given with the case's receipt code, resolved by resolve_receipt() like /r/{code}.
//
// Dates: like db/seed.ts, every step is dated from the submission's receivedOn (transition()'s `at`), so the pilot
// spans the year the way real feedback would. The AI calls happen now, outside any transaction (one at a time, so the
// claude-cli backend's one-call queue is respected); each case is then created and played in ONE transaction, so a
// case is either all there or not there at all.
//
// Idempotent: submission N is case BAR-000N of the org. A run skips the cases that already exist and adds the rest;
// it stops if the org holds any other case. `npm run local:reset` starts again from nothing.
// Local only: it refuses to run unless AUTH_MODE=local, SEED_ALLOW_RESET=1 and DATABASE_URL points at this machine.
// It prints progress and counts only: never report text, summaries, receipt codes or contact details.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cases, orgMembers, orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { aiLocalScriptContext, effectiveBackend } from "@/lib/ai";
import { appendCaseEvent } from "@/lib/case-events";
import { createCase, type CreateCaseInput } from "@/lib/cases/create";
import { acknowledgementStep } from "@/lib/cases/messages";
import { finalizeApproval, parseSpans } from "@/lib/cases/redaction-review";
import { latestEvent } from "@/lib/cases/staff-case";
import { buildPreview, prepareCase } from "@/lib/intake/pipeline";
import { prepareStaffCase } from "@/lib/intake/staff";
import type { StaffChannel } from "@/lib/intake/staff-types";
import { PILOT_LEAD, PILOT_ORG, PILOT_OWNERS, PILOT_SUBMISSIONS, pilotRef, type PilotOwner, type PilotSubmission } from "@/lib/pilot";
import { hashReceiptCode } from "@/lib/receipt-code";
import { transition, type Actor } from "@/lib/state-machine";

const DAY = 86_400_000;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function refuse(message: string): never {
  console.error(`pilot:ingest: ${message}`);
  process.exit(1);
}

function checkEnvironment(): void {
  if (process.env.AUTH_MODE !== "local") refuse("runs only with AUTH_MODE=local (it builds a made-up tenant on this machine).");
  if (process.env.SEED_ALLOW_RESET !== "1") refuse("runs only where SEED_ALLOW_RESET=1 (the local database).");
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    refuse("DATABASE_URL is missing or not a URL.");
  }
  if (!LOCAL_HOSTS.has(host)) refuse("DATABASE_URL must point at this machine.");
}

/** The day a step happens, from the submission's receipt (none may be in the future). */
function stepDate(receivedAt: Date, days: number, plusMs = 0): Date {
  return new Date(receivedAt.getTime() + days * DAY + plusMs);
}

function checkDates(now: Date): void {
  for (const s of PILOT_SUBMISSIONS) {
    const last = Math.max(1, ...s.steps.map(([d]) => d));
    if (stepDate(new Date(`${s.receivedOn}T14:00:00.000Z`), last) > now) refuse(`${s.id}'s steps end in the future.`);
  }
}

async function upsertOrg() {
  const [existing] = await db.select().from(orgs).where(eq(orgs.slug, PILOT_ORG.slug));
  if (existing) return existing;
  const [row] = await db
    .insert(orgs)
    .values({
      clerkOrgId: "local_org_northbound",
      slug: PILOT_ORG.slug,
      name: PILOT_ORG.name,
      regulator: "cta",
      entityClass: "private_large",
      planAreas: ["employment", "built_environment", "ict", "communication_other", "procurement", "programs_services", "transportation"],
      feedbackDesignateTitle: "Director, Accessible Travel",
      contactMailingAddress: "300 Example Quay, Saint John, NB E2L 0A0",
      contactPhone: "1-800-555-0103",
      contactEmail: "accessibility@example.net",
    })
    .returning();
  return row;
}

async function upsertMembers(orgId: string): Promise<{ lead: string; owners: Record<PilotOwner, string> }> {
  return withOrg({ orgId, role: "system" }, async (tx) => {
    const member = async (clerkUserId: string, displayName: string, role: "lead" | "owner") => {
      await tx.insert(orgMembers).values({ orgId, clerkUserId, displayName, role }).onConflictDoNothing();
      const [m] = await tx
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.clerkUserId, clerkUserId)));
      return m.id;
    };
    const lead = await member("local_northbound_lead", PILOT_LEAD, "lead");
    const owners = {} as Record<PilotOwner, string>;
    for (const [key, name] of Object.entries(PILOT_OWNERS) as [PilotOwner, string][]) {
      owners[key] = await member(`local_northbound_${key}`, name, "owner");
    }
    return { lead, owners };
  });
}

/** The intake, with no transaction open: the same AI steps and redaction as the web form or "Log feedback". */
async function intake(orgId: string, s: PilotSubmission, leadId: string, now: Date): Promise<CreateCaseInput> {
  const ai = aiLocalScriptContext("pilot-ingest");
  const receivedAt = new Date(`${s.receivedOn}T14:00:00.000Z`);
  if (s.channel === "web") {
    const preview = await buildPreview(orgId, { text: s.text, locationKind: s.locationKind, locationDetail: s.locationDetail, aiOptOut: false }, ai);
    const prepared = await prepareCase(
      orgId,
      {
        text: s.text,
        locationKind: s.locationKind,
        locationDetail: s.locationDetail,
        wantsRetest: s.wantsRetest,
        emailChoice: "anonymous",
        email: "",
        aiOptOut: false,
        choice: preview.summary ? "ai_confirmed" : "reporter_words", // the reporter keeps the summary as shown
        editedSummary: "",
        token: preview.token,
      },
      null,
    );
    return { ...prepared, receivedAt };
  }
  return prepareStaffCase(
    orgId,
    {
      channel: s.channel as StaffChannel,
      receivedDate: s.receivedOn,
      text: s.text,
      locationKind: s.locationKind,
      locationDetail: s.locationDetail,
      anonymous: s.anonymous,
      email: null,
      contact: s.contact,
      wantsRetest: s.wantsRetest,
      aiOptOut: false,
    },
    leadId,
    now,
    ai,
  );
}

type Tx = Parameters<Parameters<typeof withOrg>[1]>[0];

/** Create one case and play its planned steps, all in the caller's transaction. Returns the final status. */
async function createAndPlay(
  tx: Tx, orgId: string, index: number, s: PilotSubmission, input: CreateCaseInput,
  members: { lead: string; owners: Record<PilotOwner, string> },
): Promise<string> {
  const lead: Actor = { kind: "staff", memberId: members.lead, role: "lead" };
  const reporter: Actor = { kind: "reporter", via: "receipt_code" };
  const { case: c, receiptCode } = await createCase(tx, input);
  if (c.ref !== pilotRef(index)) throw new Error(`expected ${pilotRef(index)} but createCase gave ${c.ref}`);
  const t0 = c.receivedAt;
  const at = (days: number, plusMs = 0) => stepDate(t0, days, plusMs);

  // A named person who called, wrote or came in: the lead records the acknowledgement given the same way, next day.
  const ack = acknowledgementStep(c, false);
  if (ack?.kind === "manual") {
    const ackAt = at(1);
    await appendCaseEvent(tx, {
      orgId, caseId: c.id, type: "ack_recorded", actorKind: "staff", actorId: members.lead, createdAt: ackAt,
      payload: { channel: ack.channel, manual: true, on: ackAt.toISOString().slice(0, 10) },
    });
    await tx.update(cases).set({ ackAt, updatedAt: ackAt }).where(and(eq(cases.orgId, orgId), eq(cases.id, c.id)));
  }
  if (!s.publicSummary) return c.status; // stays NEW: the lead hasn't reviewed the redaction yet

  // "Approve redaction" as proposed: every proposed span kept, nothing added (approveRedaction's own rule).
  const proposal = await latestEvent(tx, orgId, c.id, "redaction_proposed");
  const proposed = parseSpans(proposal?.payload.spans, s.text.length);
  const approval = finalizeApproval(s.text, proposed, proposed.map((_, k) => k), [], {
    summary: c.summary, aiSummary: c.aiSummary, locationDetail: c.locationDetail,
  });
  if ("problem" in approval) throw new Error(`${s.id}: the proposed redaction could not be approved`);
  const approvedAt = at(0, 3_600_000);
  await tx
    .update(cases)
    .set({
      redactedText: approval.redactedText, summary: approval.summary, aiSummary: approval.aiSummary,
      locationDetail: approval.locationDetail, redactionApprovedAt: approvedAt, needsManualRedaction: false, updatedAt: approvedAt,
    })
    .where(and(eq(cases.orgId, orgId), eq(cases.id, c.id)));
  await appendCaseEvent(tx, {
    orgId, caseId: c.id, type: "redaction_approved", actorKind: "staff", actorId: members.lead, createdAt: approvedAt,
    payload: { spans: approval.spans.map(({ start, end, type, source }) => ({ start, end, type, source })), ...approval.counts },
  });

  const steps = s.steps;
  if (steps[0]?.[1] === "close_duplicate") {
    const original = PILOT_SUBMISSIONS.findIndex((x) => x.id === s.duplicateOf);
    const [o] = await tx.select({ id: cases.id }).from(cases).where(and(eq(cases.orgId, orgId), eq(cases.ref, pilotRef(original))));
    if (!o) throw new Error(`${s.id}: its original ${s.duplicateOf} is missing`);
    return (await transition(tx, orgId, c.id, { kind: "close", reason: "duplicate", duplicateOf: o.id }, lead, { at: at(steps[0][0]) })).case.status;
  }
  let status = (await transition(tx, orgId, c.id, { kind: "triage", priorityArea: s.area, publicSummary: s.publicSummary }, lead, { at: at(0, 7_200_000) })).case.status;
  if (steps[0]?.[1] === "close_no_action") {
    return (await transition(tx, orgId, c.id, { kind: "close", reason: "no_action_possible" }, lead, { at: at(steps[0][0]) })).case.status;
  }
  if (!s.owner) return status;
  const ownerId = members.owners[s.owner];
  status = (await transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId }, lead, { at: at(1) })).case.status;
  const owner: Actor = { kind: "staff", memberId: ownerId, role: "owner" };

  for (const [d, step] of steps) {
    if (step === "fix") {
      status = (await transition(tx, orgId, c.id, { kind: "log_fix", description: `Fix logged: ${s.publicSummary}` }, owner, { at: at(d) })).case.status;
      continue;
    }
    if (step === "close_duplicate" || step === "close_no_action") throw new Error(`${s.id}: ${step} must be the only step`);
    // The reporter answers with their receipt code: the same lookup /r/{code} does, inside this transaction.
    const hash = hashReceiptCode(receiptCode);
    const rows = hash ? await tx.execute<{ case_id: string }>(sql`select case_id from resolve_receipt(${hash})`) : [];
    if (rows[0]?.case_id !== c.id) throw new Error(`${s.id}: its receipt code did not lead back to the case`);
    status = (await transition(tx, orgId, c.id, { kind: "verdict", verdict: step }, reporter, { at: at(d) })).case.status;
  }
  return status;
}

async function main() {
  checkEnvironment();
  const now = new Date();
  checkDates(now);
  const backend = effectiveBackend();
  const org = await upsertOrg();
  const members = await upsertMembers(org.id);

  const existing = await withOrg({ orgId: org.id, role: "system" }, (tx) =>
    tx.select({ ref: cases.ref }).from(cases).where(eq(cases.orgId, org.id)),
  );
  const refs = new Set(existing.map((r) => r.ref));
  const done = PILOT_SUBMISSIONS.filter((_, i) => refs.has(pilotRef(i))).length;
  if (refs.size !== done || [...refs].some((r) => !PILOT_SUBMISSIONS.some((_, i) => pilotRef(i) === r && i < done))) {
    refuse(`${PILOT_ORG.name} holds cases this import didn't make (or a gap). Run npm run local:reset to start again.`);
  }
  console.log(`${PILOT_ORG.name} (made-up pilot organization): ${PILOT_SUBMISSIONS.length} submissions, ${done} already imported. AI backend: ${backend}.`);
  if (backend === "claude-cli") console.log("claude-cli results are internal and never published (docs/domain.md §6.1).");

  const tally = { created: 0, aiSummary: 0, manualRedaction: 0, areaAgrees: 0, areaKnown: 0, aiMs: 0 };
  const statuses = new Map<string, number>();
  for (let i = done; i < PILOT_SUBMISSIONS.length; i++) {
    const s = PILOT_SUBMISSIONS[i];
    const started = Date.now();
    const input = await intake(org.id, s, members.lead, now);
    const aiMs = Date.now() - started;
    const status = await withOrg({ orgId: org.id, role: "system" }, (tx) => createAndPlay(tx, org.id, i, s, input, members));

    const top = input.ai?.priorityAreas[0]?.area ?? null;
    tally.created++;
    tally.aiMs += aiMs;
    if (input.ai) tally.aiSummary++;
    if (input.needsManualRedaction) tally.manualRedaction++;
    if (top) {
      tally.areaKnown++;
      if (top === s.area) tally.areaAgrees++;
    }
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    const hidden = input.spans.length === 1 ? "1 detail hidden" : `${input.spans.length} details hidden`;
    const area = top === null ? "no AI area" : top === s.area ? "AI area = filed area" : "AI area differs";
    console.log(
      `[${i + 1}/${PILOT_SUBMISSIONS.length}] ${s.id} -> ${pilotRef(i)} ${s.channel}, ` +
        `${input.ai ? "AI summary" : "no AI summary (manual triage)"} in ${(aiMs / 1000).toFixed(1)} s, ${hidden}, ${area}, now ${status}`,
    );
  }

  if (tally.created === 0) {
    console.log("Nothing to add: every submission is already imported.");
    return;
  }
  console.log(`Added ${tally.created} cases. AI summary: ${tally.aiSummary}/${tally.created}. Flagged for a manual redaction check: ${tally.manualRedaction}.`);
  console.log(`AI top area matched the filed area: ${tally.areaAgrees}/${tally.areaKnown}. AI time: ${(tally.aiMs / 1000).toFixed(0)} s in all.`);
  console.log(`Statuses: ${[...statuses].map(([k, n]) => `${k} ${n}`).join(", ")}.`);
  console.log(`Sign in as ${PILOT_LEAD} (${PILOT_ORG.name}) at http://localhost:3000/sign-in to look around.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`pilot:ingest failed (${e instanceof Error ? `${e.name}: ${e.message}` : "UnknownError"})`);
    process.exit(1);
  });
