// POST /api/v1/retest (docs/domain.md §3, §4.1): the reporter's answer to "Does it work for you now?" from the Expo
// reporter app, or "Don't contact me about this again" at any time. The receipt code comes ONLY from
// `Authorization: Receipt XXXX-XXXX-XXXX-XXXX`, never from the URL or the body. The same rules as /r/{code}'s server
// action through the same lib/retest-answer.ts, in the same verdict rate-limit bucket: the case found again from the
// code on every call, the frozen state machine deciding, a stale second answer refused (409) without changing
// anything. Only this (a reporter holding the code) can produce "verified". No cookies, never cached; the code and
// the comment are never logged.
import { apiError, apiJson, apiRateLimit, fieldsOf, missingCode, readJsonBody, receiptCodeFromAuthorization } from "@/lib/api/v1/http";
import { RetestBody, retestAnsweredBody, statusBody } from "@/lib/api/v1/reporter";
import { CHECK_MESSAGES } from "@/lib/check-code";
import { getPublicOrg } from "@/lib/orgs";
import { loadReporterCase } from "@/lib/reporter-case";
import { RETEST_COMMENT_MAX, RETEST_COMMENT_TOO_LONG_ERROR } from "@/lib/retest";
import { saveRetestAnswer } from "@/lib/retest-answer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const limited = await apiRateLimit("verdict");
  if (limited) return limited;
  const normalized = receiptCodeFromAuthorization(request.headers.get("authorization"));
  if (!normalized) return missingCode();
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = RetestBody.safeParse(body.value);
  if (!parsed.success) return apiError(400, "invalid_request", { fields: fieldsOf(parsed.error) });
  const { answer, comment } = parsed.data;
  // Never cut short silently: a comment over the limit is refused, as on /r/{code}.
  if (comment.length > RETEST_COMMENT_MAX) {
    return apiError(400, "comment_too_long", { message: RETEST_COMMENT_TOO_LONG_ERROR, fields: ["comment"] });
  }

  const saved = await saveRetestAnswer(normalized, { source: "auto", answer, comment });
  switch (saved.kind) {
    case "not_found":
      return apiError(404, "not_found", { message: CHECK_MESSAGES.unknown });
    case "already_answered":
      return apiError(409, "already_answered");
    case "failed":
      return apiError(500, "failed", { message: "We could not save your answer just now. Please try again." });
  }

  // Where the report is now (a verified report's code keeps working for 30 days, so this finds it again).
  let report = null;
  try {
    const now = await loadReporterCase(normalized);
    if (now) report = statusBody(now, await getPublicOrg(now.orgSlug));
  } catch (err) {
    console.error(`[api] could not read a report after an answer (${err instanceof Error ? err.name : "UnknownError"})`);
  }
  return apiJson(retestAnsweredBody(answer, report));
}
