// The app's public base URL for links that leave the browser: emails (the /check link), a downloaded receipt, the
// published report's /verify line, the report's feedback-form link (docs/phase7-prompt.md T3 item 9).
//
// SERVER-ONLY, read at RUN time. It used to read NEXT_PUBLIC_APP_URL, which Next inlines into every bundle at BUILD
// time: the review found `http://localhost:3000` compiled into the server bundle, so a build made on one machine and
// run elsewhere would email localhost links. Now, in this order (the first one set wins):
//   1. APP_URL                         the explicit setting (an origin such as https://accessloop.example.ca)
//   2. VERCEL_PROJECT_PRODUCTION_URL   the project's production domain, on a PRODUCTION deployment (VERCEL_ENV)
//   3. VERCEL_URL                      this deployment's own URL (a preview links to itself, never to production)
//   4. VERCEL_PROJECT_PRODUCTION_URL   (if Vercel gave no VERCEL_URL at all)
//   5. http://localhost:{PORT, else 3000}   this computer (local:serve and next dev listen on 127.0.0.1)
// Never from the Host header (a request can claim any host). NEXT_PUBLIC_APP_URL is no longer read: on this computer
// the localhost fallback gives the value `npm run local:setup` writes there, so an existing .env.local keeps working.
// lib/env.ts checks APP_URL's form at boot, and requires it where nothing else would be right (self-hosted clerk mode).

export type AppUrlEnv = Readonly<Record<string, string | undefined>>;

const set = (v: string | undefined) => (v && v.trim() !== "" ? v.trim() : null);

/** `https://` + a host name that Vercel gives without a scheme. */
const vercelHost = (host: string) => `https://${host.replace(/^https?:\/\//i, "")}`;

/** The base URL with no trailing slash. Always a value: the last fallback is this computer. */
export function appBaseUrl(env: AppUrlEnv = process.env): string {
  if (typeof window !== "undefined") throw new Error("lib/app-url.ts is server-only");
  const explicit = set(env.APP_URL);
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = set(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production && env.VERCEL_ENV === "production") return vercelHost(production);
  const deployment = set(env.VERCEL_URL);
  if (deployment) return vercelHost(deployment);
  if (production) return vercelHost(production);
  const port = set(env.PORT);
  return `http://localhost:${port && /^\d{1,5}$/.test(port) ? port : "3000"}`;
}

/** The absolute URL of a path on this app ("/check" -> "https://accessloop.example.ca/check"). */
export function absoluteUrl(path: string, env: AppUrlEnv = process.env): string {
  return `${appBaseUrl(env)}${path.startsWith("/") ? path : `/${path}`}`;
}
