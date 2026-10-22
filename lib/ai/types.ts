// Shared AI types (docs/domain.md §6). Type-only module: safe to import from anywhere in lib/ai.
import type { cases } from "@/db/schema";
import type { AiBackendName } from "./backend";

export type LocationKind = (typeof cases.$inferInsert)["locationKind"];

/** The three AI functions of domain §6. Each has one prompt file, one zod schema and one fake. */
export type AiFunction = "structure" | "flagPii" | "phraseClaims";

/**
 * Token counts of one model call, as the backend reported them (api: the Messages API `usage`; claude-cli: the
 * `usage` of its JSON result). Numbers only, never text. The fake backend reports none.
 */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  /** api only: the part of outputTokens the model spent thinking (output_tokens_details.thinking_tokens). */
  thinkingTokens?: number;
}

/** Stored in `ai_structured` event payloads (domain §6): which backend and prompt produced a value. */
export interface AiMeta {
  backend: AiBackendName;
  /** api: the model ID from MODEL_*; claude-cli: the CLAUDE_CLI_MODEL alias; fake: "fake". */
  model: string;
  /** sha256 of the prompt file used (real backends) or of the fakes file (fake backend). */
  promptSha: string;
  latencyMs: number;
  /** claude-cli only: the CLI version from its startup check. */
  cliVersion?: string;
  /**
   * Token counts, when the backend reported them. For the eval's results (latency and tokens per call); intake
   * never stores them in case events (lib/cases/create.ts takes the fields above only).
   */
  usage?: AiUsage;
  /** api only: 2 when the one retry after HTTP 429/529 was used. */
  attempts?: number;
}

export interface AiResult<T> {
  value: T;
  meta: AiMeta;
}

/**
 * Per-call options. `deadline` is a wall-clock time (Date.now() milliseconds) by which the caller stops waiting:
 * intake's preview gives all its AI steps one shared budget (lib/intake/pipeline.ts). A call that can't finish in
 * time is an AiTimeoutError, like any other timeout; nothing waits past the deadline.
 */
export interface AiCallOptions {
  deadline?: number;
}
