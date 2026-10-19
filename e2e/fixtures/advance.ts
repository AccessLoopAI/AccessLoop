// E2E-only test fixture (never imported by the app): moves a case that a test just sent through the public form
// along the loop, using ONLY the frozen core, exactly like db/seed.ts does: withOrg() for every tenant-table
// access, appendCaseEvent() for the redaction approval, and transition() for every status change. It connects
// as the app role (DATABASE_URL, from .env.local via playwright.config.ts), so RLS and the grants apply.
// The pool is the app's one db/client singleton, shared by every spec in the worker: never end it in a spec's
// afterAll (the next spec file would find it closed). The worker process ends it when the run is over.
import { and, desc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { caseEvents, cases, orgMembers, orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { appendCaseEvent } from "@/lib/case-events";
import { transition, type Actor } from "@/lib/state-machine";

const DAY = 86_400_000;

async function orgIdOf(slug: string): Promise<string> {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!org) throw new Error(`org ${slug} is not in the database (run npm run local:setup)`);
  return org.id;
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

/**
 * new -> (redaction approved) -> triaged -> assigned to "Facilities team" -> fix logged by that owner.
 * With a re-test wanted (the public form's "Let me check the fix with my code" or "Email me, and let me check the fix",
 * or Log feedback's "Can we ask them to check the fix later?" = Yes) the case ends in retest_open, else fixed_unverified.
 */
export async function advanceToRetest(slug: string, ref: string, fix = "Replaced the door operator and tested it.") {
  await inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const lead = await memberNamed(tx, orgId, "Alex Rivera");
    const owner = await memberNamed(tx, orgId, "Facilities team");
    const leadActor: Actor = { kind: "staff", memberId: lead.id, role: "lead" };
    const ownerActor: Actor = { kind: "staff", memberId: owner.id, role: "owner" };

    // Layer 3, as db/seed.ts records it: the approval event (the proposed spans, accepted as they are) plus its
    // projection, in one transaction.
    const [proposed] = await tx.select({ payload: caseEvents.payload }).from(caseEvents)
      .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "redaction_proposed")))
      .orderBy(desc(caseEvents.seq)).limit(1);
    const approvedAt = new Date();
    await appendCaseEvent(tx, {
      orgId, caseId, type: "redaction_approved", actorKind: "staff", actorId: lead.id,
      payload: { spans: proposed?.payload.spans ?? [] }, createdAt: approvedAt,
    });
    await tx.update(cases).set({ redactionApprovedAt: approvedAt }).where(eq(cases.id, caseId));

    await transition(tx, orgId, caseId, {
      kind: "triage", priorityArea: "built_environment", publicSummary: "A door at a branch entrance did not open.",
    }, leadActor);
    await transition(tx, orgId, caseId, { kind: "assign", memberId: owner.id }, leadActor);
    await transition(tx, orgId, caseId, { kind: "log_fix", description: fix }, ownerActor);
  });
}

/** Close a new case as a duplicate `daysAgo` days in the past (like the seed's historical dates). */
export async function closeCaseInThePast(slug: string, ref: string, daysAgo: number) {
  await inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const lead = await memberNamed(tx, orgId, "Alex Rivera");
    await transition(tx, orgId, caseId, { kind: "close", reason: "duplicate" },
      { kind: "staff", memberId: lead.id, role: "lead" }, { at: new Date(Date.now() - daysAgo * DAY) });
  });
}
