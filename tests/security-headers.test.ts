// next.config.ts headers() (Phase 7 T3 item 6): the security headers on every response, the staff routes' own
// referrer policy, and a CSP whose enforced part can't break a page while the full baseline is report-only.
// e2e/platform.spec.ts checks the real responses, e2e/csp.spec.ts that no key screen breaks the baseline.
import { describe, expect, it } from "vitest";
import nextConfig, {
  CSP_ENFORCED,
  PUBLIC_REFERRER_POLICY,
  STAFF_REFERRER_POLICY,
  STAFF_SOURCES,
  cspBaseline,
  securityHeaders,
} from "@/next.config";

const asMap = (headers: { key: string; value: string }[]) => Object.fromEntries(headers.map((h) => [h.key, h.value]));

describe("securityHeaders", () => {
  it("sets nosniff, DENY, no camera/microphone/location, the public referrer policy and both CSP headers", () => {
    const h = asMap(securityHeaders({ NODE_ENV: "production" }));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(h["Referrer-Policy"]).toBe("same-origin");
    expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'");
    expect(h["Content-Security-Policy-Report-Only"]).toBe(cspBaseline(false));
    expect(h["Strict-Transport-Security"]).toBeUndefined();
  });

  it("adds HSTS only on Vercel, without includeSubDomains or preload", () => {
    expect(asMap(securityHeaders({ VERCEL: "1" }))["Strict-Transport-Security"]).toBe("max-age=63072000");
  });

  it("enforces only what no page can break, and reports the rest", () => {
    expect(CSP_ENFORCED).not.toMatch(/script-src|style-src|default-src|connect-src|img-src/);
    const base = cspBaseline(false);
    for (const d of ["default-src 'self'", "script-src 'self' 'unsafe-inline'", "connect-src 'self'", "img-src 'self' data: blob:", "frame-ancestors 'none'", "object-src 'none'"]) {
      expect(base).toContain(d);
    }
    expect(base).not.toContain("unsafe-eval");
    expect(cspBaseline(true)).toContain("'unsafe-eval'"); // next dev only
    expect(base).not.toMatch(/report-uri|report-to/); // a report's URL could hold a receipt code
    expect(base).not.toMatch(/https?:/); // no third-party origin
  });
});

describe("headers()", () => {
  it("puts them on every path, then gives the staff routes strict-origin-when-cross-origin (later entries win)", async () => {
    const rules = await nextConfig.headers!();
    expect(rules[0]).toEqual({ source: "/:path*", headers: securityHeaders() });
    expect(rules.slice(1)).toEqual(STAFF_SOURCES.map((source) => ({ source, headers: [{ key: "Referrer-Policy", value: STAFF_REFERRER_POLICY }] })));
    expect(STAFF_SOURCES).toEqual(["/app/:path*", "/sign-in", "/sign-out"]);
    expect(PUBLIC_REFERRER_POLICY).toBe("same-origin");
    expect(STAFF_REFERRER_POLICY).toBe("strict-origin-when-cross-origin");
  });
});
