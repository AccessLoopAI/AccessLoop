// A real model's answer can be long (many layer-2 items, long "uncertain" notes). The preview token that carries it
// to "Send report" has a size limit (the submit action's zod schema, openPreview). buildPreview must never hand out
// a token that "Send report" would refuse: a too-long answer gets the shared fallback (no summary) instead, with the
// token sealed again without it so "Send report" keeps layer 2 (it never calls the AI itself, domain §6.1 limit 4).
// The AI is the fake backend; only structureOrFallback's / flagPiiOrFallback's answers are replaced. Never a real model.
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flagPiiOrFallback, structureOrFallback } from "@/lib/ai";
import { buildPreview, prepareCase } from "@/lib/intake/pipeline";
import { openPreview, PREVIEW_TOKEN_MAX } from "@/lib/intake/preview-token";

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...actual,
    structureOrFallback: vi.fn(actual.structureOrFallback),
    flagPiiOrFallback: vi.fn(actual.flagPiiOrFallback),
  };
});

const TEXT = "The automatic door button at the King Street branch has been broken for three weeks.";
const ORG = randomUUID();

const saved = { ...process.env };
beforeEach(() => {
  process.env.FAKE_LLM = "1";
  process.env.AI_BACKEND = "fake";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

describe("the preview token always fits Send report", () => {
  it("a normal answer gives a token within the limit that Send report can open", async () => {
    const p = await buildPreview(ORG, { text: TEXT, locationKind: "place", locationDetail: "", aiOptOut: false });
    expect(p.summary).toBeTruthy();
    expect(p.token!.length).toBeLessThanOrEqual(PREVIEW_TOKEN_MAX);
    expect(openPreview(p.token)?.ai?.value.summary).toBe(p.summary);
  });

  const longAnswer = () =>
    vi.mocked(structureOrFallback).mockResolvedValueOnce({
      value: {
        summary: "You couldn't get in because the door button is broken.",
        priorityAreas: [{ area: "built_environment", confidence: 0.9 }],
        uncertain: Array.from({ length: 400 }, (_, i) => `a long note number ${i} about what is not clear`),
      },
      meta: { backend: "api", model: "test-model", promptSha: "0".repeat(64), latencyMs: 5 },
    });

  it("a very long model answer falls back to no summary, keeps layer 2 in the token, and says so without any report text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    longAnswer();
    const p = await buildPreview(ORG, { text: TEXT, locationKind: "place", locationDetail: "", aiOptOut: false });
    expect(p.summary).toBeNull();
    expect(p.token!.length).toBeLessThanOrEqual(PREVIEW_TOKEN_MAX);
    const payload = openPreview(p.token)!;
    expect(payload.ai).toBeNull();
    expect(payload.pii).not.toBeNull(); // the fake flagPii's answer, so "Send report" needs no AI call for names
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/too long for Send report/);
    expect(String(log.mock.calls[0][0])).not.toContain("King Street");

    const c = await prepareCase(
      ORG,
      { text: TEXT, locationKind: "place", locationDetail: "", wantsRetest: false, emailChoice: "anonymous", email: "", aiOptOut: false, choice: null, editedSummary: "", token: p.token },
      null,
    );
    expect(c.ai).toBeNull();
    expect(c.summarySource).toBe("reporter_words");
    expect(c.needsManualRedaction).toBe(false); // layer 2 came with the token
  });

  it("when even the layer-2 values are too long there is no token, and sending fails closed without the AI", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    longAnswer();
    vi.mocked(flagPiiOrFallback).mockResolvedValueOnce({
      value: { items: Array.from({ length: 400 }, (_, i) => ({ text: `Person Number${i}`, type: "PERSON" as const, reason: "a name the model found here" })) },
      meta: { backend: "api", model: "test-model", promptSha: "0".repeat(64), latencyMs: 5 },
    });
    const p = await buildPreview(ORG, { text: TEXT, locationKind: "place", locationDetail: "", aiOptOut: false });
    expect(p).toEqual({ summary: null, token: null });
    expect(log).toHaveBeenCalledTimes(1);

    vi.mocked(flagPiiOrFallback).mockClear();
    const c = await prepareCase(
      ORG,
      { text: TEXT, locationKind: "place", locationDetail: "", wantsRetest: false, emailChoice: "anonymous", email: "", aiOptOut: false, choice: null, editedSummary: "", token: null },
      null,
    );
    expect(flagPiiOrFallback).not.toHaveBeenCalled(); // "Send report" never waits on the AI (domain §6.1 limit 4)
    expect(c.needsManualRedaction).toBe(true); // layer 1 kept; the lead looks for names (domain §5)
  });
});
