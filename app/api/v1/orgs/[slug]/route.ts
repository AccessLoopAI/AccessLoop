// GET /api/v1/orgs/{slug} (docs/domain.md §4.1): an organization's public profile and the report form's answers, so
// the Expo reporter app (Wave 3) can open the form for a slug or a location QR link. The same public facts as
// /p/{slug} (ACR s.9(1), s.9(3), s.14(2)), counted in the same rate-limit bucket. No cookies, never cached.
// ?loc={id}: the poster's place (Phase 7 T4.5), looked up only inside this slug's org, as the web form does.
import { apiError, apiJson, apiRateLimit } from "@/lib/api/v1/http";
import { orgBody } from "@/lib/api/v1/reporter";
import { findReportLocation } from "@/lib/locations/store";
import { getPublicOrg } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(request: Request, { params }: Ctx): Promise<Response> {
  const limited = await apiRateLimit("public_report");
  if (limited) return limited;
  const { slug } = await params;
  let org;
  try {
    org = await getPublicOrg(slug);
  } catch (err) {
    console.error(`[api] could not look up an organization (${err instanceof Error ? err.name : "UnknownError"})`);
    return apiError(500, "failed");
  }
  if (!org) return apiError(404, "not_found", { message: "We couldn't find this organization." });
  // Exactly as the web form reads it: one `loc`, or none (a repeated `loc` is ignored, like any id that is not a
  // location in use of this org).
  const locs = new URL(request.url).searchParams.getAll("loc");
  const loc = locs.length === 1 ? locs[0] : null;
  // A place is a convenience: if it can't be read, the profile still answers (with no place).
  const place = loc
    ? await findReportLocation(org.id, loc).catch((err: unknown) => {
        console.error(`[api] could not read a poster location (${err instanceof Error ? err.name : "UnknownError"})`);
        return null;
      })
    : null;
  return apiJson(orgBody(org, place));
}
