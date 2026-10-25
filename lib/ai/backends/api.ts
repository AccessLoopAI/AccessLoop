// The "api" AI backend (AI_BACKEND=api, FAKE_LLM=0): the Anthropic Messages API through @anthropic-ai/sdk
// (docs/domain.md §6.1). For tester sessions, judging, the live demo and published eval numbers.
//
// The request (docs/decisions.md 2026-10-20 "api request shape", checked against Anthropic's documentation that day):
// - Tool-use JSON output: ONE tool whose input_schema is the answer's JSON schema (z.toJSONSchema of the same zod
//   schema lib/ai/core.ts validates with). tool_choice is `auto`: Claude Opus 5.5 and Sonnet 5.5 reject a forced
//   tool_choice ("tool"/"any") with HTTP 400. The tool is `strict: true` on the models known to accept it, with the
//   JSON Schema keywords strict tools reject (minLength, maxLength, minimum, maximum, maxItems, ...) moved into the
//   description (strictToolSchema); zod stays the real validator. A plain-text answer with no tool call is an
//   AiOutputError, as before.
// - No temperature: Sonnet 5.5 and Opus 5.5 reject any non-default value, Haiku 5.5 accepts only 1.
// - output_config.effort `low` for structure by default (classification and a two-sentence summary; it also keeps
//   the preview inside its time budget); the other functions use the model's own default.
// - What each known model accepts is in lib/ai/models.json "families". A knob a human sets that the model is known to
//   reject is a loud AiConfigError before any call, never a request that 400s into the fallbacks.
// - One retry with jittered backoff on HTTP 429 or 529, only when it still fits the time budget. The whole call,
//   retry included, gets 10 s (API_TIMEOUT_MS), or less when the caller's deadline is sooner (lib/ai/types.ts
//   AiCallOptions; intake's preview shares one budget between its calls). The SDK's own retries stay off.
// - Token usage (input, output, cache, thinking) and the number of attempts are returned with the answer, numbers
//   only, for the eval's results.
// - Model IDs only from env: MODEL_STRUCTURE / MODEL_PII / MODEL_REPORT, else lib/ai/models.json (the domain §6
//   defaults, the one config place outside env that names model IDs).
// - ANTHROPIC_API_KEY is required; without it the call fails with a clear AiBackendUnavailableError. Never another
//   backend instead.
// - Knobs (.env.example): AI_API_TOOL_CHOICE=auto|tool, AI_API_TEMPERATURE=default|<0..1>,
//   AI_API_EFFORT_STRUCTURE / AI_API_EFFORT_PII / AI_API_EFFORT_REPORT (and AI_API_EFFORT for all three)
//   =low|medium|high|xhigh|max|default, AI_API_STRICT_TOOLS=1|0. They never change which backend answers.
// - Errors are mapped to text-free AiErrors: no SDK message (it could echo request content) is ever passed on.
import Anthropic from "@anthropic-ai/sdk";
import modelDefaults from "../models.json";
import type { AiContext } from "../context";
import { AiBackendUnavailableError, AiCallError, AiConfigError, AiOutputError, AiTimeoutError } from "../errors";
import { usageFromJson, type ModelReply, type ModelRequest, type ModelTransport } from "../requests";
import type { AiCallOptions, AiFunction } from "../types";

export const API_TIMEOUT_MS = 10_000;
/** The SDK's own retries stay off: they would not respect the time budget. Our one retry is in complete(). */
export const API_MAX_RETRIES = 0;
/** HTTP statuses worth one more try: rate limited (429) and overloaded (529). */
export const API_RETRY_STATUSES: readonly number[] = [429, 529];
/** The retry waits API_RETRY_BASE_MS x (0.5 to 1.5), or the server's retry-after when that is longer. */
export const API_RETRY_BASE_MS = 500;
/** The retry starts only if at least this much of the budget is left after its wait. */
export const API_RETRY_MIN_WINDOW_MS = 2_000;

type Env = Readonly<Record<string, string | undefined>>;

/** The part of the SDK client this backend uses (tests pass a stub). */
export interface MessagesClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal }): PromiseLike<Anthropic.Message>;
  };
}

export interface ApiClientOptions {
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

export interface ApiDeps {
  env?: () => Env;
  /** Builds the SDK client. Default: `new Anthropic(...)`. Tests always inject a stub. */
  createClient?: (opts: ApiClientOptions) => MessagesClient;
  /** The whole-call budget (default API_TIMEOUT_MS). Tests shorten it. */
  timeoutMs?: number;
  /** Wall clock in ms (default Date.now), the same clock as AiCallOptions.deadline. */
  now?: () => number;
  /** The retry's wait (default setTimeout). */
  sleep?: (ms: number) => Promise<void>;
  /** 0 <= x < 1 for the jitter (default Math.random). */
  random?: () => number;
}

interface FunctionDefault {
  env: string;
  default: string;
}

/** What a model accepts in a request (lib/ai/models.json "families"). */
export interface ModelFamily {
  name: string;
  forcedToolChoice: boolean;
  sampling: boolean;
  effort: boolean;
  strictTools: boolean;
}

const MODELS = modelDefaults as unknown as Record<AiFunction, FunctionDefault> & { families: Record<string, ModelFamily | string> };

/** The model ID for a function: its MODEL_* env value, else the lib/ai/models.json default. */
export function apiModelFor(fn: AiFunction, env: Env = process.env): string {
  const spec = MODELS[fn];
  return env[spec.env]?.trim() || spec.default;
}

/** The known family of a model ID (exact, or the same ID with a date suffix such as -20251001), else null. */
export function apiModelFamily(model: string): ModelFamily | null {
  for (const [id, family] of Object.entries(MODELS.families)) {
    if (id === "_doc" || typeof family === "string") continue;
    if (model === id || (model.startsWith(`${id}-`) && /^\d{8}$/.test(model.slice(id.length + 1)))) return family;
  }
  return null;
}

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ApiEffort = (typeof EFFORTS)[number];

/** The per-function effort knobs; AI_API_EFFORT applies to every function that has no value of its own. */
export const EFFORT_ENV: Readonly<Record<AiFunction, string>> = {
  structure: "AI_API_EFFORT_STRUCTURE",
  flagPii: "AI_API_EFFORT_PII",
  phraseClaims: "AI_API_EFFORT_REPORT",
};

/** The effort sent when no knob says otherwise, and only to a model known to accept effort. */
export const DEFAULT_EFFORT: Readonly<Record<AiFunction, ApiEffort | undefined>> = {
  structure: "low",
  flagPii: undefined,
  phraseClaims: undefined,
};

export interface ApiRequestShape {
  toolChoice: "auto" | "tool";
  /** undefined = send no temperature (the model's own default). */
  temperature: number | undefined;
  /** undefined = send no output_config (the model's own default effort). */
  effort: ApiEffort | undefined;
  /** strict: true on the tool, with strictToolSchema(). */
  strict: boolean;
}

function named(model: string, family: ModelFamily): string {
  return `${family.name} (${model.slice(0, 80)})`;
}

/**
 * The request shape for one function on one model, from the knobs and lib/ai/models.json's families. Unknown values,
 * and knobs the model is known to reject, are a loud AiConfigError (never a guess, never a 400 at call time).
 */
export function apiRequestShape(fn: AiFunction, model: string, env: Env = process.env): ApiRequestShape {
  const family = apiModelFamily(model);

  const choice = (env.AI_API_TOOL_CHOICE ?? "").trim() || "auto";
  if (choice !== "auto" && choice !== "tool") {
    throw new AiConfigError(`AI_API_TOOL_CHOICE must be "auto" (the default) or "tool".`);
  }
  if (choice === "tool" && family && !family.forcedToolChoice) {
    throw new AiConfigError(
      `AI_API_TOOL_CHOICE=tool: ${named(model, family)} rejects a forced tool_choice (HTTP 400). Set AI_API_TOOL_CHOICE=auto or remove it.`,
    );
  }

  const tempRaw = (env.AI_API_TEMPERATURE ?? "").trim() || "default";
  let temperature: number | undefined;
  if (tempRaw !== "default") {
    const t = Number(tempRaw);
    if (!/^\d+(\.\d+)?$/.test(tempRaw) || !(t >= 0 && t <= 1)) {
      throw new AiConfigError(`AI_API_TEMPERATURE must be "default" (send none, the default) or a number from 0 to 1.`);
    }
    if (family && !family.sampling) {
      throw new AiConfigError(
        `AI_API_TEMPERATURE=${tempRaw}: ${named(model, family)} rejects a temperature (HTTP 400). Set AI_API_TEMPERATURE=default or remove it.`,
      );
    }
    temperature = t;
  }

  const ownKnob = EFFORT_ENV[fn];
  const own = (env[ownKnob] ?? "").trim();
  const knob = own ? ownKnob : "AI_API_EFFORT";
  const effortRaw = own || (env.AI_API_EFFORT ?? "").trim();
  let effort: ApiEffort | undefined;
  if (effortRaw === "default") {
    effort = undefined;
  } else if (effortRaw) {
    if (!(EFFORTS as readonly string[]).includes(effortRaw)) {
      throw new AiConfigError(`${knob} must be one of ${EFFORTS.join(", ")}, or "default" (send none).`);
    }
    if (family && !family.effort) {
      throw new AiConfigError(
        `${knob}=${effortRaw}: ${named(model, family)} rejects output_config.effort. Set ${ownKnob}=default for this function.`,
      );
    }
    effort = effortRaw as ApiEffort;
  } else {
    effort = family?.effort ? DEFAULT_EFFORT[fn] : undefined;
  }

  const strictRaw = (env.AI_API_STRICT_TOOLS ?? "").trim();
  if (strictRaw !== "" && strictRaw !== "1" && strictRaw !== "0") {
    throw new AiConfigError(`AI_API_STRICT_TOOLS must be 1, 0, or unset (strict where the model is known to accept it).`);
  }
  const strict = strictRaw === "" ? Boolean(family?.strictTools) : strictRaw === "1";

  return { toolChoice: choice, temperature, effort, strict };
}

/** The key, or a clear error saying what to do. */
function requireKey(env: Env): string {
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new AiBackendUnavailableError(
      "api",
      "AI_BACKEND=api needs ANTHROPIC_API_KEY. Add it to .env.local (docs/handoff.md, Going live), " +
        "or set AI_BACKEND=fake and FAKE_LLM=1 to use the fake backend.",
    );
  }
  return key;
}

/** JSON Schema keywords that strict tools (and structured outputs) reject, per Anthropic's "JSON Schema limitations". */
const STRICT_DROPPED: readonly string[] = [
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "minProperties",
  "maxProperties",
  "uniqueItems",
];

/** A short sentence for the constraints strictToolSchema removes, so the model still reads them. */
function constraintNote(s: Record<string, unknown>): string | null {
  const num = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : undefined);
  // "at least 1 character", "at most 1 item": the unit is singular after a single bound of 1.
  const one = (n: number, unit: string) => (n === 1 ? unit.replace(/s$/, "") : unit);
  const range = (lo: number | undefined, hi: number | undefined, unit: string) => {
    if (lo !== undefined && hi !== undefined) return `${lo} to ${hi}${unit}`;
    if (lo !== undefined) return `at least ${lo}${one(lo, unit)}`;
    if (hi !== undefined) return `at most ${hi}${one(hi, unit)}`;
    return null;
  };
  const minItems = num("minItems");
  const parts = [
    range(num("minLength"), num("maxLength"), " characters"),
    range(num("minimum") ?? num("exclusiveMinimum"), num("maximum") ?? num("exclusiveMaximum"), ""),
    num("maxItems") !== undefined || (minItems !== undefined && minItems > 1) ? range(minItems, num("maxItems"), " items") : null,
  ].filter((p): p is string => p !== null);
  if (!parts.length) return null;
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/**
 * The tool's input_schema for `strict: true`: the answer's JSON schema without "$schema", without the keywords strict
 * tools reject (their meaning moves into the description), minItems kept only as 0 or 1, and `additionalProperties:
 * false` on every object. The zod schema still validates every answer (lib/ai/core.ts), so nothing is loosened.
 */
export function strictToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (k === "$schema" || STRICT_DROPPED.includes(k)) continue;
      if (k === "minItems" && !(v === 0 || v === 1)) continue;
      if (k === "properties" || k === "$defs" || k === "definitions") {
        out[k] = Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([name, sub]) => [name, walk(sub)]));
      } else if (k === "items" || k === "anyOf" || k === "allOf" || k === "oneOf" || k === "not" || k === "prefixItems") {
        out[k] = walk(v);
      } else {
        out[k] = v;
      }
    }
    const note = constraintNote(src);
    if (note) out.description = typeof src.description === "string" && src.description ? `${src.description} ${note}` : note;
    if (out.type === "object") out.additionalProperties = false;
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

/** The tool's input_schema: the answer's JSON schema without the "$schema" dialect line (strict: strictToolSchema). */
function inputSchema(req: ModelRequest, strict: boolean): Anthropic.Tool.InputSchema {
  if (strict) return strictToolSchema(req.jsonSchema) as Anthropic.Tool.InputSchema;
  const copy: Record<string, unknown> = { ...req.jsonSchema };
  delete copy.$schema;
  return copy as Anthropic.Tool.InputSchema;
}

/** The exact request body for one call (exported for tests and for the eval's record of what was sent). */
export function buildApiBody(req: ModelRequest, model: string, shape: ApiRequestShape): Anthropic.MessageCreateParamsNonStreaming {
  const tool: Anthropic.Tool = { name: req.toolName, description: req.toolDescription, input_schema: inputSchema(req, shape.strict) };
  if (shape.strict) tool.strict = true;
  return {
    model,
    max_tokens: req.maxTokens,
    // The prompt file only. Reporter text never goes in the system prompt (CLAUDE.md "AI contract").
    system: req.prompt.text,
    messages: [{ role: "user", content: req.userTurn }],
    tools: [tool],
    tool_choice: shape.toolChoice === "tool" ? { type: "tool", name: req.toolName } : { type: "auto" },
    ...(shape.temperature !== undefined ? { temperature: shape.temperature } : {}),
    ...(shape.effort ? { output_config: { effort: shape.effort } } : {}),
  };
}

/** SDK errors -> text-free AiErrors (most specific first). The SDK's own message is never passed on. */
function mapError(err: unknown, budgetMs: number): never {
  if (err instanceof AiTimeoutError) throw err;
  if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiTimeoutError("api", budgetMs);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    throw new AiBackendUnavailableError(
      "api",
      `The Anthropic API refused ANTHROPIC_API_KEY (HTTP ${err.status}). Check the key in .env.local.`,
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    throw new AiCallError("api", "The Anthropic API answered HTTP 404 (not_found_error). Check the MODEL_* model IDs.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    throw new AiCallError(
      "api",
      "The Anthropic API refused the request (HTTP 400 invalid_request_error). Check the AI_API_* request settings for " +
        "this model in .env.local (docs/decisions.md, api request shape), and whether the spend limit set in the " +
        "Claude Console was reached.",
    );
  }
  if (err instanceof Anthropic.APIConnectionError) throw new AiCallError("api", "Could not reach the Anthropic API.");
  if (err instanceof Anthropic.APIError) {
    const type = typeof err.type === "string" && /^[a-z_]{1,40}$/.test(err.type) ? ` ${err.type}` : "";
    throw new AiCallError("api", `The Anthropic API answered HTTP ${err.status ?? "error"}${type}.`);
  }
  throw new AiCallError("api", `The Anthropic API call failed (${err instanceof Error ? err.name : "UnknownError"}).`);
}

/** HTTP 429 (rate limited) or 529 (overloaded): worth one more try. */
export function isRetryableApiError(err: unknown): boolean {
  return err instanceof Anthropic.APIError && typeof err.status === "number" && API_RETRY_STATUSES.includes(err.status);
}

/** The server's retry-after (retry-after-ms, else retry-after in seconds), in ms; null when there is none. */
function retryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: { get?: (name: string) => string | null } } | null)?.headers;
  if (!headers || typeof headers.get !== "function") return null;
  const ms = Number(headers.get("retry-after-ms"));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const s = Number(headers.get("retry-after"));
  if (Number.isFinite(s) && s > 0) return s * 1000;
  return null;
}

/** How long the one retry waits: jittered (0.5 to 1.5 x API_RETRY_BASE_MS), or the server's retry-after if longer. */
export function apiRetryDelayMs(err: unknown, random: () => number = Math.random): number {
  const jittered = API_RETRY_BASE_MS * (0.5 + Math.min(Math.max(random(), 0), 1));
  return Math.round(Math.max(jittered, retryAfterMs(err) ?? 0));
}

export interface ApiTransport extends ModelTransport {
  /** Everything that can be checked without a network call: the key and the request shape per function. */
  checkReady(): { models: Record<AiFunction, string> };
}

/**
 * The real SDK client. Everything that could otherwise come from the environment is pinned:
 * - authToken: null, so an ANTHROPIC_AUTH_TOKEN in the environment can't ride along with the key;
 * - logLevel "off": at ANTHROPIC_LOG=debug the SDK logs whole request and response bodies, and those hold report
 *   text (layer-1-masked, names still in it) and the model's answer (CLAUDE.md "Never log raw report text");
 * - openTelemetry false: no spans, so ANTHROPIC_OPEN_TELEMETRY_TRACES_CONTENT_MODE=content can't copy that text
 *   into traces either. Our own logs stay text-free (mapError, lib/ai's fallbacks).
 */
export function createDefaultApiClient(o: ApiClientOptions): MessagesClient {
  return new Anthropic({
    apiKey: o.apiKey,
    authToken: null,
    timeout: o.timeout,
    maxRetries: o.maxRetries,
    logLevel: "off",
    openTelemetry: false,
  });
}

const FUNCTIONS: readonly AiFunction[] = ["structure", "flagPii", "phraseClaims"];

export function createApiTransport(deps: ApiDeps = {}): ApiTransport {
  const env = deps.env ?? (() => process.env);
  const createClient = deps.createClient ?? createDefaultApiClient;
  const injected = Boolean(deps.createClient);
  const timeoutMs = deps.timeoutMs ?? API_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = deps.random ?? Math.random;

  /**
   * One request with a deadline that covers the WHOLE request. The SDK's own `timeout` only runs until the response
   * headers arrive (reading the body is not covered), so this deadline also aborts the request (the SDK links the
   * signal to its fetch and body) and stops waiting whatever the SDK does. SDK errors are thrown as they are.
   */
  async function createWithDeadline(
    client: MessagesClient,
    body: Anthropic.MessageCreateParamsNonStreaming,
    ms: number,
    budgetMs: number,
  ): Promise<Anthropic.Message> {
    const deadline = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        deadline.abort();
        reject(new AiTimeoutError("api", budgetMs));
      }, ms);
    });
    try {
      return await Promise.race([Promise.resolve(client.messages.create(body, { signal: deadline.signal })), late]);
    } catch (err) {
      if (err instanceof AiTimeoutError || deadline.signal.aborted) throw new AiTimeoutError("api", budgetMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function checkReady() {
    const e = env();
    requireKey(e);
    const models = {} as Record<AiFunction, string>;
    for (const fn of FUNCTIONS) {
      models[fn] = apiModelFor(fn, e);
      apiRequestShape(fn, models[fn], e);
    }
    return { models };
  }

  async function complete(req: ModelRequest, ctx: AiContext | undefined, opts?: AiCallOptions): Promise<ModelReply> {
    void ctx; // the api backend serves any caller; only claude-cli is limited to local use
    const e = env();
    const apiKey = requireKey(e);
    if (e.VITEST && !injected) {
      // CLAUDE.md: never call a real model in tests. A test that reaches this point forgot to stub the client.
      throw new AiBackendUnavailableError("api", "The api backend never calls the real API under vitest: inject a stub client.");
    }
    const model = apiModelFor(req.fn, e);
    const body = buildApiBody(req, model, apiRequestShape(req.fn, model, e));
    const client = createClient({ apiKey, timeout: timeoutMs, maxRetries: API_MAX_RETRIES });

    // The budget for the whole call, retry included: 10 s, or less when the caller's deadline is sooner.
    const started = now();
    const end = Math.min(started + timeoutMs, opts?.deadline ?? Number.POSITIVE_INFINITY);
    const budgetMs = Math.max(0, end - started);
    let attempts = 0;
    let msg: Anthropic.Message;
    for (;;) {
      attempts++;
      const left = end - now();
      if (left <= 0) throw new AiTimeoutError("api", budgetMs);
      try {
        msg = await createWithDeadline(client, body, left, budgetMs);
        break;
      } catch (err) {
        if (attempts === 1 && isRetryableApiError(err)) {
          const wait = apiRetryDelayMs(err, random);
          if (now() + wait + API_RETRY_MIN_WINDOW_MS <= end) {
            await sleep(wait);
            continue;
          }
        }
        mapError(err, budgetMs);
      }
    }

    if (msg.stop_reason === "refusal") throw new AiCallError("api", "The model declined the request (stop_reason refusal).");
    if (msg.stop_reason === "max_tokens") throw new AiOutputError("api", `The ${req.fn} answer was cut off at max_tokens.`);
    const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === req.toolName);
    if (!call) throw new AiOutputError("api", `The model did not call ${req.toolName} for ${req.fn}.`);
    const reply: ModelReply = { raw: call.input, model, attempts };
    const usage = usageFromJson(msg.usage);
    if (usage) reply.usage = usage;
    return reply;
  }

  return { complete, checkReady };
}
