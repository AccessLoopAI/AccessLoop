// The daily job (docs/archive/phase7-prompt.md T3 item 12; docs/decisions.md 2026-10-20): expire re-test rounds open for 60
// days (only with CRON_EXPIRE_RETEST=1), send each round's one reminder a week after the request, and alert owners
// about cases past due or with no fix for 30+ days (lib/cron/run.ts). vercel.json runs it once a day; Vercel Cron
// calls it with GET and `Authorization: Bearer ${CRON_SECRET}`. Anyone else gets a 401 before anything is read.
// `?dryRun=1` plans and counts without writing or sending anything (to see what a run would do today).
// The answer holds counts only (no case, no org, no address), and is never cached.
import { secretFromEnv } from "@/lib/env";
import { bearerMatches } from "@/lib/cron/auth";
import { runDailyJob } from "@/lib/cron/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A run visits every org's open cases and may send a few emails (5 s each at most).
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

async function handle(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = secretFromEnv("CRON_SECRET");
  } catch {
    console.error("[cron] CRON_SECRET is not available, so the daily job can't be authorized.");
    return Response.json({ ok: false, error: "not_configured" }, { status: 503, headers: NO_STORE });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers: { ...NO_STORE, "www-authenticate": "Bearer" } });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  try {
    const summary = await runDailyJob({ dryRun });
    return Response.json(summary, { status: summary.ok ? 200 : 500, headers: NO_STORE });
  } catch (err) {
    console.error(`[cron] the daily job stopped (${err instanceof Error ? err.name : "UnknownError"})`);
    return Response.json({ ok: false, error: "failed" }, { status: 500, headers: NO_STORE });
  }
}

export const GET = handle;
export const POST = handle;
