// The plumbing of the reporter JSON API (/api/v1, docs/domain.md §4.1; Phase 7 T4.6), for the Expo reporter app of
// Wave 3: JSON in and out, one error shape, never cached, no cookies (nothing is set or read: a receipt code travels
// only in the Authorization header, never in a URL). Server-only. Never logs request bodies, receipt codes, emails
// or IPs.
//
// Browsers: every POST must be `Content-Type: application/json` and the status call sends an Authorization header,
// so a cross-site page can only reach the API after a CORS preflight, which the API never answers with
// Access-Control-Allow-* headers. A native app is not a browser and is not affected. The one exception is local
// development: the Expo web build on http://localhost:8081, in AUTH_MODE=local only (proxy.ts, lib/api/v1/cors.ts).
import type { z } from "zod";
import { RATE_LIMITS, limitRequest, logRateLimitFailure, type RateLimitRoute } from "@/lib/rate-limit";
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import { normalizeReceiptCode } from "@/lib/receipt-code";

/** The largest JSON body the API reads (a report is at most ~6,000 characters, a preview token 16,000). */
export const API_MAX_BODY_BYTES = 64 * 1024;

/** `Authorization: Receipt XXXX-XXXX-XXXX-XXXX` (the scheme name is case-insensitive, RFC 9110 §11.1). */
export const RECEIPT_AUTH_SCHEME = "Receipt";

export type ApiErrorCode =
  | "invalid_request"
  | "invalid_json"
  | "unsupported_media_type"
  | "too_large"
  | "invalid_email"
  | "missing_code"
  | "not_found"
  | "already_answered"
  | "comment_too_long"
  | "rate_limited"
  | "org_full"
  | "unavailable"
  | "failed";

/** Plain words an app can show as they are (grade 6-8, like the web pages). Callers may give a more exact one. */
export const API_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  invalid_request: "Part of the request could not be read. Check the answers and try again.",
  invalid_json: "The request could not be read. Send it as JSON.",
  unsupported_media_type: "Send the request as JSON (Content-Type: application/json).",
  too_large: "The request is too large.",
  invalid_email: "Check your email address. It should look like name@example.com.",
  missing_code: "Send your receipt code in the Authorization header: Receipt XXXX-XXXX-XXXX-XXXX.",
  not_found: "We couldn't find it.",
  already_answered: "This question is already answered. Your report's status shows where it is now.",
  comment_too_long: "Your comment is too long.",
  rate_limited: RATE_LIMITED_MESSAGE,
  // The route gives orgFullMessage(org) instead, which names the org's phone and email (ACR s.9(3)).
  org_full: "This form has taken all the reports it can for today. Please try again tomorrow, or contact the organization another way.",
  unavailable: "We could not do this just now. Please try again.",
  failed: "We could not do this just now. Please try again.",
};

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

/** A JSON response that is never cached and never sets a cookie. */
export function apiJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...headers } });
}

/** The one error shape: `{ "error": { "code", "message", "fields"? } }`. */
export function apiError(
  status: number,
  code: ApiErrorCode,
  opts: { message?: string; fields?: string[]; headers?: Record<string, string> } = {},
): Response {
  const error: { code: ApiErrorCode; message: string; fields?: string[] } = { code, message: opts.message ?? API_ERROR_MESSAGES[code] };
  if (opts.fields?.length) error.fields = opts.fields;
  return apiJson({ error }, status, opts.headers);
}

/**
 * The names of the fields a zod error is about (`text`, `locationKind`, or an unknown key), never the values or
 * zod's own wording, so an app can point at the field and nothing typed is echoed back.
 */
export function fieldsOf(error: z.ZodError): string[] {
  const out = new Set<string>();
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") for (const k of issue.keys) out.add([...issue.path, k].join("."));
    else out.add(issue.path.length ? issue.path.join(".") : "(body)");
  }
  return [...out].slice(0, 20);
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; response: Response };

/**
 * The request's JSON body: `Content-Type: application/json` (else 415), at most `maxBytes` (else 413, read as a stream
 * so a large body is never held whole), valid UTF-8 JSON (else 400 invalid_json).
 */
export async function readJsonBody(request: Request, maxBytes = API_MAX_BODY_BYTES): Promise<BodyResult> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { ok: false, response: apiError(415, "unsupported_media_type") };
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: apiError(413, "too_large") };
  if (!request.body) return { ok: false, response: apiError(400, "invalid_json") };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, response: apiError(413, "too_large") };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json") };
  }
}

/**
 * The NORMALIZED receipt code from `Authorization: Receipt <code>` (any case, with or without hyphens or spaces,
 * as /check accepts it), or null when the header is missing, uses another scheme or holds no well-formed code.
 */
export function receiptCodeFromAuthorization(value: string | null): string | null {
  if (!value || value.length > 200) return null;
  const m = /^\s*([A-Za-z]+)\s+(.+?)\s*$/.exec(value);
  if (!m || m[1].toLowerCase() !== RECEIPT_AUTH_SCHEME.toLowerCase()) return null;
  return normalizeReceiptCode(m[2]);
}

/** 401 with the scheme to use. */
export function missingCode(): Response {
  return apiError(401, "missing_code", { headers: { "www-authenticate": `${RECEIPT_AUTH_SCHEME} realm="accessloop"` } });
}

/** Seconds until the route's current fixed window ends (windows are aligned to the epoch, lib/rate-limit.ts). */
export function retryAfterSeconds(route: RateLimitRoute, now: number = Date.now()): number {
  const windowMs = RATE_LIMITS[route].windowMs;
  return Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
}

/**
 * Count this request against `route`, exactly like the web pages and server actions do (the same buckets: a
 * person's web and app requests from one connection share them). Returns the response to send when the request
 * may not go on (429 over the limit, 503 when the limit could not be checked), else null.
 */
export async function apiRateLimit(route: RateLimitRoute): Promise<Response | null> {
  try {
    if ((await limitRequest(route)).ok) return null;
    return apiError(429, "rate_limited", { headers: { "retry-after": String(retryAfterSeconds(route)) } });
  } catch (err) {
    logRateLimitFailure(`could not check the ${route} limit (api)`, err);
    return apiError(503, "unavailable");
  }
}
