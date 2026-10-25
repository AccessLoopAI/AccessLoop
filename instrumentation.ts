// Next calls register() once when a server instance starts: `next start`, `next dev` and each Vercel cold start,
// never during `next build`. AccessLoop uses it to refuse to start (lib/boot-checks.ts: the message, then exit 1)
// when the environment is incomplete (lib/env.ts) or when the database role the app connects as could bypass
// row-level security. docs/decisions.md 2026-10-20 (Phase 7 T3 items 1-2).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // the checks need node:crypto and the database
  if (process.env.NEXT_PHASE === "phase-production-build") return; // Next 16 already skips it; kept explicit
  const { bootOrExit } = await import("./lib/boot-checks");
  await bootOrExit();
}
