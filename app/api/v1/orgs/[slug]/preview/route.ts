// POST /api/v1/orgs/{slug}/preview (docs/domain.md §4.1): the web form's step 3 "Next" for the Expo reporter app.
// The same steps as previewReport (app/o/[orgSlug]/report/actions.ts): the intake_preview rate limit, the org from
// the slug (never from the body), zod, then buildPreview, which redacts the text (layers 1 and 2) and summarizes the
// REDACTED text. The answer is the summary and the sealed preview token, never the suggested areas or the layer-2
// values. With aiOptOut nothing is sent to the AI. Past the hour's AI budget (AI_GLOBAL_HOURLY_LIMIT, lib/rate-limit.ts),
// or when it can't be checked, no AI runs either: both are null and `aiPaused` is true (the web form's manual path,
// domain §9). No cookies, never cached; the body is never logged.
import { aiRequestContext } from "@/lib/ai/context";
import { apiError, apiJson, apiRateLimit, fieldsOf, readJsonBody } from "@/lib/api/v1/http";
import { PreviewBody, toPreviewRequest } from "@/lib/api/v1/reporter";
import { buildPreview } from "@/lib/intake/pipeline";
import { getPublicOrg } from "@/lib/orgs";
import { logRateLimitFailure, reserveAiForPreview } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(request: Request, { params }: Ctx): Promise<Response> {
  const limited = await apiRateLimit("intake_preview");
  if (limited) return limited;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = PreviewBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, "invalid_request", { fields: fieldsOf(parsed.error) });

  try {
    const org = await getPublicOrg((await params).slug);
    if (!org) return apiError(404, "not_found", { message: "We couldn't find this organization." });
    const req = toPreviewRequest(parsed.data);
    // The same AI budget as the web form's preview (app/o/[orgSlug]/report/actions.ts): reserved before any AI runs;
    // past it, or if it can't be checked, no AI and no token, so the report takes the manual path when sent.
    if (!req.aiOptOut) {
      let budget = false;
      try {
        budget = (await reserveAiForPreview(req.locationDetail !== "")).ok;
      } catch (err) {
        logRateLimitFailure("could not check the AI budget (api)", err);
      }
      if (!budget) return apiJson({ summary: null, previewToken: null, aiPaused: true });
    }
    // The Host tells the claude-cli backend whether this is a local request (domain §6.1); fake and api ignore it.
    const preview = await buildPreview(org.id, req, aiRequestContext(request.headers));
    return apiJson({ summary: preview.summary, previewToken: preview.token });
  } catch (err) {
    console.error(`[api] could not make a preview (${err instanceof Error ? err.name : "UnknownError"})`);
    return apiError(500, "failed", { message: "We could not summarize your report just now. You can still send it." });
  }
}
