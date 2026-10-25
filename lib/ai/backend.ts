// Which backend answers AI calls (docs/domain.md §6.1, CLAUDE.md "AI contract").
// Effective backend = FAKE_LLM === "1" ? "fake" : AI_BACKEND (default "fake"). Never a silent fallback.
import { AiConfigError } from "./errors";

export { AiConfigError } from "./errors";

export const AI_BACKENDS = ["fake", "claude-cli", "api"] as const;
export type AiBackendName = (typeof AI_BACKENDS)[number];

function isBackend(value: string): value is AiBackendName {
  return (AI_BACKENDS as readonly string[]).includes(value);
}

/**
 * The backend every AI function uses for this call. FAKE_LLM=1 forces "fake" whatever AI_BACKEND says
 * (Playwright and preview deployments set it). An unknown AI_BACKEND throws, it never means "fake".
 */
export function effectiveBackend(env: Readonly<Record<string, string | undefined>> = process.env): AiBackendName {
  if ((env.FAKE_LLM ?? "").trim() === "1") return "fake"; // " 1" from a hand-edited env file still means fake
  const raw = (env.AI_BACKEND ?? "").trim();
  if (raw === "") return "fake";
  if (isBackend(raw)) return raw;
  throw new AiConfigError(
    `AI_BACKEND="${raw.slice(0, 40)}" is not a known AI backend. Use "fake", "claude-cli" or "api" (docs/domain.md §6.1), ` +
      `or set FAKE_LLM=1 to force the fake backend.`,
  );
}
