// The npm scripts local:setup, local, local:serve, local:db and local:reset run scripts/local.ts (frozen) through
// this wrapper (docs/archive/phase7-prompt.md T3 item 16), so the two ways a minimal Linux machine fails get a plain fix:
//   - as root: stopped before anything starts (Postgres refuses root anyway, after a long wait and a vague error);
//   - initdb's "invalid locale name" (no en_US.UTF-8 locale): after local.ts fails, `locale -a` is checked and the
//     install commands are printed (scripts/local-hints.ts).
// Everything else is unchanged: same arguments, stdout untouched, stderr passed through as it comes, local.ts's own
// exit code.
// On Windows signals are not forwarded (child.kill would end local.ts at once, before it stops Postgres; Ctrl+C
// reaches every process in the console anyway); elsewhere SIGINT and SIGTERM are passed on and this wrapper waits.
// No top-level await: works whether or not package.json sets "type": "module".
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { ROOT_MESSAGE, localFailureHint } from "./local-hints";

const ROOT = process.cwd();
const args = process.argv.slice(2);

function localeList(): string | null {
  if (process.platform !== "linux") return null;
  try {
    return execFileSync("locale", ["-a"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 });
  } catch {
    return null;
  }
}

function main(): void {
  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() === 0) {
    console.error(ROOT_MESSAGE);
    process.exit(1);
  }

  // stdout stays the terminal's own (colours, TTY); only stderr is read, because both failures end there:
  // local.ts prints its fatal error with console.error.
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "local.ts"), ...args], {
    stdio: ["inherit", "inherit", "pipe"],
    env: process.env,
  });

  // Only the last part of stderr is kept, to look for the two failures; it is never written anywhere else.
  let tail = "";
  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    tail = (tail + chunk.toString("utf8")).slice(-16_384);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (process.platform !== "win32") child.kill(signal);
    });
  }

  child.on("error", (e) => {
    console.error("Could not start scripts/local.ts:", e.message);
    process.exit(1);
  });
  child.on("close", (code, signal) => {
    const exitCode = code ?? (signal ? 1 : 0);
    if (exitCode !== 0) {
      const hint = localFailureHint(tail, process.platform, localeList());
      if (hint) console.error(`\n${hint}`);
    }
    process.exit(exitCode);
  });
}

main();
