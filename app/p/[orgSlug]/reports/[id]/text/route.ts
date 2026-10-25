// The public plain-text download of a PUBLISHED report (anything else: 404). Rate-limited like every public route.
import { limitRequest, logRateLimitFailure } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { loadPublishedReport } from "@/lib/report/access";
import { plainTextResponse, reportTextResponse } from "@/lib/report/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  try {
    if (!(await limitRequest("report_text")).ok) return plainTextResponse(429, RATE_LIMITED_MESSAGE);
  } catch (err) {
    logRateLimitFailure("report text download", err);
    return plainTextResponse(503, "The download isn't available just now. Please try again in a few minutes.");
  }
  const { orgSlug, id } = await params;
  const found = await loadPublishedReport(orgSlug, id);
  if (!found) return plainTextResponse(404, "Not found.");
  return reportTextResponse(found.report);
}
