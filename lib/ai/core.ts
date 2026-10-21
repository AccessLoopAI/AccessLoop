// The ONE implementation of structure / flagPii / phraseClaims (docs/domain.md §6, §6.1). Every backend shares it:
// the prompt files and their sha256, the user turn with the untrusted data inside <report>...</report>, the zod
// validation and the contract checks below. A backend (lib/ai/backends/*) only decides how a request reaches a model.
//
// - Backend per call: effectiveBackend() (FAKE_LLM=1 ? fake : AI_BACKEND). Whatever goes wrong, the error is thrown
//   to the caller as a text-free AiError. This module NEVER asks another backend instead.
// - Contract checks, the same for every backend (fake included):
//   structure:    the zod schema; areas listed once (highest confidence kept), most confident first.
//   flagPii:      the zod schema; every item must be an EXACT substring of the masked text it was given (domain §5).
//                 An answer that rewrote a value breaks the contract, so the whole answer counts as failed: the
//                 caller's fallback (needsManualRedaction) then tells the lead to look for names by hand.
//   phraseClaims: the zod schema; exactly one sentence per claim (same ids); a sentence that drops a slot value or
//                 leaves a {slot} falls back to that claim's filled template (domain §7: "must keep every slot value").
// - The fallbacks for callers (domain §5, §6.1) are in lib/ai/index.ts: structureOrFallback (null = no summary,
//   manual triage), flagPiiOrFallback (null = needsManualRedaction), phraseClaimsOrTemplates.
// - A caller's deadline (AiCallOptions; intake's preview budget): a real-backend call is not started when less than
//   MIN_CALL_WINDOW_MS is left, and the caller never waits past the deadline (an AiTimeoutError, like any timeout). The
//   transport also gets the deadline, so the api request is aborted and a queued claude-cli call never starts late.
// - The meta of a real-backend answer carries the token usage and attempts the transport reported (numbers only).
import { effectiveBackend, type AiBackendName } from "./backend";
import { fakeFlagPii, fakePhraseClaims, fakeStructure } from "./backends/fake";
import { fillClaimTemplate, keepsEverySlotValue } from "./claims";
import type { AiContext } from "./context";
import { AiOutputError, AiTimeoutError } from "./errors";
import { loadPrompt as defaultLoadPrompt, type LoadedPrompt } from "./prompts";
import { buildRequest, flagPiiUserTurn, phraseClaimsUserTurn, structureUserTurn, type ModelTransport } from "./requests";
import {
  FlagPiiOutputSchema,
  PhraseClaimsWireSchema,
  StructureOutputSchema,
  type Claim,
  type FlagPiiOutput,
  type PhraseClaimsOutput,
  type StructureOutput,
} from "./schemas";
import type { AiCallOptions, AiFunction, AiMeta, AiResult, AiUsage, LocationKind } from "./types";

type Env = Readonly<Record<string, string | undefined>>;
type RealBackend = Exclude<AiBackendName, "fake">;

export interface AiDeps {
  env?: () => Env;
  transports: Readonly<Record<RealBackend, ModelTransport>>;
  loadPrompt?: (fn: AiFunction) => LoadedPrompt;
  /** Monotonic clock for latencyMs (default performance.now). */
  now?: () => number;
  /** Wall clock for deadlines (default Date.now), the clock of AiCallOptions.deadline. */
  wallClock?: () => number;
}

/** A real-backend call is not started with less than this left before the caller's deadline: it could not answer. */
export const MIN_CALL_WINDOW_MS = 1_000;

/** What one real-backend call returned, before validation. */
interface Asked {
  raw: unknown;
  model: string;
  promptSha: string;
  cliVersion?: string;
  usage?: AiUsage;
  attempts?: number;
}

export interface AiFunctions {
  /** Summary (second person, at most 2 sentences) and 1-3 suggested areas, from REDACTED text only. */
  structure(maskedText: string, locationKind: LocationKind, ctx?: AiContext, opts?: AiCallOptions): Promise<AiResult<StructureOutput>>;
  /** Layer 2 of redaction (domain §5): exact substrings of the layer-1 masked text that identify a person. */
  flagPii(maskedText: string, ctx?: AiContext, opts?: AiCallOptions): Promise<AiResult<FlagPiiOutput>>;
  /** Plain-language wording of compiled report claims (domain §7), in the claims' order. */
  phraseClaims(claims: Claim[], ctx?: AiContext, opts?: AiCallOptions): Promise<AiResult<PhraseClaimsOutput>>;
}

/** Areas listed once (the highest confidence wins), most confident first. */
export function normalizeStructure(v: StructureOutput): StructureOutput {
  const best = new Map<string, StructureOutput["priorityAreas"][number]>();
  for (const a of v.priorityAreas) {
    const seen = best.get(a.area);
    if (!seen || a.confidence > seen.confidence) best.set(a.area, a);
  }
  const areas = [...best.values()].sort((a, b) => b.confidence - a.confidence);
  return { summary: v.summary.trim(), priorityAreas: areas, uncertain: v.uncertain };
}

/** domain §5: exact substrings only. Throws AiOutputError when any item is not one; drops exact duplicates. */
export function checkPiiItems(v: FlagPiiOutput, maskedText: string, backend: AiBackendName): FlagPiiOutput {
  if (v.items.some((i) => !maskedText.includes(i.text))) {
    throw new AiOutputError(backend, "The flagPii answer held text that is not an exact substring of the report.");
  }
  const seen = new Set<string>();
  const items = v.items.filter((i) => {
    const key = `${i.type}\u0000${i.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items };
}

/** One sentence per claim, in the claims' order; a sentence that lost a slot value becomes the filled template. */
export function checkSentences(sentences: PhraseClaimsOutput, claims: Claim[], backend: AiBackendName): PhraseClaimsOutput {
  const want = claims.map((c) => c.claimId).sort();
  const got = sentences.map((s) => s.claimId).sort();
  if (want.length !== got.length || want.some((id, i) => id !== got[i])) {
    throw new AiOutputError(backend, "The phraseClaims answer did not hold exactly one sentence per claim.");
  }
  const byId = new Map(sentences.map((s) => [s.claimId, s.text.trim()]));
  return claims.map((c) => {
    const text = byId.get(c.claimId) ?? "";
    const ok = text.length > 0 && !/[{}]/.test(text) && keepsEverySlotValue(c, text);
    return { claimId: c.claimId, text: ok ? text : fillClaimTemplate(c) };
  });
}

export function createAi(deps: AiDeps): AiFunctions {
  const env = deps.env ?? (() => process.env);
  const load = deps.loadPrompt ?? defaultLoadPrompt;
  const now = deps.now ?? (() => performance.now());
  const wallClock = deps.wallClock ?? (() => Date.now());

  function meta(backend: AiBackendName, model: string, promptSha: string, started: number, from?: Asked): AiMeta {
    const m: AiMeta = { backend, model, promptSha, latencyMs: Math.max(0, Math.round(now() - started)) };
    if (from?.cliVersion) m.cliVersion = from.cliVersion;
    if (from?.usage) m.usage = from.usage;
    if (from?.attempts !== undefined) m.attempts = from.attempts;
    return m;
  }

  /** The transport's answer, or an AiTimeoutError at the deadline (whatever the transport is still doing). */
  function withinDeadline<T>(backend: RealBackend, work: Promise<T>, deadline: number, budgetMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiTimeoutError(backend, budgetMs)), Math.max(0, deadline - wallClock()));
    });
    work.catch(() => {}); // a late failure after the deadline has nobody waiting for it
    return Promise.race([work, late]).finally(() => clearTimeout(timer));
  }

  /** One model call through the chosen real backend: the prompt file + the user turn. Returns the raw answer. */
  async function ask(backend: RealBackend, fn: AiFunction, userTurn: string, ctx: AiContext | undefined, opts?: AiCallOptions): Promise<Asked> {
    const deadline = opts?.deadline;
    const startedAt = wallClock();
    if (deadline !== undefined && deadline - startedAt < MIN_CALL_WINDOW_MS) {
      throw new AiTimeoutError(backend, Math.max(0, deadline - startedAt)); // too little time left to answer: not started
    }
    const prompt = load(fn);
    const request = buildRequest(fn, prompt, userTurn);
    const reply =
      deadline === undefined
        ? await deps.transports[backend].complete(request, ctx)
        : await withinDeadline(backend, deps.transports[backend].complete(request, ctx, { deadline }), deadline, deadline - startedAt);
    const asked: Asked = { raw: reply.raw, model: reply.model, promptSha: prompt.sha };
    if (reply.cliVersion) asked.cliVersion = reply.cliVersion;
    if (reply.usage) asked.usage = reply.usage;
    if (reply.attempts !== undefined) asked.attempts = reply.attempts;
    return asked;
  }

  function mismatch(backend: AiBackendName, fn: AiFunction): AiOutputError {
    return new AiOutputError(backend, `The ${fn} answer did not match its schema.`);
  }

  return {
    async structure(maskedText, locationKind, ctx, opts) {
      const backend = effectiveBackend(env());
      const started = now();
      if (backend === "fake") {
        const f = fakeStructure(maskedText);
        return { value: normalizeStructure(f.value), meta: meta(backend, f.model, f.promptSha, started) };
      }
      const a = await ask(backend, "structure", structureUserTurn(maskedText, locationKind), ctx, opts);
      const parsed = StructureOutputSchema.safeParse(a.raw);
      if (!parsed.success) throw mismatch(backend, "structure");
      return { value: normalizeStructure(parsed.data), meta: meta(backend, a.model, a.promptSha, started, a) };
    },

    async flagPii(maskedText, ctx, opts) {
      const backend = effectiveBackend(env());
      const started = now();
      if (backend === "fake") {
        const f = fakeFlagPii(maskedText);
        return { value: checkPiiItems(f.value, maskedText, backend), meta: meta(backend, f.model, f.promptSha, started) };
      }
      const a = await ask(backend, "flagPii", flagPiiUserTurn(maskedText), ctx, opts);
      const parsed = FlagPiiOutputSchema.safeParse(a.raw);
      if (!parsed.success) throw mismatch(backend, "flagPii");
      return {
        value: checkPiiItems(parsed.data, maskedText, backend),
        meta: meta(backend, a.model, a.promptSha, started, a),
      };
    },

    async phraseClaims(claims, ctx, opts) {
      const backend = effectiveBackend(env());
      const started = now();
      if (backend === "fake") {
        const f = fakePhraseClaims(claims);
        return { value: checkSentences(f.value, claims, backend), meta: meta(backend, f.model, f.promptSha, started) };
      }
      if (claims.length === 0) {
        return { value: [], meta: meta(backend, "none", load("phraseClaims").sha, started) };
      }
      const a = await ask(backend, "phraseClaims", phraseClaimsUserTurn(claims), ctx, opts);
      const parsed = PhraseClaimsWireSchema.safeParse(a.raw);
      if (!parsed.success) throw mismatch(backend, "phraseClaims");
      return {
        value: checkSentences(parsed.data.sentences, claims, backend),
        meta: meta(backend, a.model, a.promptSha, started, a),
      };
    },
  };
}
