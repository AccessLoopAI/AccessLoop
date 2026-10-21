// lib/ai with the fake backend (docs/domain.md §6, §6.1; CLAUDE.md "AI contract"): the matching rules in each
// fakes file's `_doc`, zod validation, backend precedence, and no silent fallback to the fake.
// (This file absorbed the earlier tests/ai.fake.test.ts; every assertion from it is kept below.)
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AiBackendUnavailableError,
  AiConfigError,
  AiNotAllowedError,
  FlagPiiOutputSchema,
  PhraseClaimsOutputSchema,
  PRIORITY_AREAS,
  StructureOutputSchema,
  SUMMARY_MAX,
  effectiveBackend,
  flagPii,
  phraseClaims,
  structure,
} from "@/lib/ai";
import { fakeFlagPii, fakeStructure } from "@/lib/ai/backends/fake";
import flagPiiFakes from "@/lib/ai/fakes/flag-pii.json";
import structureFakes from "@/lib/ai/fakes/structure.json";
import { PRIORITY_AREAS as REPORT_AREAS } from "@/lib/report/headings";
import { redactLayer1 } from "@/lib/intake/redact";
import { priorityArea } from "@/db/schema";

const SCENARIO =
  "Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken " +
  "for three weeks, so I can't get in with my wheelchair. Call me at four one six five five five zero one four two.";

const saved = { ...process.env };
beforeEach(() => {
  process.env.FAKE_LLM = "1";
  process.env.AI_BACKEND = "fake";
});
afterEach(() => {
  process.env = { ...saved };
});

describe("effective AI backend (domain §6.1)", () => {
  it("FAKE_LLM=1 forces fake whatever AI_BACKEND says", () => {
    expect(effectiveBackend({ FAKE_LLM: "1", AI_BACKEND: "api" })).toBe("fake");
    expect(effectiveBackend({ FAKE_LLM: "1", AI_BACKEND: "claude-cli" })).toBe("fake");
    expect(effectiveBackend({ FAKE_LLM: "1", AI_BACKEND: "openai" })).toBe("fake"); // even a bad value
    expect(effectiveBackend({ FAKE_LLM: " 1\r", AI_BACKEND: "api" })).toBe("fake"); // a stray space never means real AI
  });

  it("defaults to fake, otherwise follows AI_BACKEND", () => {
    expect(effectiveBackend({})).toBe("fake");
    expect(effectiveBackend({ FAKE_LLM: "0" })).toBe("fake");
    expect(effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "" })).toBe("fake");
    expect(effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "fake" })).toBe("fake");
    expect(effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "api" })).toBe("api");
    expect(effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "claude-cli" })).toBe("claude-cli");
    expect(effectiveBackend({ AI_BACKEND: "api" })).toBe("api"); // FAKE_LLM unset is not "1"
    expect(effectiveBackend({ FAKE_LLM: "true", AI_BACKEND: "api" })).toBe("api"); // only "1" forces the fake
  });

  it("trims AI_BACKEND but is otherwise exact", () => {
    expect(effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "  api \n" })).toBe("api");
    expect(() => effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "API" })).toThrow(AiConfigError);
  });

  it("rejects unknown values loudly instead of guessing", () => {
    expect(() => effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "openai" })).toThrow(AiConfigError);
    expect(() => effectiveBackend({ FAKE_LLM: "0", AI_BACKEND: "openai" })).toThrow(/not a known AI backend/);
  });

  it("reads process.env by default, per call", () => {
    process.env.FAKE_LLM = "0";
    process.env.AI_BACKEND = "api";
    expect(effectiveBackend()).toBe("api");
    process.env.FAKE_LLM = "1";
    expect(effectiveBackend()).toBe("fake");
  });
});

describe("fake structure() (structure.json _doc)", () => {
  it("answers the demo scenario from its masked text, zod-validated, with fake metadata", async () => {
    const r = await structure(redactLayer1(SCENARIO), "place");
    expect(StructureOutputSchema.parse(r.value)).toEqual(r.value);
    expect(r.value.summary).toContain("door button");
    expect(r.value.summary).not.toContain("Daniel");
    expect(r.value.priorityAreas[0].area).toBe("built_environment");
    expect(r.meta.backend).toBe("fake");
    expect(r.meta.model).toBe("fake");
    expect(r.meta.promptSha).toMatch(/^[0-9a-f]{64}$/);
    expect(r.meta.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("matches case-insensitively, first entry wins, else the fallback", async () => {
    expect((await structure("The DOOR BUTTON and the relay line", "other")).value.priorityAreas[0].area).toBe("built_environment");
    expect((await structure("Agents hung up on my RELAY call", "phone_or_service")).value.priorityAreas[0].area).toBe("communication_other");
    const fallback = await structure("Something else entirely.", "other");
    expect(fallback.value.uncertain).toEqual(["priorityArea"]);
  });

  it("first entry in FILE order wins, not first match in the text", async () => {
    // "relay" appears before "date picker" in the text, but the date picker entry comes first in the file.
    const r = await structure("A relay call about the date picker", "digital");
    expect(r.value.priorityAreas[0].area).toBe("ict");
  });

  it("every entry answers its own match, and the answer passes the schema", () => {
    for (const e of structureFakes.entries) {
      const r = fakeStructure(`Before ${e.match.toUpperCase()} after`);
      expect(r.value).toEqual(StructureOutputSchema.parse(e.output));
    }
    expect(fakeStructure("").value).toEqual(StructureOutputSchema.parse(structureFakes.fallback));
  });

  it("the same input always gives the same answer and promptSha", async () => {
    const a = await structure("door button", "place");
    const b = await structure("door button", "place");
    expect(a.value).toEqual(b.value);
    expect(a.meta.promptSha).toBe(b.meta.promptSha);
  });
});

describe("fake flagPii() (flag-pii.json _doc)", () => {
  it("every case-sensitive match contributes its items", async () => {
    const r = await flagPii("Daniel Okafor said Priya Raman was rude.");
    expect(r.value.items.map((i) => [i.text, i.type])).toEqual([
      ["Daniel Okafor", "PERSON"],
      ["Priya Raman", "STAFF_NAME"],
    ]);
    expect((await flagPii("daniel okafor")).value.items).toEqual([]);
    expect(r.meta.backend).toBe("fake");
  });

  it("finds the name in the masked demo scenario and nothing else", async () => {
    const r = await flagPii(redactLayer1(SCENARIO));
    expect(r.value.items).toEqual([{ text: "Daniel Okafor", type: "PERSON", reason: "reporter's name" }]);
    expect(FlagPiiOutputSchema.parse(r.value)).toEqual(r.value);
  });

  it("every item is an exact substring of its entry's match (no offsets, no rewritten text)", () => {
    for (const e of flagPiiFakes.entries) {
      for (const item of e.items) expect(e.match).toContain(item.text);
      expect(fakeFlagPii(e.match).value.items).toEqual(e.items);
    }
  });

  it("text with no known name gives no items", async () => {
    expect((await flagPii("The ramp is too steep.")).value.items).toEqual([]);
    expect((await flagPii("")).value.items).toEqual([]);
  });

  it("has its own promptSha, different from structure's", async () => {
    const a = await flagPii("x");
    const b = await structure("x", "other");
    expect(a.meta.promptSha).toMatch(/^[0-9a-f]{64}$/);
    expect(a.meta.promptSha).not.toBe(b.meta.promptSha);
  });
});

describe("fake phraseClaims()", () => {
  it("fills every slot and keeps one sentence per claim", async () => {
    const r = await phraseClaims([
      { claimId: "c1", heading: "Feedback", template: "We received {total} pieces of feedback.", slots: { total: 17 }, factIds: ["F_TOTAL"] },
    ]);
    expect(r.value).toEqual([{ claimId: "c1", text: "We received 17 pieces of feedback." }]);
  });

  it("keeps unknown slots visible (so the validator rejects them) and keeps claim order", async () => {
    const r = await phraseClaims([
      { claimId: "a", heading: "Feedback", template: "{verified} of {total} were confirmed.", slots: { verified: 3, total: 9 }, factIds: ["F_OUTCOME"] },
      { claimId: "b", heading: "Feedback", template: "Missing {nope}.", slots: {}, factIds: ["F_TOTAL"] },
    ]);
    expect(r.value).toEqual([
      { claimId: "a", text: "3 of 9 were confirmed." },
      { claimId: "b", text: "Missing {nope}." },
    ]);
    expect(PhraseClaimsOutputSchema.parse(r.value)).toEqual(r.value);
  });
});

describe("zod output schemas", () => {
  const good = { summary: "A short summary.", priorityAreas: [{ area: "ict", confidence: 0.9 }], uncertain: [] };

  it("structure: accepts a good answer", () => {
    expect(StructureOutputSchema.safeParse(good).success).toBe(true);
  });

  it("structure: rejects empty or over-long summaries, bad areas and bad confidences", () => {
    const bad = [
      { ...good, summary: "" },
      { ...good, summary: "x".repeat(SUMMARY_MAX + 1) },
      { ...good, priorityAreas: [] },
      { ...good, priorityAreas: Array(4).fill({ area: "ict", confidence: 0.5 }) },
      { ...good, priorityAreas: [{ area: "barrier classification", confidence: 0.5 }] },
      { ...good, priorityAreas: [{ area: "ict", confidence: 1.2 }] },
      { ...good, priorityAreas: [{ area: "ict", confidence: -0.1 }] },
      { ...good, uncertain: "priorityArea" },
      { summary: "x", priorityAreas: [{ area: "ict", confidence: 0.5 }] }, // missing uncertain
    ];
    for (const b of bad) expect(StructureOutputSchema.safeParse(b).success, JSON.stringify(b).slice(0, 80)).toBe(false);
  });

  it("flagPii: only the known types, and never an empty value", () => {
    expect(FlagPiiOutputSchema.safeParse({ items: [{ text: "Daniel", type: "PERSON", reason: "name" }] }).success).toBe(true);
    expect(FlagPiiOutputSchema.safeParse({ items: [] }).success).toBe(true);
    expect(FlagPiiOutputSchema.safeParse({ items: [{ text: "", type: "PERSON", reason: "name" }] }).success).toBe(false);
    expect(FlagPiiOutputSchema.safeParse({ items: [{ text: "x@y.z", type: "EMAIL", reason: "layer 1 type" }] }).success).toBe(false);
    expect(FlagPiiOutputSchema.safeParse({ items: [{ text: "Daniel", type: "PERSON" }] }).success).toBe(false);
    expect(FlagPiiOutputSchema.safeParse([{ text: "Daniel", type: "PERSON", reason: "name" }]).success).toBe(false);
  });

  it("phraseClaims: every sentence needs a claim id and text", () => {
    expect(PhraseClaimsOutputSchema.safeParse([{ claimId: "c", text: "t" }]).success).toBe(true);
    expect(PhraseClaimsOutputSchema.safeParse([{ claimId: "", text: "t" }]).success).toBe(false);
    expect(PhraseClaimsOutputSchema.safeParse([{ claimId: "c", text: "" }]).success).toBe(false);
  });

  it("the AI's priority areas are exactly the DB enum and the report headings", () => {
    expect([...PRIORITY_AREAS]).toEqual(priorityArea.enumValues);
    expect([...PRIORITY_AREAS]).toEqual([...REPORT_AREAS]);
  });
});

describe("real backends that can't run here (Phase 3: built, but no key and no local caller in these tests)", () => {
  // tests/ai-api.test.ts and tests/ai-cli.test.ts cover the backends themselves with a stubbed client and spawn.
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("throw a typed error and never fall back to the fake", async () => {
    process.env.FAKE_LLM = "0";
    process.env.AI_BACKEND = "api"; // no ANTHROPIC_API_KEY
    await expect(structure("door button", "place")).rejects.toBeInstanceOf(AiBackendUnavailableError);
    process.env.AI_BACKEND = "claude-cli"; // no AiContext: refused before anything starts
    await expect(flagPii("Daniel Okafor")).rejects.toBeInstanceOf(AiNotAllowedError);
  });

  it("all three functions refuse, and the error names the backend", async () => {
    process.env.FAKE_LLM = "0";
    const expected = { api: AiBackendUnavailableError, "claude-cli": AiNotAllowedError } as const;
    for (const backend of ["api", "claude-cli"] as const) {
      process.env.AI_BACKEND = backend;
      const claims = [{ claimId: "c", heading: "Feedback", template: "x", slots: {}, factIds: ["F_TOTAL"] }];
      for (const call of [() => structure("door button", "place"), () => flagPii("Daniel Okafor"), () => phraseClaims(claims)]) {
        const err = await call().then(() => null, (e: unknown) => e);
        expect(err).toBeInstanceOf(expected[backend]);
        expect((err as AiBackendUnavailableError | AiNotAllowedError).backend).toBe(backend);
      }
    }
  });

  it("an unknown AI_BACKEND makes every call fail with a config error", async () => {
    process.env.FAKE_LLM = "0";
    process.env.AI_BACKEND = "gpt";
    await expect(structure("door button", "place")).rejects.toBeInstanceOf(AiConfigError);
    await expect(flagPii("Daniel Okafor")).rejects.toBeInstanceOf(AiConfigError);
  });

  it("FAKE_LLM=1 still wins over a real backend in AI_BACKEND, through the real functions", async () => {
    process.env.FAKE_LLM = "1";
    process.env.AI_BACKEND = "api";
    const r = await structure("door button", "place");
    expect(r.meta.backend).toBe("fake");
    expect(r.value.priorityAreas[0].area).toBe("built_environment");
  });
});
