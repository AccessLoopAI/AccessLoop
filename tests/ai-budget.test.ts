// The AI spend budget (lib/ai/budget.ts, issue #19): prices from lib/ai/pricing.json in whole micro-dollars, the
// worst case reserved before a call, the real cost recorded after it, the lifetime and daily budgets, and the guard
// around one call, against an in-memory SpendLedger that keeps the ledger contract (one atomic reserve, one settle per
// reservation). No database, no network, no real model.
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiBackendUnavailableError, AiConfigError, AiError, AiTimeoutError, loadPrompt } from "@/lib/ai";
import {
  AiBudgetError,
  BYTES_PER_TOKEN_ESTIMATE,
  PRICES_CHECKED_ON,
  TOOL_USE_OVERHEAD_TOKENS,
  budgetLimits,
  callCostMicroUsd,
  checkBudget,
  createSpendGuard,
  estimatePromptTokens,
  modelPricing,
  worstCaseMicroUsd,
  type SpendLedger,
  type SpendReservation,
  type SpendTotals,
} from "@/lib/ai/budget";
import modelDefaults from "@/lib/ai/models.json";
import pricing from "@/lib/ai/pricing.json";
import { buildRequest, structureUserTurn, type ModelReply } from "@/lib/ai/requests";
import type { AiUsage } from "@/lib/ai/types";

const REPORT = "The elevator at the Bay Street branch has been out of service for a month, so I can't reach the second floor.";
const structureReq = (text = REPORT) => buildRequest("structure", loadPrompt("structure"), structureUserTurn(text, "place"));
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";

/** An in-memory SpendLedger: reserve() reads and writes with no await in between, so it is atomic. */
function memoryLedger() {
  const rows = new Map<string, { reservation: SpendReservation; cost: number | null; usage?: AiUsage }>();
  let next = 0;
  const totalsOf = (day: string): SpendTotals => {
    let totalMicroUsd = 0;
    let dayMicroUsd = 0;
    for (const { reservation, cost } of rows.values()) {
      const counted = cost ?? reservation.worstMicroUsd;
      totalMicroUsd += counted;
      if (reservation.day === day) dayMicroUsd += counted;
    }
    return { totalMicroUsd, dayMicroUsd };
  };
  const ledger: SpendLedger = {
    async reserve(reservation, limits) {
      const decision = checkBudget(totalsOf(reservation.day), reservation.worstMicroUsd, limits);
      if (!decision.ok) return decision;
      const id = `r${++next}`;
      rows.set(id, { reservation, cost: null });
      return { ok: true, id };
    },
    async settle(id, cost, usage) {
      const row = rows.get(id);
      if (!row || row.cost !== null) throw new Error(`settle(${id}): unknown or already settled`);
      row.cost = cost;
      row.usage = usage;
    },
    async totals(day) {
      return totalsOf(day);
    },
  };
  return { ledger, rows };
}

const reply = (usage?: AiUsage, model = SONNET): ModelReply => ({ raw: {}, model, ...(usage ? { usage } : {}) });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lib/ai/pricing.json", () => {
  it("prices every default model and Claude Opus 5.5, with a checked date and rates of at most 3 decimals", () => {
    expect(PRICES_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const model of [modelDefaults.structure.default, modelDefaults.flagPii.default, modelDefaults.phraseClaims.default, "claude-opus-5-5"]) {
      expect(modelPricing(model), model).not.toBeNull();
    }
    for (const [model, p] of Object.entries(pricing.models) as [string, { rates: object; longPrompt?: { rates: object } }][]) {
      for (const card of [p.rates, p.longPrompt?.rates].filter(Boolean) as Record<string, number>[]) {
        expect(Object.keys(card).sort(), model).toEqual(["cacheRead", "cacheWrite1h", "cacheWrite5m", "input", "output"]);
        for (const rate of Object.values(card)) {
          expect(rate, model).toBeGreaterThanOrEqual(0);
          expect(Math.abs(rate * 1000 - Math.round(rate * 1000)), model).toBeLessThan(1e-9);
        }
      }
    }
  });

  it("matches an exact ID or the same ID with an 8-digit date suffix, nothing else", () => {
    expect(modelPricing(SONNET)?.name).toBe("Claude Sonnet 5.5");
    expect(modelPricing("claude-sonnet-5-5-20261001")?.name).toBe("Claude Sonnet 5.5");
    expect(modelPricing("claude-sonnet-5-5-preview")).toBeNull();
    expect(modelPricing("claude-future-9")).toBeNull();
    expect(modelPricing("toString")).toBeNull();
  });
});

describe("callCostMicroUsd (the real cost, rounded up to a micro-dollar)", () => {
  it("prices input, output, cache reads and cache writes (writes at the dearer 1-hour rate)", () => {
    // Claude Sonnet 5.5: $2 in, $10 out, $0.10 cache read, $4 1-hour cache write per million tokens.
    expect(callCostMicroUsd(SONNET, { inputTokens: 1000, outputTokens: 200 })).toBe(4000);
    expect(callCostMicroUsd(SONNET, { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 5000 })).toBe(4500);
    expect(callCostMicroUsd(SONNET, { inputTokens: 1000, outputTokens: 200, cacheCreationInputTokens: 2000 })).toBe(12_000);
    // Thinking tokens are already part of outputTokens: not counted twice.
    expect(callCostMicroUsd(SONNET, { inputTokens: 1000, outputTokens: 200, thinkingTokens: 150 })).toBe(4000);
    expect(callCostMicroUsd("claude-sonnet-5-5-20261001", { inputTokens: 1000, outputTokens: 200 })).toBe(4000);
  });

  it("never rounds a cost down", () => {
    expect(callCostMicroUsd(HAIKU, { inputTokens: 1, outputTokens: 0 })).toBe(1); // 0.1 micro-dollar
    expect(callCostMicroUsd(HAIKU, { inputTokens: 1000, outputTokens: 100 })).toBe(150);
    expect(callCostMicroUsd(HAIKU, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("Claude Haiku 5.5: a prompt over 100,000 tokens (cache reads and writes included) pays the long-prompt card for everything", () => {
    expect(callCostMicroUsd(HAIKU, { inputTokens: 100_000, outputTokens: 10 })).toBe(10_005);
    expect(callCostMicroUsd(HAIKU, { inputTokens: 100_001, outputTokens: 10 })).toBe(50_026); // 50,000.5 + 25, rounded up
    expect(callCostMicroUsd(HAIKU, { inputTokens: 60_000, outputTokens: 10, cacheReadInputTokens: 50_000 })).toBe(32_525);
  });

  it("a model with no price is an AiConfigError, never a guess", () => {
    expect(() => callCostMicroUsd("claude-future-9", { inputTokens: 1, outputTokens: 1 })).toThrow(AiConfigError);
    expect(() => callCostMicroUsd("claude-future-9", { inputTokens: 1, outputTokens: 1 })).toThrow(/lib\/ai\/pricing\.json/);
  });
});

describe("the worst case, reserved before a call", () => {
  it("over-estimates the prompt from its UTF-8 bytes, plus the tool-use overhead", () => {
    const req = structureReq();
    const tool = JSON.stringify({ name: req.toolName, description: req.toolDescription, input_schema: req.jsonSchema });
    const bytes = new TextEncoder().encode(req.prompt.text + req.userTurn + tool).length;
    expect(estimatePromptTokens(req)).toBe(Math.ceil(bytes / BYTES_PER_TOKEN_ESTIMATE) + TOOL_USE_OVERHEAD_TOKENS);
    // Accented text has more bytes than characters, so it is estimated higher than the same length in ASCII.
    const ascii = "e".repeat(400);
    const accented = "é".repeat(400);
    expect(estimatePromptTokens(structureReq(accented))).toBeGreaterThan(estimatePromptTokens(structureReq(ascii)));
  });

  it("prices the prompt at the dearest input-side rate and max_tokens at the output rate", () => {
    const req = structureReq();
    // Claude Sonnet 5.5: the 1-hour cache write ($4) is the dearest input-side rate; output $10; max_tokens 4096.
    expect(worstCaseMicroUsd(SONNET, req)).toBe(estimatePromptTokens(req) * 4 + req.maxTokens * 10);
    // A plausible real call costs far less than its reservation.
    expect(callCostMicroUsd(SONNET, { inputTokens: 3000, outputTokens: 400 })).toBeLessThan(worstCaseMicroUsd(SONNET, req));
  });

  it("a model with no price can't be reserved for", () => {
    expect(() => worstCaseMicroUsd("claude-future-9", structureReq())).toThrow(AiConfigError);
  });
});

describe("the budgets (AI_TOTAL_BUDGET_USD, AI_DAILY_BUDGET_USD)", () => {
  it("defaults to $4 for the life of the demo and $0.25 a day", () => {
    expect(budgetLimits({})).toEqual({ totalMicroUsd: 4_000_000, dailyMicroUsd: 250_000 });
    expect(budgetLimits({ AI_TOTAL_BUDGET_USD: " ", AI_DAILY_BUDGET_USD: "" })).toEqual({ totalMicroUsd: 4_000_000, dailyMicroUsd: 250_000 });
  });

  it("takes dollar amounts, 0 included; anything else is an AiConfigError naming the setting", () => {
    expect(budgetLimits({ AI_TOTAL_BUDGET_USD: "10.5", AI_DAILY_BUDGET_USD: "0" })).toEqual({ totalMicroUsd: 10_500_000, dailyMicroUsd: 0 });
    expect(budgetLimits({ AI_DAILY_BUDGET_USD: "0.000001" }).dailyMicroUsd).toBe(1);
    for (const bad of ["-1", "abc", "1e3", "$4", "4 USD", "0.0000001", "1234567"]) {
      expect(() => budgetLimits({ AI_TOTAL_BUDGET_USD: bad }), bad).toThrow(/AI_TOTAL_BUDGET_USD must be an amount/);
      expect(() => budgetLimits({ AI_DAILY_BUDGET_USD: bad }), bad).toThrow(/AI_DAILY_BUDGET_USD must be an amount/);
    }
  });

  it("spend may reach a budget exactly but never pass it; the lifetime budget is named first", () => {
    const limits = { totalMicroUsd: 1000, dailyMicroUsd: 500 };
    expect(checkBudget({ totalMicroUsd: 400, dayMicroUsd: 400 }, 100, limits)).toEqual({ ok: true });
    expect(checkBudget({ totalMicroUsd: 400, dayMicroUsd: 400 }, 101, limits)).toEqual({ ok: false, reached: "daily" });
    expect(checkBudget({ totalMicroUsd: 900, dayMicroUsd: 0 }, 100, limits)).toEqual({ ok: true });
    expect(checkBudget({ totalMicroUsd: 901, dayMicroUsd: 450 }, 100, limits)).toEqual({ ok: false, reached: "total" });
    expect(checkBudget({ totalMicroUsd: 0, dayMicroUsd: 0 }, 1, { totalMicroUsd: 0, dailyMicroUsd: 500 })).toEqual({ ok: false, reached: "total" });
  });
});

describe("the spend guard around one real call", () => {
  // 03:30 UTC on Oct 28 is still Oct 27 in Toronto (EDT, UTC-4).
  const NOW = new Date("2026-10-28T03:30:00.000Z");
  const guardWith = (env: Record<string, string> = {}) => {
    const mem = memoryLedger();
    return { ...mem, guard: createSpendGuard({ ledger: mem.ledger, env: () => env, now: () => NOW }) };
  };

  it("reserves the worst case on the Toronto day, makes the call, then records the real cost and the usage", async () => {
    const { guard, rows, ledger } = guardWith();
    const req = structureReq();
    const usage = { inputTokens: 1000, outputTokens: 200 };
    const call = vi.fn(async () => {
      // While the call runs, its worst case is counted.
      expect(await ledger.totals("2026-10-27")).toEqual({ totalMicroUsd: worstCaseMicroUsd(SONNET, req), dayMicroUsd: worstCaseMicroUsd(SONNET, req) });
      return reply(usage);
    });
    const r = await guard.run(req, SONNET, call);
    expect(r.usage).toEqual(usage);
    expect(call).toHaveBeenCalledTimes(1);
    expect([...rows.values()]).toEqual([
      { reservation: { fn: "structure", model: SONNET, day: "2026-10-27", worstMicroUsd: worstCaseMicroUsd(SONNET, req) }, cost: 4000, usage },
    ]);
    expect(await ledger.totals("2026-10-27")).toEqual({ totalMicroUsd: 4000, dayMicroUsd: 4000 });
    expect(await ledger.totals("2026-10-28")).toEqual({ totalMicroUsd: 4000, dayMicroUsd: 0 });
  });

  it("refuses with AiBudgetError, without calling, once the day's budget can't hold the worst case", async () => {
    const req = structureReq();
    const worst = worstCaseMicroUsd(SONNET, req);
    // Room for exactly one reservation today.
    const { guard, rows } = guardWith({ AI_DAILY_BUDGET_USD: (worst / 1e6).toFixed(6) });
    const call = vi.fn(async () => reply(undefined));
    await guard.run(req, SONNET, call); // no usage: the worst case stays counted
    const err = await guard.run(req, SONNET, call).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AiBudgetError);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ name: "AiBudgetError", reached: "daily", textFree: true });
    expect((err as Error).message).toMatch(/AI_DAILY_BUDGET_USD/);
    expect(call).toHaveBeenCalledTimes(1);
    expect(rows.size).toBe(1);
  });

  it("a lifetime budget of 0 pauses every real call", async () => {
    const { guard, rows } = guardWith({ AI_TOTAL_BUDGET_USD: "0" });
    const call = vi.fn(async () => reply({ inputTokens: 1, outputTokens: 1 }));
    const err = await guard.run(structureReq(), SONNET, call).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ reached: "total" });
    expect((err as Error).message).toMatch(/AI_TOTAL_BUDGET_USD/);
    expect(call).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it("a call that fails keeps its worst case (it may have been billed), unless nothing was billed", async () => {
    const { guard, rows } = guardWith();
    const req = structureReq();
    const worst = worstCaseMicroUsd(SONNET, req);
    const timeout = new AiTimeoutError("api", 10_000);
    await expect(guard.run(req, SONNET, async () => { throw timeout; })).rejects.toBe(timeout);
    const noKey = new AiBackendUnavailableError("api", "AI_BACKEND=api needs ANTHROPIC_API_KEY.");
    await expect(guard.run(req, SONNET, async () => { throw noKey; })).rejects.toBe(noKey);
    const badKnob = new AiConfigError("AI_API_TOOL_CHOICE must be auto or tool.");
    await expect(guard.run(req, SONNET, async () => { throw badKnob; })).rejects.toBe(badKnob);
    expect([...rows.values()].map((r) => r.cost)).toEqual([worst, 0, 0]);
  });

  it("calls running at the same time never both fit into the last of the budget", async () => {
    const req = structureReq();
    const worst = worstCaseMicroUsd(SONNET, req);
    const { guard, rows } = guardWith({ AI_DAILY_BUDGET_USD: ((3 * worst) / 1e6).toFixed(6) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const call = vi.fn(async () => {
      await gate;
      return reply(undefined);
    });
    const runs = Array.from({ length: 6 }, () => guard.run(req, SONNET, call).then(() => "ran", (e: unknown) => (e instanceof AiBudgetError ? e.reached : "other")));
    release();
    expect((await Promise.all(runs)).sort()).toEqual(["daily", "daily", "daily", "ran", "ran", "ran"]);
    expect(call).toHaveBeenCalledTimes(3);
    expect(rows.size).toBe(3);
  });

  it("a cost the ledger can't record keeps the answer, and the worst case stays counted", async () => {
    const { guard, ledger, rows } = guardWith();
    vi.spyOn(ledger, "settle").mockRejectedValue(new Error("connection lost"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const req = structureReq();
    const r = await guard.run(req, SONNET, async () => reply({ inputTokens: 1000, outputTokens: 200 }));
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 200 });
    expect([...rows.values()][0].cost).toBeNull();
    expect(await ledger.totals("2026-10-27")).toEqual({ totalMicroUsd: worstCaseMicroUsd(SONNET, req), dayMicroUsd: worstCaseMicroUsd(SONNET, req) });
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("[ai-budget]"));
    expect(String(logged.mock.calls[0][0])).not.toContain("connection lost");
  });

  it("a model with no price, or a budget setting it can't read, stops before any reservation or call", async () => {
    const call = vi.fn(async () => reply({ inputTokens: 1, outputTokens: 1 }));
    const priced = guardWith();
    await expect(priced.guard.run(structureReq(), "claude-future-9", call)).rejects.toThrow(AiConfigError);
    const misread = guardWith({ AI_DAILY_BUDGET_USD: "lots" });
    await expect(misread.guard.run(structureReq(), SONNET, call)).rejects.toThrow(/AI_DAILY_BUDGET_USD/);
    expect(call).not.toHaveBeenCalled();
    expect(priced.rows.size + misread.rows.size).toBe(0);
  });
});
