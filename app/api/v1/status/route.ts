// GET /api/v1/status (docs/domain.md §4.1): where a report is, for the Expo reporter app. The receipt code comes ONLY
// from `Authorization: Receipt XXXX-XXXX-XXXX-XXXX`, never from the URL (a code in a query string would end up in
// logs, history and referrers); a `?code=` is ignored. The same lookup as /r/{code} (loadReporterCase: the org from
// the SECURITY DEFINER resolve_receipt(), never from the request) in the same receipt_view rate-limit bucket.
// Unknown, malformed and expired codes get the same 404 (it never says whether a code ever existed). The answer never
// holds the code. No cookies, never cached; the code is never logged.
import { apiError, apiJson, apiRateLimit, missingCode, receiptCodeFromAuthorization } from "@/lib/api/v1/http";
import { statusBody } from "@/lib/api/v1/reporter";
import { getPublicOrg } from "@/lib/orgs";
import { CHECK_MESSAGES } from "@/lib/check-code";
import { loadReporterCase } from "@/lib/reporter-case";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const limited = await apiRateLimit("receipt_view");
  if (limited) return limited;
  const normalized = receiptCodeFromAuthorization(request.headers.get("authorization"));
  if (!normalized) return missingCode();
  try {
    const report = await loadReporterCase(normalized);
    if (!report) return apiError(404, "not_found", { message: CHECK_MESSAGES.unknown });
    return apiJson(statusBody(report, await getPublicOrg(report.orgSlug)));
  } catch (err) {
    console.error(`[api] could not look up a receipt code (${err instanceof Error ? err.name : "UnknownError"})`);
    return apiError(500, "failed", { message: "We could not check your code just now. Please try again." });
  }
}
