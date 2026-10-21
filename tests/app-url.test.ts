// lib/app-url.ts (Phase 7 T3 item 9): the public base URL is read at run time from APP_URL, then Vercel's own
// variables, then this computer; never NEXT_PUBLIC_APP_URL (inlined at build time) and never the Host header.
import { describe, expect, it } from "vitest";
import { absoluteUrl, appBaseUrl } from "@/lib/app-url";

describe("appBaseUrl", () => {
  it("prefers APP_URL, without a trailing slash", () => {
    expect(appBaseUrl({ APP_URL: "https://accessloop.example.ca/", VERCEL_URL: "x.vercel.app" })).toBe("https://accessloop.example.ca");
    expect(appBaseUrl({ APP_URL: "  https://accessloop.example.ca  " })).toBe("https://accessloop.example.ca");
  });

  it("on a Vercel production deployment: the project's production domain", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "accessloop.example.ca", VERCEL_URL: "accessloop-abc123.vercel.app" };
    expect(appBaseUrl(env)).toBe("https://accessloop.example.ca");
  });

  it("on a preview: the deployment's own URL, never production's", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_PRODUCTION_URL: "accessloop.example.ca", VERCEL_URL: "accessloop-git-x.vercel.app" };
    expect(appBaseUrl(env)).toBe("https://accessloop-git-x.vercel.app");
    expect(appBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "accessloop.example.ca" })).toBe("https://accessloop.example.ca");
    expect(appBaseUrl({ VERCEL_URL: "https://already-has-a-scheme.vercel.app" })).toBe("https://already-has-a-scheme.vercel.app");
  });

  it("falls back to this computer on PORT (else 3000), and ignores NEXT_PUBLIC_APP_URL", () => {
    expect(appBaseUrl({})).toBe("http://localhost:3000");
    expect(appBaseUrl({ PORT: "3101" })).toBe("http://localhost:3101");
    expect(appBaseUrl({ PORT: "not a port" })).toBe("http://localhost:3000");
    expect(appBaseUrl({ NEXT_PUBLIC_APP_URL: "https://stale-build-value.example" })).toBe("http://localhost:3000");
  });
});

describe("absoluteUrl", () => {
  it("joins the base and a path", () => {
    expect(absoluteUrl("/check", { APP_URL: "https://accessloop.example.ca" })).toBe("https://accessloop.example.ca/check");
    expect(absoluteUrl("verify/x", { PORT: "3101" })).toBe("http://localhost:3101/verify/x");
  });
});
