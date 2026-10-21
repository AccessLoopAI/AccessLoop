// lib/intake/redact.ts: the server-side redaction pipeline for intake (docs/domain.md §5), on the exact
// e2e/demo.spec.ts SCENARIO. Layer 1 = deterministic patterns, layer 2 = fake flagPii on the masked text,
// mapped back onto the original; fail-closed when layer 2 is skipped or fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverSpans, logAiFailure, redact, redactLayer1, redactWithItems } from "@/lib/intake/redact";
import type { PiiItem } from "@/lib/ai";

const SCENARIO =
  "Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken " +
  "for three weeks, so I can't get in with my wheelchair. Call me at four one six five five five zero one four two.";
const NAME = "Daniel Okafor";
const DICTATED = "four one six five five five zero one four two";
const REDACTED =
  "Hi, my name is [PERSON]. The automatic door button at the King Street branch has been broken " +
  "for three weeks, so I can't get in with my wheelchair. Call me at [PHONE].";

const saved = { ...process.env };
beforeEach(() => {
  process.env.FAKE_LLM = "1";
  process.env.AI_BACKEND = "fake";
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

/**
 * Every AI call throws from here on: api has no ANTHROPIC_API_KEY, claude-cli gets no local caller, and an unknown
 * backend is a config error. Errors are captured. (Never a real model: no key, and lib/ai refuses under vitest.)
 */
function aiDown(backend = "api") {
  process.env.FAKE_LLM = "0";
  process.env.AI_BACKEND = backend;
  delete process.env.ANTHROPIC_API_KEY;
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("the demo scenario", () => {
  it("redacts the name to [PERSON] and the dictated digits to [PHONE], and nothing else", async () => {
    const r = await redact(SCENARIO, { aiOptOut: false });
    expect(r.redactedText).toBe(REDACTED);
    expect(r.needsManualRedaction).toBe(false);
    expect(r.piiItems).toEqual([{ text: NAME, type: "PERSON", reason: "reporter's name" }]);
  });

  it("spans index into the ORIGINAL text: each one covers exactly the value it hides", async () => {
    const r = await redact(SCENARIO, { aiOptOut: false });
    expect(r.spans).toEqual([
      { start: SCENARIO.indexOf(NAME), end: SCENARIO.indexOf(NAME) + NAME.length, type: "PERSON", source: "llm" },
      { start: SCENARIO.indexOf(DICTATED), end: SCENARIO.indexOf(DICTATED) + DICTATED.length, type: "PHONE", source: "pattern" },
    ]);
    expect(r.spans.map((s) => SCENARIO.slice(s.start, s.end))).toEqual([NAME, DICTATED]);
  });

  it("keeps the place, which is what staff need to fix it", async () => {
    const r = await redact(SCENARIO, { aiOptOut: false });
    expect(r.redactedText).toContain("King Street branch");
    expect(r.redactedText).toContain("automatic door button");
    const detail = await redact("King Street branch, main entrance", { aiOptOut: false });
    expect(detail.redactedText).toBe("King Street branch, main entrance");
    expect(detail.spans).toEqual([]);
  });

  it("layer 1 alone catches the dictated number but not the name", () => {
    const masked = redactLayer1(SCENARIO);
    expect(masked).toContain("[PHONE]");
    expect(masked).toContain(NAME);
    expect(masked).not.toContain("four one six");
  });
});

describe("mapping layer-2 values onto the original text", () => {
  it("offsets stay right when a layer-1 token before the name changed the masked text's length", async () => {
    const raw = "Email me at dana.k@example.com or ask for Daniel Okafor at 416-555-0142. Daniel Okafor again.";
    const r = await redact(raw, { aiOptOut: false });
    expect(r.redactedText).toBe("Email me at [EMAIL] or ask for [PERSON] at [PHONE]. [PERSON] again.");
    for (const s of r.spans) expect(s.end).toBeLessThanOrEqual(raw.length);
    expect(r.spans.filter((s) => s.type === "PERSON").map((s) => raw.slice(s.start, s.end))).toEqual([NAME, NAME]);
    expect(r.spans.find((s) => s.type === "EMAIL")).toMatchObject({ source: "pattern" });
  });

  it("several names from the fakes are all removed (reporter and named staff)", async () => {
    const r = await redact("Priya Raman told Daniel Okafor the ramp was closed.", { aiOptOut: false });
    expect(r.redactedText).toBe("[STAFF_NAME] told [PERSON] the ramp was closed.");
  });

  it("ignores layer-2 values that are too short or that contain a [TOKEN]", () => {
    const items: PiiItem[] = [
      { text: "D", type: "PERSON", reason: "too short" },
      { text: "[PHONE]", type: "OTHER_ID", reason: "already masked" },
      { text: "  Daniel Okafor  ", type: "PERSON", reason: "padded" },
    ];
    const r = redactWithItems(SCENARIO, items);
    expect(r.redactedText).toBe(REDACTED);
  });

  it("a layer-2 value that overlaps a layer-1 span becomes one span covering BOTH (no part left visible)", () => {
    const raw = "Call 416-555-0142 now.";
    const r = redactWithItems(raw, [{ text: "Call 416", type: "OTHER_ID", reason: "overlap" }]);
    expect(r.spans).toEqual([{ start: 0, end: raw.indexOf(" now"), type: "PHONE", source: "pattern" }]);
    expect(r.redactedText).toBe("[PHONE] now.");

    const after = "Reach me: 416-555-0142 ext 9 Daniel";
    const r2 = redactWithItems(after, [{ text: "0142 ext 9 Daniel", type: "QUASI_ID", reason: "overlap at the end" }]);
    expect(r2.redactedText).toBe("Reach me: [QUASI_ID]");
  });

  it("coverSpans: unions overlaps, keeps neighbours apart, never loses a character", () => {
    expect(coverSpans([])).toEqual([]);
    expect(coverSpans([
      { start: 10, end: 20, type: "PHONE", source: "pattern" },
      { start: 0, end: 4, type: "PERSON", source: "llm" },
      { start: 4, end: 8, type: "PERSON", source: "llm" }, // touching, not overlapping
      { start: 15, end: 30, type: "QUASI_ID", source: "llm" }, // longer, overlapping
      { start: 29, end: 31, type: "DOB", source: "llm" }, // overlaps the union
    ])).toEqual([
      { start: 0, end: 4, type: "PERSON", source: "llm" },
      { start: 4, end: 8, type: "PERSON", source: "llm" },
      { start: 10, end: 31, type: "QUASI_ID", source: "llm" },
    ]);
  });

  it("is deterministic for the same text and layer-2 values", () => {
    const items: PiiItem[] = [{ text: NAME, type: "PERSON", reason: "name" }];
    expect(redactWithItems(SCENARIO, items)).toEqual(redactWithItems(SCENARIO, items));
    expect(redactWithItems(SCENARIO, items).redactedText).toBe(REDACTED);
  });

  it("text with nothing to hide comes back unchanged with no spans", async () => {
    const r = await redact("The ramp at the back entrance is too steep.", { aiOptOut: false });
    expect(r).toMatchObject({ redactedText: "The ramp at the back entrance is too steep.", spans: [], needsManualRedaction: false });
  });
});

describe("aiOptOut: layer 2 is skipped", () => {
  it("makes no AI call at all, keeps layer 1, and flags the case for a person to check names", async () => {
    const errors = aiDown(); // any AI call would now throw and be logged
    const r = await redact(SCENARIO, { aiOptOut: true });
    expect(r.redactedText).toBe(SCENARIO.replace(DICTATED, "[PHONE]"));
    expect(r.redactedText).toContain(NAME); // no model looked for names; the lead does (layer 3)
    expect(r.piiItems).toBeNull();
    expect(r.needsManualRedaction).toBe(true);
    expect(r.spans.every((s) => s.source === "pattern")).toBe(true);
    expect(errors).not.toHaveBeenCalled();
  });

  it("skips layer 2 even when the fake backend would have found the name", async () => {
    const r = await redact(SCENARIO, { aiOptOut: true });
    expect(r.redactedText).toContain(NAME);
    expect(r.needsManualRedaction).toBe(true);
  });
});

describe("fail-closed: flagPii fails", () => {
  for (const [why, backend] of [["no API key", "api"], ["not a local caller", "claude-cli"], ["bad configuration", "nonsense"]] as const) {
    it(`${why} (${backend}): layer 1 stays, needsManualRedaction is set, the case still goes through`, async () => {
      const errors = aiDown(backend);
      const r = await redact(SCENARIO, { aiOptOut: false });
      expect(r.redactedText).toBe(SCENARIO.replace(DICTATED, "[PHONE]"));
      expect(r.piiItems).toBeNull();
      expect(r.needsManualRedaction).toBe(true);
      expect(errors).toHaveBeenCalledTimes(1);
    });
  }

  it("the failure log never contains the report text, the name or the number", async () => {
    const errors = aiDown();
    await redact(SCENARIO, { aiOptOut: false });
    const logged = errors.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("flagPii failed (AiBackendUnavailableError)");
    expect(logged).not.toContain("Daniel");
    expect(logged).not.toContain("four one six");
    expect(logged).not.toContain("door button");
  });

  it("logAiFailure prints only the error class for errors that are not ours", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    logAiFailure("flagPii", new TypeError("could not parse: Hi, my name is Daniel Okafor"));
    logAiFailure("structure", "a string thrown with Daniel Okafor in it");
    const logged = errors.mock.calls.flat().map(String);
    expect(logged).toEqual(["[intake] flagPii failed (TypeError)", "[intake] structure failed (UnknownError)"]);
  });
});
