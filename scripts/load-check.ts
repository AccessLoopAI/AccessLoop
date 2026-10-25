// Local load check: N concurrent clients for D seconds per route against a RUNNING local production build.
//   npm run local:serve                                   (in another terminal: next build + next start)
//   npm run load:check                                    (50 clients, 30 s per route, prints a table)
//   npm run load:check -- --write docs/load-check.md      (also writes the report)
// Options: --base http://localhost:3000 (default: E2E_BASE_URL, else http://localhost:$PORT), --concurrency 50,
//   --duration 30 (seconds per route), --org maple-harbour, --lead "Alex Rivera", --write <file>.
//
// Routes: GET /, GET /o/{org}/report and GET /app/inbox signed in as the seeded lead. GETs only, so no rate-limited
// POST is ever hit. The lead's cookie comes from POSTing the local /sign-in form (the same "Sign in as ..." button
// e2e/helpers.ts clicks); it is never printed. Local hosts only: the local sign-in exists nowhere else, and this
// must never be pointed at someone's hosted site by accident.
// No new dependency: Node's fetch and a small worker pool. No top-level await.
import { cpus, totalmem, platform, release } from "node:os";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { LOCAL_SESSION_COOKIE } from "../lib/auth/local-session";

export interface RouteSpec { label: string; path: string; signedIn: boolean }
export interface RouteStats {
  label: string;
  path: string;
  requests: number;
  errors: number;
  errorKinds: Record<string, number>;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Share of the whole machine's CPU time that was busy during the route's run (server, this script and anything else). */
  cpuBusy: number;
}

export function routes(org: string): RouteSpec[] {
  return [
    { label: "Home", path: "/", signedIn: false },
    { label: "Report form", path: `/o/${encodeURIComponent(org)}/report`, signedIn: false },
    { label: "Inbox (signed in as the lead)", path: "/app/inbox", signedIn: true },
  ];
}

// ---------------------------------------------------------------- pure helpers

/** Nearest-rank percentile of an ascending array (p in 0..100). 0 for an empty array. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export function summarize(spec: RouteSpec, latencies: number[], errorKinds: Record<string, number>, elapsedMs: number, cpuBusy = 0): RouteStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const errors = Object.values(errorKinds).reduce((a, b) => a + b, 0);
  const requests = sorted.length + errors;
  return {
    label: spec.label, path: spec.path, requests, errors, errorKinds,
    rps: elapsedMs > 0 ? requests / (elapsedMs / 1000) : 0,
    p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted.at(-1) ?? 0,
    cpuBusy,
  };
}

const ms = (n: number) => `${Math.round(n)}`;

export function formatTable(stats: RouteStats[]): string {
  const head = "| Route | Requests | Errors | Requests/s | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Machine CPU busy |";
  const rule = "|---|---:|---:|---:|---:|---:|---:|---:|---:|";
  const rows = stats.map((s) => {
    const kinds = Object.entries(s.errorKinds).map(([k, n]) => `${k} x${n}`).join(", ");
    return `| ${s.label}: \`GET ${s.path}\` | ${s.requests} | ${s.errors}${kinds ? ` (${kinds})` : ""} | ${s.rps.toFixed(1)} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.p99)} | ${ms(s.max)} | ${Math.round(s.cpuBusy * 100)}% |`;
  });
  return [head, rule, ...rows].join("\n");
}

/** Only latencies of successful (200) responses are timed; anything else is an error of that kind. */
export function errorKind(status: number | null, error?: unknown): string | null {
  if (status === 200) return null;
  if (status !== null) return `HTTP ${status}`;
  const e = error as { name?: string; cause?: { code?: string } } | undefined;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  return e?.cause?.code ?? e?.name ?? "network";
}

export function isLocalBase(base: string): boolean {
  try {
    const u = new URL(base);
    return (u.protocol === "http:" || u.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
  return m ? decode(m[1]) : null;
};

/**
 * The fields of the /sign-in form whose button names `displayName` (its hidden inputs, including React's
 * $ACTION_ID_... field for the server action), or null when there is no such button.
 */
export function signInFormFields(html: string, displayName: string): [string, string][] | null {
  for (const form of html.split(/<form\b/i).slice(1)) {
    const body = form.slice(0, form.search(/<\/form>/i) + 1 || undefined);
    const text = decode(body.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    // The whole name, then the org in brackets: "Sign in as Alex Rivera (Maple Harbour Bank)".
    if (!new RegExp(`Sign in as ${displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?= \\(| ?$)`).test(text.trim())) continue;
    const fields: [string, string][] = [];
    for (const tag of body.match(/<input\b[^>]*>/gi) ?? []) {
      const name = attr(tag, "name");
      if (name) fields.push([name, attr(tag, "value") ?? ""]);
    }
    return fields.length ? fields : null;
  }
  return null;
}

/** Rows inside the page's <tbody> elements (on the inbox: the cases listed on that page; header rows not counted). */
export function tableBodyRows(html: string): number {
  return (html.match(/<tbody\b[\s\S]*?<\/tbody>/gi) ?? []).reduce((n, body) => n + (body.match(/<tr\b/gi) ?? []).length, 0);
}

/** "name=value" for `name` from Set-Cookie headers, or null. */
export function cookieFrom(setCookies: string[], name: string): string | null {
  for (const c of setCookies) {
    const first = c.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0 && first.slice(0, eq).trim() === name && first.slice(eq + 1).trim()) return first.trim();
  }
  return null;
}

export interface Machine { cpu: string; cores: number; ramGb: number; os: string; node: string }
export function machine(): Machine {
  const c = cpus();
  return {
    cpu: (c[0]?.model ?? "unknown").trim(), cores: c.length, ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    os: `${platform()} ${release()}`, node: process.version,
  };
}

export interface ReportInput {
  date: string;
  machine: Machine;
  buildMode: string;
  concurrency: number;
  durationS: number;
  warmup: number;
  stats: RouteStats[];
  /** Table rows on the signed-in inbox page when the run ended: its render time grows with them. */
  inboxRows?: number;
}

export const LABEL = "local laptop, production build; not a hosted measurement";

export function renderReport(r: ReportInput): string {
  const m = r.machine;
  const p95 = r.stats.map((s) => `${s.label.replace(/ \(.*\)$/, "").toLowerCase()} ${ms(s.p95)} ms`).join(", ");
  return `# Load check

**Label: ${LABEL}.**

These numbers come from one laptop that ran the app, its database and the load generator at the same time. They
say nothing about a hosted deployment (Vercel + Supabase): the network, cold starts and a remote database are not
in them. Wave 2 repeats this against the live URL.

| | |
|---|---|
| Date | ${r.date} |
| Machine | ${m.cpu}, ${m.cores} logical cores, ${m.ramGb} GB RAM (${m.os}) |
| Node | ${m.node} |
| Build | ${r.buildMode} |
| Load | ${r.concurrency} concurrent clients per route, for ${r.durationS} s per route, one route after the other |
${r.inboxRows === undefined ? "" : `| Inbox size | ${r.inboxRows} cases listed on the page (its time grows with this number) |\n`}| Tool | \`npm run load:check\` (\`scripts/load-check.ts\`: Node's fetch and a small worker pool, no extra dependency) |

${formatTable(r.stats)}

p95 at ${r.concurrency} concurrent clients: ${p95}.

## How it was measured

- Each client sends one GET, reads the whole body, and sends the next as soon as it has the answer (a closed loop:
  no think time, so this is a stress test, not a model of real visitors). Times are from sending the request to
  the last byte of the body. Only 200 answers are timed; anything else (another status, a network error or a
  30 s timeout) counts as an error.
- Before each route, ${r.warmup} requests warm it up and are not counted.
- GETs only, so no rate-limited POST (the report form's preview and submit) is ever sent.
- The inbox is fetched with the seeded lead's session cookie, from the local "Sign in as Alex Rivera" form
  (the button the e2e tests click). The cookie is never printed. A redirect to /sign-in would count as an error.
- "Machine CPU busy" is the share of the whole machine's CPU time in use during that route (from \`node:os\`):
  the app server, Postgres, this script and anything else running on the laptop at the time.
- The app connects to Postgres through a pool of 5 connections (\`db/client.ts\`), so signed-in pages queue for
  the database under this load.

## Run it again

\`\`\`bash
npm run local:serve                                # terminal 1: production build on http://localhost:3000
npm run load:check -- --write docs/load-check.md   # terminal 2: about ${r.stats.length * (r.durationS + 5)} s
\`\`\`

Then stop the server (Ctrl+C in terminal 1). Apart from one POST to the local sign-in form (which only sets the
cookie), the run sends only GETs, so it adds nothing to the database.
`;
}

// ---------------------------------------------------------------- network

interface Shot { status: number | null; ms: number; error?: unknown }

async function shoot(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Shot> {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    await res.arrayBuffer();
    return { status: res.status, ms: performance.now() - t0 };
  } catch (error) {
    return { status: null, ms: performance.now() - t0, error };
  }
}

function cpuTimes() {
  return cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle;
    a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
}

export async function runRoute(
  base: string, spec: RouteSpec, headers: Record<string, string>,
  opts: { concurrency: number; durationMs: number; warmup: number; timeoutMs?: number },
): Promise<RouteStats> {
  const url = new URL(spec.path, base).toString();
  const timeoutMs = opts.timeoutMs ?? 30_000;
  for (let i = 0; i < opts.warmup; i++) {
    const s = await shoot(url, headers, timeoutMs);
    if (i === 0 && s.status !== 200) throw new Error(`${spec.path} answered ${errorKind(s.status, s.error)} during warm-up`);
  }
  const latencies: number[] = [];
  const errorKinds: Record<string, number> = {};
  const cpu0 = cpuTimes();
  const start = performance.now();
  const end = start + opts.durationMs;
  const worker = async () => {
    while (performance.now() < end) {
      const s = await shoot(url, headers, timeoutMs);
      const kind = errorKind(s.status, s.error);
      if (kind) errorKinds[kind] = (errorKinds[kind] ?? 0) + 1;
      else latencies.push(s.ms);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  const elapsed = performance.now() - start;
  const cpu1 = cpuTimes();
  const busy = cpu1.total > cpu0.total ? 1 - (cpu1.idle - cpu0.idle) / (cpu1.total - cpu0.total) : 0;
  return summarize(spec, latencies, errorKinds, elapsed, busy);
}

/** Sign in as the seeded lead through the local /sign-in form and return the session cookie ("name=value"). */
export async function signInCookie(base: string, displayName: string): Promise<string> {
  const page = await fetch(new URL("/sign-in", base), { redirect: "manual" });
  if (page.status !== 200) throw new Error(`/sign-in answered HTTP ${page.status} (is AUTH_MODE=local and the host local?)`);
  const fields = signInFormFields(await page.text(), displayName);
  if (!fields) throw new Error(`no "Sign in as ${displayName}" button on /sign-in (is the database seeded?)`);
  const body = new FormData();
  for (const [k, v] of fields) body.append(k, v);
  // A form POST without JavaScript, as the browser sends it (Next's server action reads $ACTION_ID_... from it).
  const res = await fetch(new URL("/sign-in", base), { method: "POST", body, redirect: "manual", headers: { origin: new URL(base).origin } });
  await res.arrayBuffer();
  const cookie = cookieFrom(res.headers.getSetCookie(), LOCAL_SESSION_COOKIE);
  if (!cookie) throw new Error(`signing in did not set the session cookie (HTTP ${res.status})`);
  return cookie;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv = process.argv.slice(2), log: (s: string) => void = console.log): Promise<number> {
  const base = arg(argv, "base") ?? process.env.E2E_BASE_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`;
  const concurrency = Number(arg(argv, "concurrency") ?? 50);
  const durationS = Number(arg(argv, "duration") ?? 30);
  const warmup = Number(arg(argv, "warmup") ?? 20);
  const org = arg(argv, "org") ?? "maple-harbour";
  const lead = arg(argv, "lead") ?? "Alex Rivera";
  const out = arg(argv, "write");
  const buildMode = arg(argv, "build-mode") ?? "production build (`npm run local:serve`: `next build`, then `next start`), fake AI and email";
  if (!isLocalBase(base)) {
    log("load:check: only runs against a local app (localhost, 127.0.0.1 or [::1]): the local sign-in exists nowhere else.");
    return 2;
  }
  if (![concurrency, durationS, warmup].every((n) => Number.isFinite(n) && n >= 0) || concurrency < 1 || durationS <= 0) {
    log("load:check: --concurrency, --duration and --warmup must be positive numbers.");
    return 2;
  }
  try {
    const up = await fetch(base, { redirect: "manual", signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!up) {
      log(`load:check: nothing answers on ${new URL(base).origin}. Start the app first: npm run local:serve`);
      return 2;
    }
    await up.arrayBuffer();
    const cookie = await signInCookie(base, lead);
    log(`load:check: ${concurrency} clients x ${durationS} s per route on ${new URL(base).origin} (signed in as the lead; cookie not shown)`);
    const stats: RouteStats[] = [];
    for (const spec of routes(org)) {
      log(`  ${spec.label}: GET ${spec.path} ...`);
      stats.push(await runRoute(base, spec, spec.signedIn ? { cookie } : {}, { concurrency, durationMs: durationS * 1000, warmup }));
    }
    const inbox = routes(org).find((r) => r.signedIn);
    const inboxRows = inbox
      ? await fetch(new URL(inbox.path, base), { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(30_000) })
        .then((res) => (res.status === 200 ? res.text().then(tableBodyRows) : undefined)).catch(() => undefined)
      : undefined;
    log("");
    log(formatTable(stats));
    if (inboxRows !== undefined) log(`\nThe inbox page listed ${inboxRows} cases.`);
    if (out) {
      writeFileSync(out, renderReport({
        date: new Date().toISOString().slice(0, 10), machine: machine(), buildMode, concurrency, durationS, warmup, stats, inboxRows,
      }));
      log(`\nload:check: wrote ${out}`);
    }
    return stats.some((s) => s.errors > 0) ? 1 : 0;
  } catch (e) {
    log(`load:check: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && /load-check\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().then((code) => process.exit(code)).catch(() => process.exit(1));
}
