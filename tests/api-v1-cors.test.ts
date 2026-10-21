// CORS on /api/v1 for the Expo app's web build (lib/api/v1/cors.ts, proxy.ts; docs/domain.md §4.1): only the origin
// http://localhost:8081, only in AUTH_MODE=local on a request for this computer, never on Vercel, never through a
// proxy or tunnel from elsewhere, never with credentials; a preflight is answered by the proxy, any other request
// goes on to its route with the headers added; everything else is exactly as before (no CORS headers at all).
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORS_ALLOW_HEADERS, EXPO_WEB_DEV_ORIGIN, apiV1Cors, localDevCorsOrigin } from "@/lib/api/v1/cors";
import { proxy, config } from "@/proxy";

const EXPO = EXPO_WEB_DEV_ORIGIN;
const preflight = { "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" };

beforeEach(() => {
  vi.stubEnv("AUTH_MODE", "local");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-0123456789abcdefghijkl");
});
afterEach(() => vi.unstubAllEnvs());

const h = (headers: Record<string, string>) => new Headers({ host: "localhost:3000", ...headers });

describe("localDevCorsOrigin", () => {
  it("allows exactly the Expo web origin, for a local request in AUTH_MODE=local", () => {
    expect(EXPO).toBe("http://localhost:8081");
    expect(localDevCorsOrigin(h({ origin: EXPO }))).toBe(EXPO);
    // What `next start` adds to a plain local request (lib/auth/local-request.ts) does not change that.
    expect(localDevCorsOrigin(h({ origin: EXPO, "x-forwarded-host": "localhost:3000", "x-forwarded-for": "127.0.0.1" }))).toBe(EXPO);
    expect(localDevCorsOrigin(new Headers({ host: "127.0.0.1:3000", origin: EXPO }))).toBe(EXPO);
  });

  it.each([
    ["no Origin", {}],
    ["another origin", { origin: "https://evil.example" }],
    ["another local port", { origin: "http://localhost:3001" }],
    ["https on the Expo port", { origin: "https://localhost:8081" }],
    ["the Expo origin with a path", { origin: "http://localhost:8081/" }],
    ["127.0.0.1 instead of localhost", { origin: "http://127.0.0.1:8081" }],
    ["a sandboxed page", { origin: "null" }],
  ])("refuses %s", (_what, headers) => {
    expect(localDevCorsOrigin(h(headers as Record<string, string>))).toBeNull();
  });

  it("refuses a request for another host, or one forwarded from elsewhere (a tunnel or reverse proxy)", () => {
    expect(localDevCorsOrigin(new Headers({ host: "accessloop.example", origin: EXPO }))).toBeNull();
    expect(localDevCorsOrigin(h({ origin: EXPO, "x-forwarded-host": "abc.ngrok.app" }))).toBeNull();
    expect(localDevCorsOrigin(h({ origin: EXPO, "x-forwarded-for": "203.0.113.9" }))).toBeNull();
    expect(localDevCorsOrigin(h({ origin: EXPO, forwarded: "for=198.51.100.7;host=example.com" }))).toBeNull();
  });

  it("refuses outside AUTH_MODE=local, and always on Vercel", () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    expect(localDevCorsOrigin(h({ origin: EXPO }))).toBeNull();
    vi.stubEnv("AUTH_MODE", "local");
    vi.stubEnv("VERCEL", "1");
    expect(localDevCorsOrigin(h({ origin: EXPO }))).toBeNull();
  });
});

describe("apiV1Cors", () => {
  it("a preflight from the Expo web origin: the methods and headers the app uses, no credentials", () => {
    const r = apiV1Cors({ method: "OPTIONS", headers: h({ origin: EXPO, ...preflight }) });
    expect(r).toEqual({
      preflight: true,
      headers: {
        "access-control-allow-origin": EXPO,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": CORS_ALLOW_HEADERS,
        "access-control-max-age": "600",
        "cache-control": "no-store",
        vary: "Origin",
      },
    });
    expect(CORS_ALLOW_HEADERS.toLowerCase().split(", ")).toEqual(["accept", "authorization", "content-type"]);
    expect(JSON.stringify(r)).not.toMatch(/credentials/i);
  });

  it("an ordinary call from it: the route answers, readable by the app (Retry-After and WWW-Authenticate too)", () => {
    expect(apiV1Cors({ method: "GET", headers: h({ origin: EXPO }) })).toEqual({
      preflight: false,
      headers: { "access-control-allow-origin": EXPO, "access-control-expose-headers": "Retry-After, WWW-Authenticate", vary: "Origin" },
    });
    // OPTIONS with no Access-Control-Request-Method is not a preflight: the route's own OPTIONS answers it.
    expect(apiV1Cors({ method: "OPTIONS", headers: h({ origin: EXPO }) })?.preflight).toBe(false);
  });

  it("anything else: nothing at all", () => {
    expect(apiV1Cors({ method: "OPTIONS", headers: h({ origin: "https://evil.example", ...preflight }) })).toBeNull();
    expect(apiV1Cors({ method: "POST", headers: h({}) })).toBeNull();
  });
});

describe("proxy.ts on /api/v1", () => {
  const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? "GET", headers: h(init.headers ?? {}) });

  it("runs on /api/v1 (and still on /app), and nowhere else", () => {
    expect(config.matcher).toEqual(["/app/:path*", "/api/v1/:path*"]);
  });

  it("answers the Expo web build's preflight itself: 204, no body", async () => {
    const res = proxy(req("/api/v1/orgs/maple-harbour/reports", { method: "OPTIONS", headers: { origin: EXPO, ...preflight } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(EXPO);
    expect(res.headers.get("access-control-allow-headers")).toBe(CORS_ALLOW_HEADERS);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(await res.text()).toBe("");
  });

  it("lets every API request through to its route (never the sign-in redirect), adding the headers only for that origin", () => {
    const app = proxy(req("/api/v1/status", { headers: { origin: EXPO, authorization: "Receipt ABCD-EFGH-JKLM-NPQR" } }));
    expect(app.status).toBe(200);
    expect(app.headers.get("x-middleware-next")).toBe("1");
    expect(app.headers.get("access-control-allow-origin")).toBe(EXPO);
    expect(app.headers.get("location")).toBeNull();

    for (const other of [
      proxy(req("/api/v1/status", { headers: { origin: "https://evil.example" } })),
      proxy(req("/api/v1/orgs/maple-harbour", { method: "OPTIONS", headers: { origin: "https://evil.example", ...preflight } })),
      proxy(req("/api/v1/orgs/maple-harbour")),
    ]) {
      expect(other.headers.get("x-middleware-next")).toBe("1");
      expect(other.headers.get("access-control-allow-origin")).toBeNull();
      expect(other.headers.get("location")).toBeNull();
    }
  });

  it("on Vercel, even the Expo origin gets nothing", () => {
    vi.stubEnv("VERCEL", "1");
    const res = proxy(req("/api/v1/orgs/maple-harbour", { method: "OPTIONS", headers: { origin: EXPO, ...preflight } }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("staff pages are unchanged: no session still goes to /sign-in", () => {
    const res = proxy(req("/app/inbox", { headers: { origin: EXPO } }));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/sign-in");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
