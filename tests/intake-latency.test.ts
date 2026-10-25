// The preview's time budget (lib/intake/pipeline.ts runIntakeAi; docs/decisions.md 2026-10-20 "Intake AI budget"):
// the two flagPii calls (the report and "Where exactly?") run in parallel, structure() starts as soon as the report's
// own layer 2 is done, and the whole preview ends within 10 s on the api backend whatever the model does: a call that
// is not done by then gets the shared fallback. Before, the three calls ran one after another, up to ~30 s.
//
// The AI here is the REAL lib/ai core and api transport with a STUBBED slow client (no network, never a real model),
// on vitest's fake clock, so "8 s per call" takes no real time. Only the two lib/ai fallback wrappers are pointed at
// that instance (the same four lines as lib/ai/index.ts).
import { randomBytes, randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flagPiiOrFallback, structureOrFallback, type AiFunctions } from "@/lib/ai";
import { createApiTransport, type MessagesClient } from "@/lib/ai/backends/api";
import { createAi } from "@/lib/ai/core";
import type { ModelTransport } from "@/lib/ai/requests";
import { buildPreview } from "@/lib/intake/pipeline";
import { openPreview } from "@/lib/intake/preview-token";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return { ...actual, structureOrFallback: vi.fn(actual.structureOrFallback), flagPiiOrFallback: vi.fn(actual.flagPiiOrFallback) };
});

const TEXT = "Hi, my name is Daniel Okafor. The automatic door button at the branch has been broken for three weeks.";
const DETAIL = "The side door near Daniel's usual bus stop";
const ORG = randomUUID();
const BUDGET_MS = 10_000;

interface Call {
  tool: string;
  startedAt: number;
  endedAt?: number;
  aborted?: boolean;
}

/** A Messages client that answers each tool after `delays[tool]` ms of (fake) time, or never; abort ends it. */
function slowClient(delays: Record<string, number | "never">) {
  const calls: Call[] = [];
  const answers: Record<string, unknown> = {
    record_personal_details: (text: string) => ({ items: text.includes("Daniel") ? [{ text: "Daniel", type: "PERSON", reason: "a name" }] : [] }),
    record_structure: () => ({
      summary: "The automatic door button at a branch has been broken for three weeks.",
      priorityAreas: [{ area: "built_environment", confidence: 0.93 }],
      uncertain: [],
    }),
  };
  const client: MessagesClient = {
    messages: {
      create(body, options) {
        const tool = body.tools?.[0] && "name" in body.tools[0] ? body.tools[0].name : "?";
        const call: Call = { tool, startedAt: Date.now() };
        calls.push(call);
        const userTurn = String(body.messages[0].content);
        return new Promise<Anthropic.Message>((resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            call.aborted = true;
            call.endedAt = Date.now();
            reject(new Anthropic.APIUserAbortError());
          });
          const delay = delays[tool];
          if (delay === "never") return;
          setTimeout(() => {
            call.endedAt = Date.now();
            resolve({
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: body.model,
              content: [{ type: "tool_use", id: "toolu_1", name: tool, input: (answers[tool] as (t: string) => unknown)(userTurn), caller: { type: "direct" } }],
              stop_reason: "tool_use",
              stop_sequence: null,
              usage: { input_tokens: 100, output_tokens: 20 },
            } as unknown as Anthropic.Message);
          }, delay);
        });
      },
    },
  };
  return { client, calls };
}

/** Points lib/ai's two fallback wrappers at an AI built on the slow client (same try/catch as lib/ai/index.ts). */
function wire(delays: Record<string, number | "never">) {
  const slow = slowClient(delays);
  const api = createApiTransport({ env: () => process.env, createClient: () => slow.client });
  const unused: ModelTransport = { complete: async () => { throw new Error("claude-cli must not be asked"); } };
  const ai: AiFunctions = createAi({ env: () => process.env, transports: { api, "claude-cli": unused } });
  vi.mocked(flagPiiOrFallback).mockImplementation(async (masked, ctx, onError, opts) => {
    try {
      return await ai.flagPii(masked, ctx, opts);
    } catch (err) {
      onError("flagPii", err);
      return null;
    }
  });
  vi.mocked(structureOrFallback).mockImplementation(async (masked, kind, ctx, onError, opts) => {
    try {
      return await ai.structure(masked, kind, ctx, opts);
    } catch (err) {
      onError("structure", err);
      return null;
    }
  });
  return slow;
}

/** Runs the preview on the fake clock; returns it and how long it took (fake ms). */
async function timedPreview(detail = DETAIL) {
  const started = Date.now();
  let doneAt: number | null = null;
  const p = buildPreview(ORG, { text: TEXT, locationKind: "place", locationDetail: detail, aiOptOut: false }).then((r) => {
    doneAt = Date.now();
    return r;
  });
  for (let i = 0; i < 300 && doneAt === null; i++) await vi.advanceTimersByTimeAsync(100);
  expect(doneAt, "the preview never finished").not.toBeNull();
  return { preview: await p, ms: doneAt! - started };
}

const saved = { ...process.env };
let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  process.env.FAKE_LLM = "0";
  process.env.AI_BACKEND = "api";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-a-real-key";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...saved };
  vi.restoreAllMocks();
});

const logged = () => errors.mock.calls.flat().map(String).join("\n");

describe("the preview's AI steps: parallel flagPii, one 10 s budget (api)", () => {
  it("both flagPii calls start together; structure starts when the report's own layer 2 is done", async () => {
    const slow = wire({ record_personal_details: 3_000, record_structure: 2_000 });
    const { preview, ms } = await timedPreview();
    const pii = slow.calls.filter((c) => c.tool === "record_personal_details");
    const structure = slow.calls.find((c) => c.tool === "record_structure")!;
    expect(pii).toHaveLength(2);
    expect(pii[0].startedAt).toBe(pii[1].startedAt); // in parallel, not one after the other
    expect(structure.startedAt).toBeGreaterThanOrEqual(pii[0].endedAt!);
    expect(ms).toBeLessThanOrEqual(5_100); // 3 s + 2 s; one after another it was 3 + 3 + 2 = 8 s
    expect(preview.summary).toMatch(/door button/);
    const payload = openPreview(preview.token)!;
    expect(payload.pii).toEqual([{ text: "Daniel", type: "PERSON", reason: "a name" }]);
    expect(payload.detail?.pii).toEqual([{ text: "Daniel", type: "PERSON", reason: "a name" }]);
    expect(payload.ai?.meta).toEqual({ backend: "api", model: "claude-sonnet-5-5", promptSha: expect.any(String), latencyMs: expect.any(Number) }); // no usage in the token
  });

  it("a slow stub (8 s per call) still finishes within 10 s: layer 2 kept, the late summary dropped", async () => {
    const slow = wire({ record_personal_details: 8_000, record_structure: 8_000 });
    const { preview, ms } = await timedPreview();
    expect(ms).toBeLessThanOrEqual(BUDGET_MS + 100);
    expect(preview.summary).toBeNull(); // the shared fallback: the review shows the person's own words
    expect(preview.token).not.toBeNull(); // "Send report" still works and never waits for the AI
    const payload = openPreview(preview.token)!;
    expect(payload.pii).not.toBeNull(); // both layer-2 answers came in time
    expect(payload.detail?.pii).not.toBeNull();
    expect(payload.ai).toBeNull();
    expect(slow.calls.find((c) => c.tool === "record_structure")?.aborted).toBe(true);
    expect(logged()).toContain("structure failed (AiTimeoutError)");
    expect(logged()).not.toContain("Daniel");
  });

  it("a stub that never answers: the preview ends at 10 s, layer 1 only and flagged for a person", async () => {
    const slow = wire({ record_personal_details: "never", record_structure: "never" });
    const { preview, ms } = await timedPreview();
    expect(ms).toBeLessThanOrEqual(BUDGET_MS + 100);
    expect(ms).toBeGreaterThanOrEqual(BUDGET_MS - 100);
    const payload = openPreview(preview.token)!;
    expect(payload.pii).toBeNull(); // needsManualRedaction at "Send report"
    expect(payload.ai).toBeNull();
    expect(slow.calls.filter((c) => c.tool === "record_personal_details").every((c) => c.aborted)).toBe(true);
    // structure was never started: layer 2 used the whole budget, so there was no time left to answer.
    expect(slow.calls.some((c) => c.tool === "record_structure")).toBe(false);
  });

  it("structure is not started with under a second left; the preview ends when layer 2 does", async () => {
    const slow = wire({ record_personal_details: 9_500, record_structure: 500 });
    const { preview, ms } = await timedPreview("");
    expect(slow.calls.map((c) => c.tool)).toEqual(["record_personal_details"]);
    expect(ms).toBeLessThanOrEqual(9_600);
    expect(preview.summary).toBeNull();
    expect(openPreview(preview.token)!.pii).not.toBeNull();
  });

  it("no detail: one flagPii call, then structure", async () => {
    const slow = wire({ record_personal_details: 1_000, record_structure: 1_000 });
    const { preview, ms } = await timedPreview("");
    expect(slow.calls.map((c) => c.tool)).toEqual(["record_personal_details", "record_structure"]);
    expect(ms).toBeLessThanOrEqual(2_100);
    expect(preview.summary).toBeTruthy();
  });
});
