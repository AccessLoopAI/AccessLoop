// Everything /app/dashboard shows, in ONE withOrg transaction (docs/domain.md §10): the org's cases and events, the
// metrics computed from them, the evidence-integrity check over the period's cases, and the org's entity class for
// the deadline banner. Server-only. The org always comes from the signed-in staff member (requireStaff()).
import { eq } from "drizzle-orm";
import { orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { computeDashboardMetrics, type DashboardMetrics } from "./compute";
import { nextDeadline, type Deadline, type EntityClass } from "./deadline";
import { verifyPeriodChains, type IntegrityCheck } from "./integrity";
import { loadMetricCasesTx } from "./load";
import type { Period } from "./period";

export interface DashboardData {
  metrics: DashboardMetrics;
  integrity: IntegrityCheck;
  deadline: Deadline;
  entityClass: EntityClass;
}

export async function loadDashboard(
  staff: { orgId: string; role: "lead" | "auditor" },
  period: Period,
  now: Date = new Date(),
): Promise<DashboardData> {
  return withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    // orgs is not tenant-scoped (domain §9); the id is the session's.
    const [org] = await tx.select({ entityClass: orgs.entityClass }).from(orgs).where(eq(orgs.id, staff.orgId)).limit(1);
    const entityClass: EntityClass = org?.entityClass ?? "private_large";
    const cases = await loadMetricCasesTx(tx, staff.orgId);
    const metrics = computeDashboardMetrics({ cases, period, now });
    const integrity = await verifyPeriodChains(tx, staff.orgId, period, metrics.total.total, cases, now);
    return { metrics, integrity, deadline: nextDeadline(entityClass, now), entityClass };
  });
}
