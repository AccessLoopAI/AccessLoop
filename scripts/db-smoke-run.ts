// Runner for `npm run db:smoke`: an in-memory PGlite served over the Postgres wire protocol on
// 127.0.0.1:5544 (max 8 connections), then `node node_modules/tsx/dist/cli.mjs scripts/db-smoke.ts`
// against it. It then STOPS the server and exits with the smoke test's exit code.
//
// This is exactly what CLAUDE.md's
//   pglite-server --port=5544 --max-connections=8 --run="node node_modules/tsx/dist/cli.mjs scripts/db-smoke.ts"
// does, with one difference: the pglite-server CLI (every @electric-sql/pglite-socket release up to 0.2.13)
// only shuts down when the command FAILS. After 24 PASS lines and exit code 0 it keeps serving forever,
// so the npm script never finished. See docs/decisions.md (2026-10-19, scaffold).
// No top-level await: works whether or not package.json sets "type": "module".
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { spawn } from "node:child_process";
import path from "node:path";

const HOST = "127.0.0.1";
const PORT = 5544; // scripts/db-smoke.ts connects to postgres://postgres:postgres@127.0.0.1:5544/postgres

function runSmoke(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "db-smoke.ts")],
      { stdio: "inherit", env: process.env },
    );
    child.on("error", (e) => {
      console.error("db:smoke: could not start scripts/db-smoke.ts:", e.message);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<number> {
  const db = new PGlite("memory://");
  await db.waitReady;
  const server = new PGLiteSocketServer({ db, host: HOST, port: PORT, maxConnections: 8 });
  try {
    await server.start();
  } catch (e) {
    console.error(`db:smoke: could not listen on ${HOST}:${PORT} (is another db:smoke running?)`, e instanceof Error ? e.message : e);
    await db.close().catch(() => {});
    return 1;
  }
  console.log(`PGlite (in memory) listening on ${HOST}:${PORT}`);
  try {
    const code = await runSmoke();
    console.log(code === 0 ? "db:smoke: all checks passed" : `db:smoke: FAILED (exit code ${code})`);
    return code;
  } finally {
    await server.stop().catch(() => {});
    await db.close().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
