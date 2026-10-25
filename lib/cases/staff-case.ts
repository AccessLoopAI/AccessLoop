// Server-only: find a case for a signed-in staff member. Refs repeat across orgs (domain §9), so the lookup is
// ALWAYS by (the staff member's org, ref), inside withOrg() with that org. Owners only get cases assigned to
// them: anything else is "not found", exactly like a ref that doesn't exist.
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { caseEvents, cases } from "@/db/schema";
import type { Staff } from "@/lib/auth/staff";
import { canOpenCase } from "./access";
import { CASE_REF } from "./labels";

export type StaffCaseRow = typeof cases.$inferSelect;

/** The case behind `ref` in the staff member's org, or null (bad ref, other org, or an owner's unassigned case). */
export async function findStaffCase(
  tx: Tx,
  staff: Pick<Staff, "orgId" | "memberId" | "role">,
  ref: string,
  opts: { forUpdate?: boolean } = {},
): Promise<StaffCaseRow | null> {
  if (!CASE_REF.test(ref)) return null;
  const q = tx.select().from(cases).where(and(eq(cases.orgId, staff.orgId), eq(cases.ref, ref))).limit(1);
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  if (!row || !canOpenCase(staff, row)) return null;
  return row;
}

/** The latest event of one type for a case (e.g. the redaction proposal), or null. */
export async function latestEvent(tx: Tx, orgId: string, caseId: string, type: (typeof caseEvents.$inferSelect)["type"]) {
  const [e] = await tx
    .select()
    .from(caseEvents)
    .where(and(eq(caseEvents.orgId, orgId), eq(caseEvents.caseId, caseId), eq(caseEvents.type, type)))
    .orderBy(desc(caseEvents.seq))
    .limit(1);
  return e ?? null;
}
