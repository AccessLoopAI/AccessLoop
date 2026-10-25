// Test-only: a fresh in-memory Postgres (PGlite) seeded EXACTLY the way `npm run db:smoke` does it
// (scripts/db-smoke.ts): the drizzle migrations, the app role, db/sql/0100_security.sql, then `db/seed.ts --reset`
// as a child process against it. The server listens on a free port on 127.0.0.1 (never 5544, which db:smoke uses),
// so parallel test runs never collide. The seed must run in a child process: it ends with process.exit().
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface SeededDb {
  url: string;
  /** The env db/seed.ts ran with (DATABASE_URL, ENCRYPTION_KEY, ...): assign it before importing db/client. */
  env: Record<string, string>;
  stop(): Promise<void>;
}

function runSeed(env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("db", "seed.ts"), "--reset"], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stdout.resume();
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`db/seed.ts exited with ${code}: ${err.slice(0, 2000)}`))));
  });
}

export async function startSeededDb(): Promise<SeededDb> {
  const db = new PGlite("memory://");
  await db.waitReady;
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 8 });
  await server.start();
  const port = Number(server.getServerConn().split(":").pop());
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const dir = path.join(ROOT, "db", "migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      for (const stmt of readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) await sql.unsafe(stmt);
    }
    await sql.unsafe(`CREATE ROLE accessloop_app LOGIN PASSWORD 'x' NOSUPERUSER NOBYPASSRLS`);
    await sql.unsafe(readFileSync(path.join(ROOT, "db", "sql", "0100_security.sql"), "utf8"));
  } finally {
    await sql.end();
  }

  // The same values scripts/db-smoke.ts uses (fictional; this database lives only in memory).
  const env: Record<string, string> = {
    DATABASE_URL: url,
    MIGRATION_DATABASE_URL: url,
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    RECEIPT_PEPPER: "pepper",
    IP_SALT: "salt",
    SEED_CLERK_ORG_ID_DEMO: "org_demo",
    SEED_CLERK_ORG_ID_OTHER: "org_other",
    SEED_LEAD_USER_ID: "user_lead",
    SEED_OWNER_WEB_USER_ID: "user_web",
    SEED_OWNER_FACILITIES_USER_ID: "user_fac",
    SEED_OTHER_LEAD_USER_ID: "user_olead",
    SEED_AUDITOR_USER_ID: "user_auditor",
    SEED_ALLOW_RESET: "1",
  };
  try {
    await runSeed(env); // its output names receipt codes: never print it
  } catch (e) {
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
    throw e;
  }

  return {
    url,
    env,
    stop: async () => {
      await server.stop().catch(() => {});
      await db.close().catch(() => {});
    },
  };
}
