// What instrumentation.ts register() checks before the app serves anything (docs/phase7-prompt.md T3 items 1-2):
//   1. the environment (lib/env.ts): every required setting present and well-formed, no value ever printed;
//   2. the database role the app connects as (DATABASE_URL): neither a superuser nor BYPASSRLS, or row-level
//      security would not protect any tenant (lib/db-role.ts). A database that can't be reached also stops the start:
//      the role can't be checked, and nothing would work anyway.
// Either problem throws; bootOrExit() then prints the message once and ends the process, so the server does not
// start. (Checked on `next start`, Next 16.4: when register() only throws, Next prints the error several times and
// goes on listening, answering every request with a 500.) Node runtime only.
import { EnvError, assertEnv } from "@/lib/env";
import { CURRENT_ROLE_SQL, roleRefusal, type DbRoleRow } from "@/lib/db-role";

export class BootCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootCheckError";
  }
}

/**
 * A short, value-free description of a database error: the driver's code and message (e.g. "ECONNREFUSED: connect
 * ECONNREFUSED 127.0.0.1:54331"), never the URL. drizzle wraps the driver's error as "Failed query: ...", so the
 * innermost `cause` is the one that says why.
 */
export function describeDbError(e: unknown): string {
  let err = e;
  for (let i = 0; i < 5 && typeof err === "object" && err !== null && "cause" in err && (err as { cause?: unknown }).cause; i++) {
    err = (err as { cause: unknown }).cause;
  }
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  const message = err instanceof Error ? err.message : String(err);
  return [code, message.slice(0, 200)].filter(Boolean).join(": ");
}

/** Runs both checks; throws EnvError or BootCheckError. `query` is injectable for tests. */
export async function runBootChecks(query?: () => Promise<DbRoleRow[]>): Promise<void> {
  assertEnv();
  const run = query ?? (await appRoleQuery());
  let rows: DbRoleRow[];
  try {
    rows = await run();
  } catch (e) {
    throw new BootCheckError(
      `AccessLoop can't start: the database could not be reached to check the app's role (${describeDbError(e)}). ` +
        "Start Postgres first (`npm run local` and `npm run local:serve` do), or check DATABASE_URL.",
    );
  }
  const problem = roleRefusal(rows[0], "The app's database role (DATABASE_URL)");
  if (problem) throw new BootCheckError(`AccessLoop can't start: ${problem}`);
}

/**
 * For instrumentation.ts: run the checks; on a problem print its message (value-free by construction) and exit 1.
 * On Vercel the exit fails that cold start, and the next request tries again: the app never serves half-configured.
 */
export async function bootOrExit(): Promise<void> {
  try {
    await runBootChecks();
  } catch (e) {
    console.error(e instanceof EnvError || e instanceof BootCheckError ? e.message : `AccessLoop can't start: ${describeDbError(e)}`);
    process.exit(1);
  }
}

/** The check on the app's own pooled connection (db/client.ts), imported only after the env check passed. */
async function appRoleQuery(): Promise<() => Promise<DbRoleRow[]>> {
  const [{ db }, { sql }] = await Promise.all([import("@/db/client"), import("drizzle-orm")]);
  return async () => Array.from(await db.execute<DbRoleRow & Record<string, unknown>>(sql.raw(CURRENT_ROLE_SQL)));
}
