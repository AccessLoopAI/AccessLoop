// The body of GET /api/health (app/api/health/route.ts), built from the database check and the environment.
// Pure, so tests can check that it never carries a secret: only modes and a short commit id.
import { effectiveBackend } from "@/lib/ai/backend";
import type { EnvSource } from "@/lib/env";

export interface HealthBody {
  ok: boolean;
  db: "ok" | "unreachable";
  /** The effective AI backend (FAKE_LLM=1 ? fake : AI_BACKEND), or "invalid" for an unknown AI_BACKEND. */
  aiBackend: "fake" | "claude-cli" | "api" | "invalid";
  /** "fake" with FAKE_EMAIL=1 (logged to the Outbox), else "resend". */
  emailMode: "fake" | "resend";
  authMode: "local" | "clerk" | "unset";
  /** The deployed commit (Vercel or GitHub Actions), first 12 hex characters; null on a local build. */
  commit: string | null;
}

export function describeHealth(dbOk: boolean, env: EnvSource = process.env): HealthBody {
  let aiBackend: HealthBody["aiBackend"];
  try {
    aiBackend = effectiveBackend(env);
  } catch {
    aiBackend = "invalid";
  }
  const auth = (env.AUTH_MODE ?? "").trim();
  const sha = (env.VERCEL_GIT_COMMIT_SHA ?? env.GITHUB_SHA ?? "").trim().toLowerCase();
  return {
    ok: dbOk,
    db: dbOk ? "ok" : "unreachable",
    aiBackend,
    emailMode: env.FAKE_EMAIL === "1" ? "fake" : "resend",
    authMode: auth === "local" || auth === "clerk" ? auth : "unset",
    commit: /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 12) : null,
  };
}
