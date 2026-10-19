import type { NextConfig } from "next";

// cacheComponents/partialPrefetching from the create-next-app@16.4 template are deliberately OFF:
// with Cache Components on, the `dynamic` route segment config is removed and every uncached read
// (cookies, DB) must sit under <Suspense>. AccessLoop pages are per-request (staff session, receipt
// codes) and use `runtime = "nodejs"` + `dynamic = "force-dynamic"`. See docs/decisions.md.
// ---------- Security headers (docs/phase7-prompt.md T3 item 6; docs/decisions.md 2026-10-20) ----------
// Every response: no MIME sniffing, never framed (X-Frame-Options and CSP frame-ancestors), no camera, microphone or
// location (dictation is the device's own keyboard, never the page's), and a referrer policy. HSTS on Vercel builds.
//
// Content-Security-Policy is ENFORCED only for directives no page can break: frame-ancestors, object-src, base-uri,
// form-action (every form posts to this origin). The full baseline is REPORT-ONLY: e2e/csp.spec.ts walks every key
// screen and fails on any report, so it is proven to fit every page; enforcing it is a one-line change, left until
// Wave 2 adds Clerk's origins and script-src can use nonces instead of 'unsafe-inline' (Next's inline RSC scripts).
// No report-uri: a report's document-uri could hold a receipt code (/r/{code}), and those are never logged.
//
// Referrer-Policy: same-origin on public pages (no address, and so no receipt code in /r/{code}, ever goes to another
// site) and strict-origin-when-cross-origin on staff pages (/app/*, /sign-in, /sign-out). Not no-referrer on public
// pages, though the brief named it: with no-referrer a browser sends `Origin: null` on a native form POST, and Next
// refuses a server action whose Origin does not match ("Invalid Server Actions request"), so /check and the re-test
// answers on /r/{code} would fail when sent before the page's JavaScript has loaded (or without it). same-origin
// sends a Referer to this origin only, so it shares nothing more with other sites. e2e/platform.spec.ts checks both.
export const CSP_ENFORCED = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join("; ");

/** The baseline every page is checked against (report-only). `dev` adds 'unsafe-eval' (next dev's refresh runtime). */
export function cspBaseline(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const PUBLIC_REFERRER_POLICY = "same-origin";
export const STAFF_REFERRER_POLICY = "strict-origin-when-cross-origin";
/** The staff routes (they get STAFF_REFERRER_POLICY); everything else is public. */
export const STAFF_SOURCES = ["/app/:path*", "/sign-in", "/sign-out"];

type Header = { key: string; value: string };

/** The headers on every response. Read when Next loads this file (next build, next start, next dev). */
export function securityHeaders(env: Readonly<Record<string, string | undefined>> = process.env): Header[] {
  const headers: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Referrer-Policy", value: PUBLIC_REFERRER_POLICY },
    { key: "Content-Security-Policy", value: CSP_ENFORCED },
    { key: "Content-Security-Policy-Report-Only", value: cspBaseline(env.NODE_ENV === "development") },
  ];
  // Only on Vercel (always https there). Browsers ignore HSTS over plain http, but a local https proxy would pin
  // localhost to https for two years. No includeSubDomains or preload: other subdomains of a custom domain are not ours.
  if (env.VERCEL) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000" });
  return headers;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Later entries win for the same header, so the staff routes override the public referrer policy.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders() },
      ...STAFF_SOURCES.map((source) => ({ source, headers: [{ key: "Referrer-Policy", value: STAFF_REFERRER_POLICY }] })),
    ];
  },
  // lib/ai/prompts.ts reads the prompt files from disk at run time (their sha256 goes into event payloads), so a
  // deployed server bundle must carry them. Locally, `next start` reads them from the project folder anyway.
  // /app/eval reads the saved eval results (eval/results/*.json, written by `npm run eval`) the same way, and the report
  // page's "How your Feedback section compares" card reads data/benchmark/feedback-sections.csv (lib/benchmark/load.ts).
  outputFileTracingIncludes: {
    "/**": ["./lib/ai/prompts/*.md"],
    "/app/eval": ["./eval/results/*.json"],
    "/app/reports/*": ["./data/benchmark/*.csv"], // a glob: "[id]" would be a character class
  },
  // `next dev` logs every server action call WITH its arguments (e.g. submitReport's edited summary or
  // the reporter's email), and every request URL (404s included). CLAUDE.md: never log report text, emails
  // or receipt codes. The receipt page already links to /r/{code}, and /check will take a code: neither path
  // is logged. Dev-only settings (`next start` logs no requests). No `g` flag: RegExp.test must stay stateless.
  logging: {
    serverFunctions: false,
    incomingRequests: { ignore: [/^\/r\//, /[?&]code=/i] },
  },
  // Production builds (`local:serve`, so every e2e run and screenshot) always compile from the working tree.
  // Turbopack's persistent build cache (on by default in Next 16.4) once served pre-merge CSS after a git merge:
  // the Phase 4 report and /verify styles were missing from the build while their markup was there, so axe,
  // target-size, reflow and the screenshots ran on unstyled pages. The dev server keeps its cache.
  experimental: { turbopackFileSystemCacheForBuild: false },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
