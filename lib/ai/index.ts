// THE entry point for every AI call (docs/domain.md §6, §6.1; CLAUDE.md "AI contract"). Server-only.
// - Input is masked text only: layer-1 redaction runs before anything reaches this module.
// - Output is zod-validated and never changes case state by itself.
// - The backend is chosen per call by effectiveBackend() (FAKE_LLM=1 ? fake : AI_BACKEND); one backend never falls
//   back to another. lib/ai/core.ts holds the one shared implementation; lib/ai/backends/{fake,claude-cli,api}.ts
//   only carry a request to a model.
// - Callers pass an AiContext (lib/ai/context.ts): the request's headers in Next, or the local-script marker in a
//   CLI script. Only claude-cli uses it (it refuses off localhost); fake and api ignore it.
import { effectiveBackend, type AiBackendName } from "./backend";
import { API_TIMEOUT_MS, createApiTransport } from "./backends/api";
import { CLI_TIMEOUT_MS, createClaudeCliTransport } from "./backends/claude-cli";
import { fillClaimTemplate } from "./claims";
import type { AiContext } from "./context";
import { createAi, type AiFunctions } from "./core";
import type { LoadedPrompt } from "./prompts";
import type { AiCallOptions, AiFunction, AiMeta, AiResult, LocationKind } from "./types";
import type { Claim, FlagPiiOutput, PhraseClaimsOutput, StructureOutput } from "./schemas";

export { AiConfigError, effectiveBackend, AI_BACKENDS, type AiBackendName } from "./backend";
export {
  AiBackendUnavailableError,
  AiCallError,
  AiError,
  AiNotAllowedError,
  AiOutputError,
  AiTimeoutError,
  isAiError,
} from "./errors";
export { aiLocalScriptContext, aiRequestContext, type AiContext } from "./context";
export { fillClaimTemplate } from "./claims";
export { loadPrompt, loadPromptFile, PROMPT_FILES, type LoadedPrompt } from "./prompts";
export type { AiCallOptions, AiFunction, AiMeta, AiResult, AiUsage, LocationKind } from "./types";
export type { AiFunctions } from "./core";
export * from "./schemas";

// One instance per server process: the claude-cli queue and its startup check are per process.
const cliTransport = createClaudeCliTransport();
const apiTransport = createApiTransport();
const ai = createAi({ transports: { "claude-cli": cliTransport, api: apiTransport } });

/**
 * The same three functions, backends, transports and contract checks, with OTHER system prompts. Only for the eval's
 * zero-shot baseline (`npm run eval -- --baseline`: "the same model without our prompt", eval/README.md). The app
 * never calls this: its AI calls are the functions below, with the prompt files in lib/ai/prompts.
 */
export function aiWithPrompts(loadPrompt: (fn: AiFunction) => LoadedPrompt): AiFunctions {
  return createAi({ transports: { "claude-cli": cliTransport, api: apiTransport }, loadPrompt });
}

/**
 * How long the AI steps of ONE intake (the preview's two flagPii calls and structure, or a staff-logged report) may
 * take together, end to end: the backend's own per-call timeout (api 10 s, claude-cli 60 s; fake answers at once).
 * docs/decisions.md 2026-10-20 "Intake AI budget". Callers turn it into AiCallOptions.deadline.
 */
export function intakeAiBudgetMs(backend: AiBackendName): number {
  return backend === "claude-cli" ? CLI_TIMEOUT_MS : API_TIMEOUT_MS;
}

/** Summary (second person, at most 2 sentences) and 1-3 suggested areas, from REDACTED text only. Throws an AiError. */
export function structure(
  maskedText: string,
  locationKind: LocationKind,
  ctx?: AiContext,
  opts?: AiCallOptions,
): Promise<AiResult<StructureOutput>> {
  return ai.structure(maskedText, locationKind, ctx, opts);
}

/** Layer 2 of redaction (domain §5): exact substrings of the layer-1 masked text that identify a person. Throws an AiError. */
export function flagPii(maskedText: string, ctx?: AiContext, opts?: AiCallOptions): Promise<AiResult<FlagPiiOutput>> {
  return ai.flagPii(maskedText, ctx, opts);
}

/** Plain-language wording of compiled report claims (domain §7). Keeps every slot value. Throws an AiError. */
export function phraseClaims(claims: Claim[], ctx?: AiContext, opts?: AiCallOptions): Promise<AiResult<PhraseClaimsOutput>> {
  return ai.phraseClaims(claims, ctx, opts);
}

// ---- The shared fallbacks (domain §5, §6.1). `onError` gets the error to log; log only its class and, for an
// AiError (isAiError), its text-free message. Never the input. ----

/** structure() or null. null = the fallback: no AI summary, the case goes to manual triage. */
export async function structureOrFallback(
  maskedText: string,
  locationKind: LocationKind,
  ctx: AiContext | undefined,
  onError: (fn: AiFunction, err: unknown) => void,
  opts?: AiCallOptions,
): Promise<AiResult<StructureOutput> | null> {
  try {
    return await structure(maskedText, locationKind, ctx, opts);
  } catch (err) {
    onError("structure", err);
    return null;
  }
}

/** flagPii() or null. null = the fallback: layer 1 only, and the case is flagged needsManualRedaction. */
export async function flagPiiOrFallback(
  maskedText: string,
  ctx: AiContext | undefined,
  onError: (fn: AiFunction, err: unknown) => void,
  opts?: AiCallOptions,
): Promise<AiResult<FlagPiiOutput> | null> {
  try {
    return await flagPii(maskedText, ctx, opts);
  } catch (err) {
    onError("flagPii", err);
    return null;
  }
}

/** phraseClaims(), or every claim's deterministic template when the call fails (domain §7 step 5). */
export async function phraseClaimsOrTemplates(
  claims: Claim[],
  ctx: AiContext | undefined,
  onError: (fn: AiFunction, err: unknown) => void,
): Promise<{ sentences: PhraseClaimsOutput; meta: AiMeta | null }> {
  try {
    const r = await phraseClaims(claims, ctx);
    return { sentences: r.value, meta: r.meta };
  } catch (err) {
    onError("phraseClaims", err);
    return { sentences: claims.map((c) => ({ claimId: c.claimId, text: fillClaimTemplate(c) })), meta: null };
  }
}

export interface AiBackendStatus {
  backend: AiBackendName;
  /** fake answers are canned: eval results must be labelled as simulated. */
  simulated: boolean;
  /** The model per function (api: model IDs; claude-cli: the alias; fake: "fake"). */
  models: Record<AiFunction, string>;
  cliVersion?: string;
}

/**
 * Is the effective backend usable here, before any report is sent to it? For the eval runner and similar scripts:
 * api checks ANTHROPIC_API_KEY and its knobs (no network call); claude-cli runs its guard and startup check
 * (`claude --version`, `claude auth status`, `claude --help`); its cliVersion is the version with the detected
 * capabilities (cliVersionLabel). Throws the same clear AiError a call would; never switches backend.
 */
export async function checkAiBackend(ctx?: AiContext): Promise<AiBackendStatus> {
  const backend = effectiveBackend();
  if (backend === "fake") {
    return { backend, simulated: true, models: { structure: "fake", flagPii: "fake", phraseClaims: "fake" } };
  }
  if (backend === "api") return { backend, simulated: false, models: apiTransport.checkReady().models };
  const cli = await cliTransport.checkReady(ctx);
  return {
    backend,
    simulated: false,
    models: { structure: cli.model, flagPii: cli.model, phraseClaims: cli.model },
    cliVersion: cli.version,
  };
}
