// CORS for the Expo app's WEB build during local development, and nothing else (docs/domain.md §4.1; Phase 7
// integration of T8, docs/decisions.md 2026-10-20). `npx expo start --web` serves the app on http://localhost:8081, a
// different origin from the API on http://localhost:3000, so a browser sends a preflight (JSON bodies and the
// Authorization header are not "simple") and blocks every call unless the API answers it. A native app is not a
// browser and needs none of this.
//
// Allowed ONLY when all of these hold, so a deployment can never be reached cross-origin by any page:
//   - AUTH_MODE=local and not on Vercel (as the local sign-in);
//   - the request is for this computer and came through no proxy or tunnel from elsewhere (localRequestAllowed:
//     the Host and every forwarding header, lib/auth/local-request.ts);
//   - its Origin is exactly http://localhost:8081.
// No credentials are allowed (the API sets and reads no cookies; the app sends `credentials: "omit"`), so the receipt
// code still travels only in the Authorization header the app itself adds. No database and no body: proxy.ts calls it.
import { localRequestAllowed, type HeaderReader } from "@/lib/auth/local-request";

/** The Expo web dev server's origin (`npx expo start --web`, mobile/README.md). */
export const EXPO_WEB_DEV_ORIGIN = "http://localhost:8081";

/** Every method /api/v1 answers (GET and POST), plus the preflight itself. */
export const CORS_ALLOW_METHODS = "GET, POST, OPTIONS";
/** The request headers the app sends (mobile/src/api.ts): Content-Type: application/json and the receipt code. */
export const CORS_ALLOW_HEADERS = "Accept, Authorization, Content-Type";
/** Headers the app may read on an answer: the wait after a 429 and the scheme of a 401. */
export const CORS_EXPOSE_HEADERS = "Retry-After, WWW-Authenticate";
/** How long a browser may reuse a preflight answer, in seconds. */
export const CORS_MAX_AGE_S = 600;

/** The origin to allow for this request (always EXPO_WEB_DEV_ORIGIN), or null: send no CORS headers at all. */
export function localDevCorsOrigin(headers: HeaderReader): string | null {
  if (process.env.AUTH_MODE !== "local" || process.env.VERCEL) return null;
  if (headers.get("origin") !== EXPO_WEB_DEV_ORIGIN) return null;
  if (!localRequestAllowed(headers)) return null;
  return EXPO_WEB_DEV_ORIGIN;
}

export type ApiCors =
  /** Answer the preflight here, with these headers (204, no body). */
  | { preflight: true; headers: Record<string, string> }
  /** Let the route answer, and add these headers to its response. */
  | { preflight: false; headers: Record<string, string> };

/**
 * What proxy.ts does for a request to /api/v1: null = nothing (no CORS headers, the route answers as always, and a
 * cross-origin browser call stays blocked); otherwise answer the preflight, or mark the route's answer as readable
 * by the Expo web build.
 */
export function apiV1Cors(request: { method: string; headers: HeaderReader }): ApiCors | null {
  const origin = localDevCorsOrigin(request.headers);
  if (!origin) return null;
  const base = { "access-control-allow-origin": origin, vary: "Origin" };
  if (request.method === "OPTIONS" && request.headers.get("access-control-request-method") !== null) {
    return {
      preflight: true,
      headers: {
        ...base,
        "access-control-allow-methods": CORS_ALLOW_METHODS,
        "access-control-allow-headers": CORS_ALLOW_HEADERS,
        "access-control-max-age": String(CORS_MAX_AGE_S),
        "cache-control": "no-store",
      },
    };
  }
  return { preflight: false, headers: { ...base, "access-control-expose-headers": CORS_EXPOSE_HEADERS } };
}
