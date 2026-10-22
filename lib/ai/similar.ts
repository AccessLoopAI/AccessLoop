// similarBarriers (docs/domain.md §6.2; docs/phase7-prompt.md T2 item 10): which past cases of the same org may
// describe the SAME barrier as this one (reported again, or back after a fix). Server-only. A typed AI function with
// the same contract as the three in lib/ai/core.ts:
// - Input: lead-approved PUBLIC SUMMARIES only, this case's and up to 40 candidates' (lib/cases/similar.ts picks
//   them: same org, same area, same kind of place, last 24 months). Each one is layer-1 masked once more here. No
//   reporter text, no redacted report text and no contact detail ever reaches this function.
// - The data goes in the USER turn as JSON inside <cases>...</cases>, with every "<" written as \u003c, so nothing in
//   a summary can open or close a tag; the prompt file (lib/ai/prompts/similar-barriers.md) says never to follow it.
// - Output: zod-validated {matches: [{ref, reason}]}. Every ref MUST be one of the candidates' refs, exactly: an answer
//   that names any other case (or this one) breaks the contract and is DROPPED whole (AiOutputError), the way a
//   flagPii answer that rewrote a value is. At most SIMILAR_MAX_MATCHES matches, each ref once.
// - It changes nothing. Nothing is merged, closed or linked: the case page shows the matches as an "AI suggestion"
//   and the lead decides. Nothing about the call is stored (it writes no event), so there is no payload to hash.
// - Backend per call: effectiveBackend() (FAKE_LLM=1 ? fake : AI_BACKEND), never another backend instead.
//   fake: lib/ai/fakes/similar-barriers.json. claude-cli: CLAUDE_CLI_MODEL, through the ONE CLI queue of the process
//   (processQueue: every transport shares it). api: the PII model lane (domain §6: Haiku via MODEL_PII), with
//   MODEL_SIMILAR in its place when it is set.
//
// Why a "lane": the real backends pick the model (and, on api, the effort knob) by the request's `fn`, one of the
// three AiFunctions of lib/ai/types.ts. A fourth AiFunction would mean editing every backend's per-function tables;
// this file is new and leaves them as they are. The request therefore travels as `flagPii` (the small, fast model the
// brief asks for), and this module swaps MODEL_SIMILAR into MODEL_PII for its own api transport only. A transport's
// error message may say "flagPii": callers log only the error's class (lib/cases/similar.ts).
import path from "node:path";
import { z } from "zod";
import similarFakes from "./fakes/similar-barriers.json";
import { sha256Hex } from "@/lib/crypto";
import { LOCATION_OPTIONS } from "@/lib/intake/types";
import { applyRedaction, detectPatterns } from "@/lib/redaction/patterns";
import { AREA_HEADINGS } from "@/lib/report/headings";
import { effectiveBackend, type AiBackendName } from "./backend";
import { createApiTransport } from "./backends/api";
import { createClaudeCliTransport } from "./backends/claude-cli";
import type { AiContext } from "./context";
import { AiOutputError } from "./errors";
import { loadPromptFile, type LoadedPrompt } from "./prompts";
import type { ModelRequest, ModelTransport } from "./requests";
import type { PriorityArea } from "./schemas";
import type { AiFunction, AiMeta, AiResult, LocationKind } from "./types";

type Env = Readonly<Record<string, string | undefined>>;
type RealBackend = Exclude<AiBackendName, "fake">;

/** The brief's cap on what the model reads: the 40 newest candidates. */
export const SIMILAR_MAX_CANDIDATES = 40;
/** At most this many suggestions are shown. */
export const SIMILAR_MAX_MATCHES = 5;
/** A reason longer than this is not "one short sentence": the answer does not match its schema. */
export const SIMILAR_REASON_MAX = 300;

/** The request lane on the real backends (see the note at the top): the PII model, Haiku by default. */
export const SIMILAR_LANE: AiFunction = "flagPii";

export const SIMILAR_PROMPT_FILE = "similar-barriers.md";

/** What the model answers. `ref` is checked against the candidates after parsing (checkSimilarMatches). */
export const SimilarBarriersOutputSchema = z.object({
  matches: z
    .array(
      z.object({
        ref: z.string().min(1).max(20),
        reason: z.string().min(1).max(SIMILAR_REASON_MAX),
      }),
    )
    .max(SIMILAR_MAX_CANDIDATES),
});
export type SimilarBarriersOutput = z.infer<typeof SimilarBarriersOutputSchema>;
export type SimilarMatch = SimilarBarriersOutput["matches"][number];

/** One past case the model may name: its reference and its lead-approved public summary. */
export interface SimilarCandidate {
  ref: string;
  summary: string;
}

export interface SimilarQuery {
  /** THIS case's lead-approved public summary. */
  summary: string;
  area: PriorityArea;
  locationKind: LocationKind;
  /** Newest first, at most SIMILAR_MAX_CANDIDATES (more are cut off here). Never this case itself. */
  candidates: readonly SimilarCandidate[];
}

/** Layer 1 again (the summaries were redacted when the lead saved them; this costs nothing and fails closed). */
function mask(text: string): string {
  return applyRedaction(text, detectPatterns(text));
}

function placeLabel(kind: LocationKind): string {
  return LOCATION_OPTIONS.find((o) => o.value === kind)?.label ?? "Somewhere else";
}

/** The query as the model and the fake see it: masked, trimmed, at most SIMILAR_MAX_CANDIDATES candidates. */
export function prepareSimilarQuery(q: SimilarQuery): SimilarQuery {
  return {
    summary: mask(q.summary.trim()),
    area: q.area,
    locationKind: q.locationKind,
    candidates: q.candidates.slice(0, SIMILAR_MAX_CANDIDATES).map((c) => ({ ref: c.ref, summary: mask(c.summary.trim()) })),
  };
}

/** The user turn: the data as JSON inside <cases>; "<" is written as \u003c so no value can form a tag. */
export function similarUserTurn(q: SimilarQuery): string {
  const data = {
    thisCase: { area: AREA_HEADINGS[q.area].canonical, place: placeLabel(q.locationKind), summary: q.summary },
    pastCases: q.candidates.map((c) => ({ ref: c.ref, summary: c.summary })),
  };
  return `<cases>\n${JSON.stringify(data, null, 2).replace(/</g, "\\u003c")}\n</cases>`;
}

let jsonSchema: Record<string, unknown> | null = null;

/** The request a real backend carries (tool name and JSON schema from the same zod schema that validates). */
export function similarRequest(prompt: LoadedPrompt, userTurn: string): ModelRequest {
  jsonSchema ??= z.toJSONSchema(SimilarBarriersOutputSchema) as Record<string, unknown>;
  return {
    fn: SIMILAR_LANE,
    prompt,
    userTurn,
    schema: SimilarBarriersOutputSchema,
    jsonSchema,
    toolName: "record_similar_cases",
    toolDescription:
      "Record the past cases that may describe the same barrier as this case (an empty list if none). Call it exactly once.",
    maxTokens: 2048,
  };
}

/**
 * The contract check, the same for every backend (fake included): every ref must be EXACTLY one of the candidates'
 * refs, or the whole answer is dropped (AiOutputError). Then each ref once (the first reason wins), the reason
 * trimmed and layer-1 masked (it is shown to staff), at most SIMILAR_MAX_MATCHES.
 */
export function checkSimilarMatches(
  v: SimilarBarriersOutput,
  candidates: readonly SimilarCandidate[],
  backend: AiBackendName,
): SimilarBarriersOutput {
  const allowed = new Set(candidates.map((c) => c.ref));
  if (v.matches.some((m) => !allowed.has(m.ref))) {
    throw new AiOutputError(backend, "The similarBarriers answer named a case that is not among the candidates.");
  }
  const seen = new Set<string>();
  const matches: SimilarMatch[] = [];
  for (const m of v.matches) {
    if (seen.has(m.ref)) continue;
    seen.add(m.ref);
    const reason = mask(m.reason.replace(/\s+/g, " ").trim());
    if (!reason) throw new AiOutputError(backend, "The similarBarriers answer held an empty reason.");
    matches.push({ ref: m.ref, reason });
  }
  return { matches: matches.slice(0, SIMILAR_MAX_MATCHES) };
}

/* ------------------------------------------------------------------ the fake backend */

interface FakeTopic {
  keywords: string[];
  reason: string;
}
const FAKE_TOPICS = (similarFakes as { topics: FakeTopic[] }).topics;
// As for the other fakes, "promptSha" is the sha256 of the fake data, so a changed fixture shows like a changed prompt.
const FAKE_SHA = sha256Hex(JSON.stringify(similarFakes));

/**
 * similar-barriers.json `_doc`: a topic applies when one of its keywords is in THIS case's summary (case-insensitive);
 * then every candidate whose summary holds one of the same topic's keywords is a match, with the topic's reason.
 * Candidates keep their order (newest first), each once (the first topic that fits wins), at most SIMILAR_MAX_MATCHES.
 */
export function fakeSimilarBarriers(q: SimilarQuery): { value: SimilarBarriersOutput; model: string; promptSha: string } {
  const has = (text: string, keyword: string) => text.toLowerCase().includes(keyword.toLowerCase());
  const topics = FAKE_TOPICS.filter((t) => t.keywords.some((k) => has(q.summary, k)));
  const matches: SimilarMatch[] = [];
  for (const c of q.candidates) {
    if (matches.length === SIMILAR_MAX_MATCHES) break;
    const topic = topics.find((t) => t.keywords.some((k) => has(c.summary, k)));
    if (topic) matches.push({ ref: c.ref, reason: topic.reason });
  }
  return { value: SimilarBarriersOutputSchema.parse({ matches }), model: "fake", promptSha: FAKE_SHA };
}

/* ------------------------------------------------------------------ the function */

/** The api backend's env for this function: MODEL_SIMILAR, when set, takes MODEL_PII's place (the lane's model). */
export function similarModelEnv(env: Env): Env {
  const model = env.MODEL_SIMILAR?.trim();
  return model ? { ...env, MODEL_PII: model } : env;
}

export function loadSimilarPrompt(): LoadedPrompt {
  return loadPromptFile(
    SIMILAR_LANE,
    path.join(process.cwd(), "lib", "ai", "prompts", SIMILAR_PROMPT_FILE),
    `lib/ai/prompts/${SIMILAR_PROMPT_FILE}`,
  );
}

export interface SimilarDeps {
  env?: () => Env;
  transports: Readonly<Record<RealBackend, ModelTransport>>;
  loadPrompt?: () => LoadedPrompt;
  now?: () => number;
}

export type SimilarBarriersFn = (q: SimilarQuery, ctx?: AiContext) => Promise<AiResult<SimilarBarriersOutput>>;

/** The function with its dependencies (tests inject stub transports; the app uses similarBarriers below). */
export function createSimilarBarriers(deps: SimilarDeps): SimilarBarriersFn {
  const env = deps.env ?? (() => process.env);
  const load = deps.loadPrompt ?? loadSimilarPrompt;
  const now = deps.now ?? (() => performance.now());
  const meta = (backend: AiBackendName, model: string, promptSha: string, started: number, cliVersion?: string): AiMeta => {
    const m: AiMeta = { backend, model, promptSha, latencyMs: Math.max(0, Math.round(now() - started)) };
    if (cliVersion) m.cliVersion = cliVersion;
    return m;
  };

  return async function similarBarriers(query, ctx) {
    const backend = effectiveBackend(env());
    const started = now();
    const q = prepareSimilarQuery(query);
    if (backend === "fake") {
      const f = fakeSimilarBarriers(q);
      return { value: checkSimilarMatches(f.value, q.candidates, backend), meta: meta(backend, f.model, f.promptSha, started) };
    }
    const prompt = load();
    if (q.candidates.length === 0) return { value: { matches: [] }, meta: meta(backend, "none", prompt.sha, started) };
    const reply = await deps.transports[backend].complete(similarRequest(prompt, similarUserTurn(q)), ctx);
    const parsed = SimilarBarriersOutputSchema.safeParse(reply.raw);
    if (!parsed.success) throw new AiOutputError(backend, "The similarBarriers answer did not match its schema.");
    return {
      value: checkSimilarMatches(parsed.data, q.candidates, backend),
      meta: meta(backend, reply.model, prompt.sha, started, reply.cliVersion),
    };
  };
}

let appFn: SimilarBarriersFn | null = null;

/**
 * Past cases that may be the same barrier, from public summaries only. Throws an AiError (text-free) when the
 * backend fails or the answer breaks the contract. Callers use similarBarriersOrNull.
 */
export function similarBarriers(q: SimilarQuery, ctx?: AiContext): Promise<AiResult<SimilarBarriersOutput>> {
  appFn ??= createSimilarBarriers({
    transports: {
      // A second transport object, the same one CLI queue (processQueue) and the same startup check rules.
      "claude-cli": createClaudeCliTransport(),
      api: createApiTransport({ env: () => similarModelEnv(process.env) }),
    },
  });
  return appFn(q, ctx);
}

/** similarBarriers() or null. null = no suggestion: the page says so, and the lead can still read the candidates. */
export async function similarBarriersOrNull(
  q: SimilarQuery,
  ctx: AiContext | undefined,
  onError: (err: unknown) => void,
): Promise<AiResult<SimilarBarriersOutput> | null> {
  try {
    return await similarBarriers(q, ctx);
  } catch (err) {
    onError(err);
    return null;
  }
}
