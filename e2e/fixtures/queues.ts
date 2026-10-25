// E2E-only fixture (never imported by the app) for the staff queues (e2e/queues.spec.ts): triage a case with a
// public summary of the test's own, and assign it with a due date (decision D8), even one in the past, so a test can
// see "Overdue" without waiting. Like e2e/fixtures/cases.ts it uses ONLY the frozen core (withOrg, transition) and
// the app's one db/client pool: never end it in a spec.
import { and, eq } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { cases, orgMembers, orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { dueAtForDate } from "@/lib/metrics/queue";
import { transition, type Actor } from "@/lib/state-machine";

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

async function member(tx: Tx, orgId: string, name: string) {
  const all = await tx.select().from(orgMembers).where(eq(orgMembers.orgId, orgId));
  const m = all.find((x) => x.displayName.startsWith(name));
  if (!m) throw new Error(`no member named ${name}`);
  return m;
}

/** The lead triages an APPROVED case (moveCase(..., "approved")) with this public summary. */
export async function triageWith(slug: string, ref: string, publicSummary: string, area: "built_environment" | "ict" = "built_environment") {
  await inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const lead = await member(tx, orgId, "Alex Rivera");
    const actor: Actor = { kind: "staff", memberId: lead.id, role: "lead" };
    await transition(tx, orgId, caseId, { kind: "triage", priorityArea: area, publicSummary }, actor);
  });
}

/** The lead assigns a TRIAGED (or assigned) case to `who` with the due date `dueOn` (YYYY-MM-DD; null: none). */
export async function assignDue(slug: string, ref: string, who: string, dueOn: string | null) {
  await inCase(slug, ref, async (tx, { orgId, caseId }) => {
    const lead = await member(tx, orgId, "Alex Rivera");
    const to = await member(tx, orgId, who);
    const actor: Actor = { kind: "staff", memberId: lead.id, role: "lead" };
    await transition(tx, orgId, caseId, { kind: "assign", memberId: to.id, dueAt: dueOn ? dueAtForDate(dueOn) : null }, actor);
  });
}

/** The id of a member of the org (the inbox's "Assigned to" values are member ids). */
export async function memberId(slug: string, name: string): Promise<string> {
  const orgId = await orgIdOf(slug);
  return withOrg({ orgId, role: "system" }, async (tx) => (await member(tx, orgId, name)).id);
}
