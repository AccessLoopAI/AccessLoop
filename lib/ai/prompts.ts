// The versioned prompt files (lib/ai/prompts/*.md; docs/domain.md §6). Read from disk on every real-backend call, so
// an edited prompt takes effect at once and its sha256 (recorded as `promptSha` in event payloads and eval results)
// always describes the exact bytes the model got. The claude-cli backend hands the same file to the CLI with
// --system-prompt-file, or its text with --system-prompt when the installed CLI's --help does not list that flag
// (2.1.299 does not); the api backend sends its text as the system prompt.
//
// Files are found from the working directory (`npm run local`, `next start`, `npm run eval` and vitest all run from the
// project root). next.config.ts lists them in outputFileTracingIncludes so a deployed build carries them too.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AiConfigError } from "./errors";
import type { AiFunction } from "./types";

export const PROMPT_FILES: Readonly<Record<AiFunction, string>> = {
  structure: "structure.md",
  flagPii: "flag-pii.md",
  phraseClaims: "phrase-claims.md",
};

export interface LoadedPrompt {
  fn: AiFunction;
  /** Absolute path (given to the claude CLI as --system-prompt-file, when its --help lists that flag). */
  path: string;
  /** The whole file, version line included: the system prompt. */
  text: string;
  /** sha256 hex of the file's bytes. */
  sha: string;
  /** From the first line, "Prompt version: structure v1 (2026-10-19)" -> "structure v1 (2026-10-19)". */
  version: string;
}

const VERSION_LINE = /^Prompt version: (.+)$/;

export function promptPath(fn: AiFunction): string {
  return path.join(process.cwd(), "lib", "ai", "prompts", PROMPT_FILES[fn]);
}

export function loadPrompt(fn: AiFunction): LoadedPrompt {
  return loadPromptFile(fn, promptPath(fn), `lib/ai/prompts/${PROMPT_FILES[fn]}`);
}

/**
 * One prompt file as a LoadedPrompt: the whole text, the sha256 of its bytes and its "Prompt version:" line.
 * `shownAs` names the file in errors (a project-relative path). loadPrompt uses it for lib/ai/prompts; the eval's
 * zero-shot baseline (eval/baseline/*.md) uses it for its own system prompts.
 */
export function loadPromptFile(fn: AiFunction, file: string, shownAs: string): LoadedPrompt {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    throw new AiConfigError(`The prompt file ${shownAs} could not be read. Run AccessLoop from the project folder.`);
  }
  const text = bytes.toString("utf8");
  const version = VERSION_LINE.exec(text.split(/\r?\n/, 1)[0] ?? "")?.[1]?.trim();
  if (!version) {
    throw new AiConfigError(`${shownAs} must start with a "Prompt version: ..." line.`);
  }
  return { fn, path: file, text, sha: createHash("sha256").update(bytes).digest("hex"), version };
}
