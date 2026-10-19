// E2E-only fixture (never imported by the app): files a web report straight through the app's own intake code
// (lib/intake/pipeline.ts prepareCase, then the frozen createCase, inside withOrg), so staff tests get fresh cases
// in milliseconds without spending the public form's rate limit. The redaction is the real one (layer 1 + the fake
// flagPii), exactly what "Send report" stores. Moving a case along uses only the frozen core too, like
// e2e/fixtures/advance.ts. It shares the app's one db/client pool: never end it in a spec.
import { and, desc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { caseEvents, cases, orgMembers, orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { appendCaseEvent } from "@/lib/case-events";
import { createCase } from "@/lib/cases/create";
import { buildPreview, prepareCase } from "@/lib/intake/pipeline";
import type { LocationKindValue } from "@/lib/intake/types";
import { transition, type Actor } from "@/lib/state-machine";

export interface Filed {
  ref: string;
  code: string;
}

async function orgIdOf(slug: string): Promise<string> {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!org) throw new Error(`org ${slug} is not in the database (run npm run local:setup)`);
  return org.id;
}

/** A web report as the public form would store it (the AI summary confirmed, unless `aiOptOut`). */
export async function fileReport(
  slug: string,
  opts: { text: string; wantsRetest?: boolean; aiOptOut?: boolean; email?: string; where?: LocationKindValue; detail?: string },
): Promise<Filed> {
  process.env.FAKE_LLM = "1"; // fakes only, whatever .env.local says (like Playwright's web server)
  const orgId = await orgIdOf(slug);
  const where = opts.where ?? "place";
  const aiOptOut = opts.aiOptOut ?? false;
  // Step 3 "Next" (the AI summary and its sealed token), then "Yes, that's right" and "Send report".
  const preview = await buildPreview(orgId, { text: opts.text, locationKind: where, locationDetail: opts.detail ?? "", aiOptOut });
  const prepared = await prepareCase(
    orgId,
    {
      text: opts.text,
      locationKind: where,
      locationDetail: opts.detail ?? "",
      wantsRetest: opts.wantsRetest ?? false,
      emailChoice: opts.email ? "email" : "anonymous",
      email: opts.email ?? "",
      aiOptOut,
      choice: preview.summary ? "ai_confirmed" : null,
      editedSummary: "",
      token: preview.token,
    },
    opts.email ?? null,
  );
  const created = await withOrg({ orgId, role: "reporter" }, (tx) => createCase(tx, { ...prepared, receivedAt: new Date() }));
  return { ref: created.case.ref, code: created.receiptCode };
}

async function inCase<T>(slug: string, ref: string, fn: (tx: Tx, ids: { orgId: string; caseId: string }) => Promise<T>) {
  const orgId = await orgIdOf(slug);
  return withOrg({ orgId, role: "system" }, async (tx) => {
    const [c] = await tx.select({ id: cases.id }).from(cases).where(and(eq(cases.orgId, orgId), eq(cases.ref, ref))).limit(1);
    if (!c) throw new Error(`case ${ref} not found in ${slug}`);
    return fn(tx, { orgId, caseId: c.id });
  });
}

async function memberNamed(tx: Tx, orgId: string, prefix: string) {
  const all = await tx.select().from(orgMembers).where(eq(orgMembers.orgId, orgId));
  const m = all.find((x) => x.displayName.startsWith(prefix));
  if (!m) throw new Error(`no member named ${prefix}`);
  return m;
}

export type Stage = "approved" | "triaged" | "assigned" | "fixed";

/**
 * Move a NEW case forward as staff would (the proposed spans approved as they are, triaged as the built
 * environment, assigned to "Facilities team", a fix logged by that owner), stopping at `until`.
 * The reporter's own steps (verdicts) are never faked here: tests answer on /r/[code] with the receipt code.
 */
export async function moveCase(slug: string, ref: string, until: Stage) {
  await inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const lead = await memberNamed(tx, orgId, "Alex Rivera");
    const owner = await memberNamed(tx, orgId, "Facilities team");
    const leadActor: Actor = { kind: "staff", memberId: lead.id, role: "lead" };
    const [proposed] = await tx.select({ payload: caseEvents.payload }).from(caseEvents)
      .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "redaction_proposed")))
      .orderBy(desc(caseEvents.seq)).limit(1);
    const approvedAt = new Date();
    await appendCaseEvent(tx, {
      orgId, caseId, type: "redaction_approved", actorKind: "staff", actorId: lead.id,
      payload: { spans: proposed?.payload.spans ?? [] }, createdAt: approvedAt,
    });
    await tx.update(cases).set({ redactionApprovedAt: approvedAt, needsManualRedaction: false }).where(eq(cases.id, caseId));
    if (until === "approved") return;
    await transition(tx, orgId, caseId, {
      kind: "triage", priorityArea: "built_environment", publicSummary: "A door at a branch entrance did not open.",
    }, leadActor);
    if (until === "triaged") return;
    await transition(tx, orgId, caseId, { kind: "assign", memberId: owner.id }, leadActor);
    if (until === "assigned") return;
    await transition(tx, orgId, caseId, { kind: "log_fix", description: "Replaced the door operator and tested it." },
      { kind: "staff", memberId: owner.id, role: "owner" });
  });
}

/**
 * An ASSIGNED case (wantsRetest = yes) gets its fix logged by "Facilities team" `daysAgo` days in the past, so its
 * re-test request is that old (Phase 7 D3: the lead may stop waiting 14 days after it). Like closeCaseInThePast in
 * e2e/fixtures/advance.ts, only the event times are in the past.
 */
export async function logFixDaysAgo(slug: string, ref: string, daysAgo: number) {
  await inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const owner = await memberNamed(tx, orgId, "Facilities team");
    await transition(tx, orgId, caseId, { kind: "log_fix", description: "Replaced the door operator and tested it." },
      { kind: "staff", memberId: owner.id, role: "owner" }, { at: new Date(Date.now() - daysAgo * 86_400_000) });
  });
}

/** The lead closes the case (no action possible), from whatever closable status it is in. */
export async function closeCase(slug: string, ref: string) {
  await inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const lead = await memberNamed(tx, orgId, "Alex Rivera");
    await transition(tx, orgId, caseId, { kind: "close", reason: "no_action_possible" }, { kind: "staff", memberId: lead.id, role: "lead" });
  });
}

export interface CaseFacts {
  status: string;
  redactedText: string;
  summary: string | null;
  needsManualRedaction: boolean;
  redactionApprovedAt: Date | null;
  publicSummary: string | null;
  priorityArea: string | null;
  assignee: string | null;
  events: { type: string; actorKind: string; actorId: string | null; payload: Record<string, unknown> }[];
}

/** The case and its events, read through the app role inside the org (system role: no case_private). */
export async function caseFacts(slug: string, ref: string): Promise<CaseFacts> {
  return inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const [c] = await tx.select().from(cases).where(eq(cases.id, caseId));
    const events = await tx.select({ type: caseEvents.type, actorKind: caseEvents.actorKind, actorId: caseEvents.actorId, payload: caseEvents.payload })
      .from(caseEvents).where(eq(caseEvents.caseId, caseId)).orderBy(caseEvents.seq);
    let assignee: string | null = null;
    if (c.assignedTo) {
      const [m] = await tx.select({ name: orgMembers.displayName }).from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.id, c.assignedTo)));
      assignee = m?.name ?? null;
    }
    return {
      status: c.status, redactedText: c.redactedText, summary: c.summary, needsManualRedaction: c.needsManualRedaction,
      redactionApprovedAt: c.redactionApprovedAt, publicSummary: c.publicSummary, priorityArea: c.priorityArea, assignee, events,
    };
  });
}
