// Typed AI errors (docs/domain.md §6, §6.1). Every message built here is TEXT-FREE by construction: it never holds
// report text, model output, emails, receipt codes or IPs, so callers may log it (lib/intake/redact.ts logAiFailure).
// Names are string literals, not `new.target.name`: a minified server bundle would rename the classes.
//
// What each one means for a caller:
//   AiConfigError              AI_BACKEND or an ANTHROPIC_* knob holds a value we don't know. Fix the env.
//   AiBackendUnavailableError  The chosen backend can't be used here: no ANTHROPIC_API_KEY, the claude CLI is missing,
//                              too old, logged out or not on a subscription login. The message says what to do.
//   AiNotAllowedError          claude-cli refused to run: not AUTH_MODE=local, on Vercel, or not a local request.
//   AiTimeoutError             The backend took longer than its limit (api 10 s, claude-cli 60 s).
//   AiCallError                The backend answered with an error (HTTP error, is_error, refusal, a crash).
//   AiOutputError              The answer was not what the contract asks for (schema, no tool call, not a substring).
// Intake turns ANY of them into the domain fallback (structure: no summary, manual triage; flagPii:
// needsManualRedaction). None of them ever makes another backend answer instead.
import type { AiBackendName } from "./backend";

export class AiError extends Error {
  /** Every AiError message is safe to log: no report text, no model output, no personal data. */
  readonly textFree = true as const;
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

/** AI_BACKEND (or another AI setting) holds a value we do not know. A configuration mistake, so it is loud. */
export class AiConfigError extends AiError {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

/** The configured backend can't run on this machine as configured. Never silently replaced by another backend. */
export class AiBackendUnavailableError extends AiError {
  readonly backend: AiBackendName;
  constructor(backend: AiBackendName, message: string) {
    super(message);
    this.name = "AiBackendUnavailableError";
    this.backend = backend;
  }
}

/** The claude-cli hard limits (domain §6.1 limit 2) refused this call. */
export class AiNotAllowedError extends AiError {
  readonly backend: AiBackendName;
  constructor(backend: AiBackendName, message: string) {
    super(message);
    this.name = "AiNotAllowedError";
    this.backend = backend;
  }
}

export class AiTimeoutError extends AiError {
  readonly backend: AiBackendName;
  readonly timeoutMs: number;
  constructor(backend: AiBackendName, timeoutMs: number) {
    // Whole seconds from 10 s up ("10 s", "60 s"); tenths below, for a shorter budget ("1.2 s"), so it never says "0 s".
    const seconds = timeoutMs >= 10_000 ? Math.round(timeoutMs / 1000) : Math.round(timeoutMs / 100) / 10;
    super(`The ${backend} AI backend did not answer within ${seconds} s.`);
    this.name = "AiTimeoutError";
    this.backend = backend;
    this.timeoutMs = timeoutMs;
  }
}

export class AiCallError extends AiError {
  readonly backend: AiBackendName;
  constructor(backend: AiBackendName, message: string) {
    super(message);
    this.name = "AiCallError";
    this.backend = backend;
  }
}

export class AiOutputError extends AiError {
  readonly backend: AiBackendName;
  constructor(backend: AiBackendName, message: string) {
    super(message);
    this.name = "AiOutputError";
    this.backend = backend;
  }
}

/** True for our own error types, whose messages are safe to log. Checks the name too (bundles can duplicate classes). */
export function isAiError(err: unknown): err is AiError {
  return err instanceof AiError || (err instanceof Error && (err as { textFree?: unknown }).textFree === true);
}
