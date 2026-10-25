// The staff plain-text download of a report (lead and auditor, any state; a draft says DRAFT at the top).
// proxy.ts guards /app/*; this checks the member and the org again (owners and other orgs: 404).
import { getStaff } from "@/lib/auth/staff";
import { loadStaffReport } from "@/lib/report/access";
import { plainTextResponse, reportTextResponse } from "@/lib/report/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await getStaff();
  if (!staff || (staff.role !== "lead" && staff.role !== "auditor")) return plainTextResponse(404, "Not found.");
  const loaded = await loadStaffReport(staff, (await params).id);
  if (!loaded) return plainTextResponse(404, "Not found.");
  return reportTextResponse(loaded.report);
}
