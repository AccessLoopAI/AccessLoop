// E2E-only fixture (never imported by the app) for e2e/similar-barriers.spec.ts: approve a NEW case's proposed
// redaction as it is and triage it with a public summary of the test's choosing, through the frozen core only
// (appendCaseEvent, transition), like moveCase in e2e/fixtures/cases.ts. It shares the app's one db/client pool.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { caseEvents, cases, orgMembers, orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { appendCaseEvent } from "@/lib/case-events";
import type { PriorityArea } from "@/lib/report/headings";
import { transition } from "@/lib/state-machine";

/** Approve the proposed spans and triage `ref` as `area` with `publicSummary`, as the lead "Alex Rivera". */
export async function triageWithSummary(slug: string, ref: string, publicSummary: string, area: PriorityArea = "built_environment") {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!org) throw new Error(`org ${slug} is not in the database (run npm run local:setup)`);
  await withOrg({ orgId: org.id, role: "system" }, async (tx) => {
    const [c] = await tx.select({ id: cases.id }).from(cases).where(and(eq(cases.orgId, org.id), eq(cases.ref, ref))).limit(1);
    if (!c) throw new Error(`case ${ref} not found in ${slug}`);
    const members = await tx.select().from(orgMembers).where(eq(orgMembers.orgId, org.id));
    const lead = members.find((m) => m.displayName.startsWith("Alex Rivera"));
    if (!lead) throw new Error("no member named Alex Rivera");
    const [proposed] = await tx.select({ payload: caseEvents.payload }).from(caseEvents)
      .where(and(eq(caseEvents.caseId, c.id), eq(caseEvents.type, "redaction_proposed")))
      .orderBy(desc(caseEvents.seq)).limit(1);
    const approvedAt = new Date();
    await appendCaseEvent(tx, {
      orgId: org.id, caseId: c.id, type: "redaction_approved", actorKind: "staff", actorId: lead.id,
      payload: { spans: proposed?.payload.spans ?? [] }, createdAt: approvedAt,
    });
    await tx.update(cases).set({ redactionApprovedAt: approvedAt, needsManualRedaction: false }).where(eq(cases.id, c.id));
    await transition(tx, org.id, c.id, { kind: "triage", priorityArea: area, publicSummary }, { kind: "staff", memberId: lead.id, role: "lead" });
  });
}
