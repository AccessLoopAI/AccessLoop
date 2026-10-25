// Server loader for lib/metrics: reads the org's cases and their events INSIDE withOrg (RLS) and hands them to the
// pure functions. Server-only (Node runtime): it imports the database client. The org always comes from the server
// (requireStaff(), resolvePublishedReport()), never from a request. The transaction half (loadMetricCasesTx) lives
// in lib/metrics/load-tx.ts, which never imports the client, so code that already holds a tx can use it anywhere.
import { withOrg, type TenantCtx } from "@/db/tenant";
import { computeDashboardMetrics, type DashboardMetrics } from "./compute";
import { loadMetricCasesTx } from "./load-tx";
import type { Period } from "./period";
import type { MetricCase } from "./replay";

export { loadMetricCasesTx } from "./load-tx";

/** The same, in its own withOrg() transaction. `ctx.orgId` must be resolved on the server. */
export function loadMetricCases(ctx: TenantCtx): Promise<MetricCase[]> {
  return withOrg(ctx, (tx) => loadMetricCasesTx(tx, ctx.orgId));
}

/** The dashboard's numbers for the signed-in staff member's org (pass `requireStaff()`'s result). */
export async function loadDashboardMetrics(
  staff: { orgId: string; role: "lead" | "owner" | "auditor" },
  period: Period,
  now: Date = new Date(),
): Promise<{ cases: MetricCase[]; metrics: DashboardMetrics }> {
  const all = await loadMetricCases({ orgId: staff.orgId, role: staff.role });
  return { cases: all, metrics: computeDashboardMetrics({ cases: all, period, now }) };
}
