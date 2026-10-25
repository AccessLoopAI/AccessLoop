// "Download evidence bundle": the public evidence file of a PUBLISHED report (anything else: 404), as a JSON
// attachment (lib/report/bundle.ts: public-safe fields only). Rate-limited like the plain-text download (it shares
// that route's bucket, report_text).
import { limitRequest, logRateLimitFailure } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { loadPublishedBundle } from "@/lib/report/access";
import { bundleFilename, bundleJson } from "@/lib/report/bundle";
import { plainTextResponse } from "@/lib/report/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  try {
    if (!(await limitRequest("report_text")).ok) return plainTextResponse(429, RATE_LIMITED_MESSAGE);
  } catch (err) {
    logRateLimitFailure("evidence bundle download", err);
    return plainTextResponse(503, "The download isn't available just now. Please try again in a few minutes.");
  }
  const { orgSlug, id } = await params;
  const found = await loadPublishedBundle(orgSlug, id, new Date());
  if (!found) return plainTextResponse(404, "Not found.");
  return new Response(bundleJson(found.bundle), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename="${bundleFilename(found.report.title)}"`,
    },
  });
}
