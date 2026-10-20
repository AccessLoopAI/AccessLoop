// GET /api/health (docs/phase7-prompt.md T3 item 3): is this instance up and can it reach its database as the app
// role? For uptime checks and for humans after a deploy. `select 1` runs on the app's own connection
// (db/client.ts, role accessloop_app), so a wrong DATABASE_URL or a database that is down shows here.
// The answer holds modes and a commit id only: no secrets, no URLs, no counts, nothing about any organization.
// 200 when the database answers, 503 when it does not; never cached.
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { describeHealth, type HealthBody } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 3000;

async function databaseAnswers(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
    });
    await Promise.race([db.execute(sql`select 1`), timeout]);
    return true;
  } catch {
    return false; // the reason is not logged: a health probe may run every few seconds
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(): Promise<Response> {
  const body: HealthBody = describeHealth(await databaseAnswers());
  return Response.json(body, { status: body.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
