// The app's own AI spend budget (issue #19, AI3; improvement plan "Money guardrails", layer 2): every real api call
// reserves its worst-case cost before it starts and records what it really cost when it ends, and no call starts that
// could take spend past the lifetime or the daily budget. Pure logic: where spend is kept is a SpendLedger.
//
// - Prices: lib/ai/pricing.json (US dollars per million tokens, with the date they were copied). A model with no price
//   can't be budgeted, so its call is refused with an AiConfigError, never priced by a guess.
// - Money is counted in whole micro-dollars (1 USD = 1,000,000), rounded UP per call, so sums are exact and a call is
//   never recorded as cheaper than it was. For the arithmetic, a rate becomes whole billionths of a dollar per token.
// - Worst case, reserved before the call: the estimated prompt (estimatePromptTokens) at the dearest input-side rate
//   (a 1-hour cache write) plus max_tokens at the output rate. Thinking tokens are output tokens and count against
//   max_tokens, so they are inside it. The api transport's one retry follows only HTTP 429/529, which are not billed.
// - Real cost, recorded after the call: from the usage the API returned. AiUsage gives only the total of cache writes,
//   so they are priced at the 1-hour rate, the dearer one: the ledger can over-count, never under-count. A call that
//   throws keeps its worst case, because a request that was aborted or failed can still be billed, unless the error
//   says nothing was billed (unbilled()). A reply without usage keeps its worst case too.
// - Budgets: AI_TOTAL_BUDGET_USD (default 4, the life of the demo) and AI_DAILY_BUDGET_USD (default 0.25, one
//   America/Toronto calendar day, lib/dates.ts zonedDate, like the org daily cap). A reservation is refused when the
//   spend so far (recorded costs plus open reservations) plus its worst case would pass either; 0 pauses real AI. A
//   refusal is an AiBudgetError, and the caller takes the existing no-AI path (AI_PAUSED_MESSAGE on the public form).
// - Not here yet: the Postgres SpendLedger (it needs the ai_usage table, a change to the frozen db/schema.ts) and the
//   hook in lib/ai/core.ts (after AI2, #18). Only the api backend spends money: fake and claude-cli never use the guard.
import { zonedDate } from "@/lib/dates";
import { AiBackendUnavailableError, AiConfigError, AiError, AiNotAllowedError } from "./errors";
import pricingData from "./pricing.json";
import type { ModelReply, ModelRequest } from "./requests";
import type { AiFunction, AiUsage } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

export const MICRO_USD_PER_USD = 1_000_000;
export const AI_TOTAL_BUDGET_DEFAULT_USD = 4;
export const AI_DAILY_BUDGET_DEFAULT_USD = 0.25;

/** UTF-8 bytes per estimated prompt token: deliberately low (JSON schemas and accented French pack tighter than prose). */
export const BYTES_PER_TOKEN_ESTIMATE = 2;
/** Prompt tokens the API adds for tool use (its tool-use system prompt), rounded well up. */
export const TOOL_USE_OVERHEAD_TOKENS = 1_000;

/** US dollars per million tokens (the same number is micro-dollars per token). */
export interface RateCard {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface ModelPricing {
  name: string;
  rates: RateCard;
  /** A request whose prompt is over overInputTokens pays these rates for all of its tokens (Claude Haiku 5.5). */
  longPrompt?: { overInputTokens: number; rates: RateCard };
}

const PRICING = pricingData as unknown as { checkedOn: string; models: Record<string, ModelPricing> };

/** The day the prices in lib/ai/pricing.json were copied from Anthropic's pricing page. */
export const PRICES_CHECKED_ON = PRICING.checkedOn;

/** The pricing of a model ID: its exact entry, else the entry it is a dated ID of (`<entry>-YYYYMMDD`). */
export function modelPricing(model: string): ModelPricing | null {
  if (Object.hasOwn(PRICING.models, model)) return PRICING.models[model];
  const dated = /^(.*)-\d{8}$/.exec(model);
  return dated && Object.hasOwn(PRICING.models, dated[1]) ? PRICING.models[dated[1]] : null;
}

function requirePricing(model: string): ModelPricing {
  const pricing = modelPricing(model);
  if (!pricing) {
    throw new AiConfigError(
      `The AI budget has no price for model ${model.slice(0, 80)}, so a call to it can't be budgeted. ` +
        "Add the model to lib/ai/pricing.json or choose a priced one.",
    );
  }
  return pricing;
}

/** A rate in whole billionths of a dollar per token. */
function nanoPerToken(rate: number): number {
  const nano = Math.round(rate * 1000);
  if (!Number.isFinite(rate) || rate < 0 || Math.abs(rate * 1000 - nano) > 1e-6) {
    throw new AiConfigError("lib/ai/pricing.json: every rate must be a number of dollars with at most 3 decimal places.");
  }
  return nano;
}

/** Billionths of a dollar as whole micro-dollars, rounded up. */
const toMicro = (nano: number): number => Math.ceil(nano / 1000);

/** The rate card a request pays: the long-prompt card when its prompt is over the model's threshold. */
export function rateCardFor(pricing: ModelPricing, promptTokens: number): RateCard {
  return pricing.longPrompt && promptTokens > pricing.longPrompt.overInputTokens ? pricing.longPrompt.rates : pricing.rates;
}

/** What one call really cost, in micro-dollars, from the usage the API returned. */
export function callCostMicroUsd(model: string, usage: AiUsage): number {
  const pricing = requirePricing(model);
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  // The prompt length that picks the rate card counts every input token, cache reads and writes included.
  const card = rateCardFor(pricing, usage.inputTokens + cacheRead + cacheWrite);
  return toMicro(
    usage.inputTokens * nanoPerToken(card.input) +
      cacheRead * nanoPerToken(card.cacheRead) +
      cacheWrite * nanoPerToken(card.cacheWrite1h) +
      usage.outputTokens * nanoPerToken(card.output),
  );
}

const utf8 = new TextEncoder();

/**
 * An over-estimate of a request's prompt tokens: the UTF-8 bytes of the system prompt, the user turn and the tool (name,
 * description, full JSON schema) at BYTES_PER_TOKEN_ESTIMATE, plus TOOL_USE_OVERHEAD_TOKENS. Next to max_tokens the
 * prompt is small, so estimating it high costs little.
 */
export function estimatePromptTokens(req: ModelRequest): number {
  const tool = JSON.stringify({ name: req.toolName, description: req.toolDescription, input_schema: req.jsonSchema });
  const bytes = utf8.encode(req.prompt.text).length + utf8.encode(req.userTurn).length + utf8.encode(tool).length;
  return Math.ceil(bytes / BYTES_PER_TOKEN_ESTIMATE) + TOOL_USE_OVERHEAD_TOKENS;
}

/** The most one call can cost, in micro-dollars: what is reserved before it starts. */
export function worstCaseMicroUsd(model: string, req: ModelRequest): number {
  const prompt = estimatePromptTokens(req);
  const card = rateCardFor(requirePricing(model), prompt);
  const dearestInput = Math.max(card.input, card.cacheWrite5m, card.cacheWrite1h, card.cacheRead);
  return toMicro(prompt * nanoPerToken(dearestInput) + req.maxTokens * nanoPerToken(card.output));
}

export interface BudgetLimits {
  /** AI_TOTAL_BUDGET_USD: all spend ever recorded. */
  totalMicroUsd: number;
  /** AI_DAILY_BUDGET_USD: the spend of one America/Toronto calendar day. */
  dailyMicroUsd: number;
}

const USD = /^\d{1,6}(\.\d{1,6})?$/;

function usdSetting(env: Env, name: string, fallback: number): number {
  const raw = (env[name] ?? "").trim();
  if (!raw) return Math.round(fallback * MICRO_USD_PER_USD);
  if (!USD.test(raw)) throw new AiConfigError(`${name} must be an amount in US dollars, such as 4 or 0.25 (0 pauses real AI).`);
  return Math.round(Number(raw) * MICRO_USD_PER_USD);
}

/** The two budgets from the environment, defaults when unset. Any other value is a loud AiConfigError. */
export function budgetLimits(env: Env = process.env): BudgetLimits {
  return {
    totalMicroUsd: usdSetting(env, "AI_TOTAL_BUDGET_USD", AI_TOTAL_BUDGET_DEFAULT_USD),
    dailyMicroUsd: usdSetting(env, "AI_DAILY_BUDGET_USD", AI_DAILY_BUDGET_DEFAULT_USD),
  };
}

/** Spend so far, in micro-dollars: recorded costs plus the worst case of every open reservation. */
export interface SpendTotals {
  totalMicroUsd: number;
  /** Of the calendar day asked for. */
  dayMicroUsd: number;
}

export type BudgetReached = "total" | "daily";
export type BudgetDecision = { ok: true } | { ok: false; reached: BudgetReached };

/**
 * May a call with this worst case start? Spend may reach a budget exactly, never pass it. The lifetime budget is
 * checked first: when both are reached, it is the one that won't reset tomorrow.
 */
export function checkBudget(totals: SpendTotals, worstMicroUsd: number, limits: BudgetLimits): BudgetDecision {
  if (totals.totalMicroUsd + worstMicroUsd > limits.totalMicroUsd) return { ok: false, reached: "total" };
  if (totals.dayMicroUsd + worstMicroUsd > limits.dailyMicroUsd) return { ok: false, reached: "daily" };
  return { ok: true };
}

export interface SpendReservation {
  fn: AiFunction;
  model: string;
  /** The America/Toronto calendar day it counts against (YYYY-MM-DD). */
  day: string;
  worstMicroUsd: number;
}

export type ReserveResult = { ok: true; id: string } | { ok: false; reached: BudgetReached };

/**
 * Where spend is kept. reserve() reads the totals and adds the reservation as ONE atomic step, deciding with
 * checkBudget(): calls running at the same time, on any number of server instances, must never both fit into the
 * last cent. settle() closes a reservation once; its cost then replaces its worst case in the totals.
 */
export interface SpendLedger {
  reserve(reservation: SpendReservation, limits: BudgetLimits): Promise<ReserveResult>;
  settle(id: string, costMicroUsd: number, usage?: AiUsage): Promise<void>;
  totals(day: string): Promise<SpendTotals>;
}

/** No call was made: it could have taken AI spend past AI_TOTAL_BUDGET_USD or AI_DAILY_BUDGET_USD. Text-free. */
export class AiBudgetError extends AiError {
  readonly reached: BudgetReached;
  constructor(reached: BudgetReached) {
    super(
      reached === "total"
        ? "AI is paused: the lifetime AI budget (AI_TOTAL_BUDGET_USD) is spent."
        : "AI is paused until tomorrow: today's AI budget (AI_DAILY_BUDGET_USD) is spent.",
    );
    this.name = "AiBudgetError";
    this.reached = reached;
  }
}

/** Raised before any request, or refused by the API without billing (no key, a refused key). */
function unbilled(err: unknown): boolean {
  return err instanceof AiConfigError || err instanceof AiBackendUnavailableError || err instanceof AiNotAllowedError;
}

export interface SpendGuardDeps {
  ledger: SpendLedger;
  env?: () => Env;
  /** Wall clock for the budget day (default new Date()). */
  now?: () => Date;
}

export interface SpendGuard {
  /**
   * One real api call inside the budget: reserve its worst case, make it, record its real cost. Throws AiBudgetError
   * without calling when the call could pass a budget; whatever the call throws is thrown on.
   */
  run(req: ModelRequest, model: string, call: () => Promise<ModelReply>): Promise<ModelReply>;
}

export function createSpendGuard(deps: SpendGuardDeps): SpendGuard {
  const env = deps.env ?? (() => process.env);
  const now = deps.now ?? (() => new Date());

  /**
   * A cost that can't be recorded leaves its reservation open, so its worst case stays counted: over-counting, never
   * under. It never costs the caller an answer that was already paid for.
   */
  async function settle(id: string, costMicroUsd: number, usage?: AiUsage): Promise<void> {
    try {
      await deps.ledger.settle(id, costMicroUsd, usage);
    } catch (err) {
      console.error(`[ai-budget] a call's cost was not recorded; its worst case stays counted (${err instanceof Error ? err.name : "UnknownError"})`);
    }
  }

  return {
    async run(req, model, call) {
      const limits = budgetLimits(env());
      const worst = worstCaseMicroUsd(model, req);
      const reserved = await deps.ledger.reserve({ fn: req.fn, model, day: zonedDate(now()), worstMicroUsd: worst }, limits);
      if (!reserved.ok) throw new AiBudgetError(reserved.reached);
      let reply: ModelReply;
      try {
        reply = await call();
      } catch (err) {
        await settle(reserved.id, unbilled(err) ? 0 : worst);
        throw err;
      }
      await settle(reserved.id, reply.usage ? callCostMicroUsd(model, reply.usage) : worst, reply.usage);
      return reply;
    },
  };
}
