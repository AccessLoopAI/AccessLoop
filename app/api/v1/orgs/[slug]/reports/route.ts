// POST /api/v1/orgs/{slug}/reports (docs/domain.md §4.1): "Send report" for the Expo reporter app. The same steps as
// submitReport (app/o/[orgSlug]/report/actions.ts) through the same lib/intake/submit.ts: the intake_submit rate
// limit, the org from the slug (never from the body), zod, then saveWebReport (the email checked, the org's daily cap
// counted, redaction run again on the server, the preview token used only if this server made it for exactly this
// text, the frozen createCase(), the acknowledgement email when one was given, sent after commit). It never calls the AI.
//
// The 201 answer is the ONLY place the receipt code is ever returned (domain §4: shown once): no other endpoint
// gives it back, and it is never in a URL, a cookie or a log. No cookies are set; the answer is never cached.
import { apiError, apiJson, apiRateLimit, fieldsOf, readJsonBody } from "@/lib/api/v1/http";
import { ReportBody, receiptBody, toSubmitRequest } from "@/lib/api/v1/reporter";
import { saveWebReport } from "@/lib/intake/submit";
import { getPublicOrg } from "@/lib/orgs";
import { orgFullMessage } from "@/lib/rate-limit-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const limited = await apiRateLimit("intake_submit");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = ReportBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, "invalid_request", { fields: fieldsOf(parsed.error) });

  let org;
  try {
    org = await getPublicOrg((await params).slug);
  } catch (err) {
    console.error(`[api] could not look up an organization (${err instanceof Error ? err.name : "UnknownError"})`);
    return apiError(500, "failed", { message: "We could not send your report just now. Please try again." });
  }
  if (!org) return apiError(404, "not_found", { message: "We couldn't find this organization." });

  const saved = await saveWebReport(org.id, toSubmitRequest(parsed.data));
  if (!saved.ok) {
    if (saved.problem === "email") return apiError(400, "invalid_email", { fields: ["email"] });
    // The org's daily cap (domain §9): nothing was saved; the message names the org's other ways to reach it.
    if (saved.problem === "org_full") return apiError(429, "org_full", { message: orgFullMessage(org) });
    return apiError(500, "failed", { message: "We could not send your report just now. Please try again." });
  }
  return apiJson(receiptBody(org, saved), 201);
}
