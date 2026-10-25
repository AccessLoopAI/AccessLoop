// lib/cases/redaction-review.ts: the lead's redaction review (docs/domain.md §5 layer 3). The review region must
// never show a hidden value, and the final spans are re-derived from the stored proposal (by index) plus the exact
// words the lead typed, never from offsets a browser could send.
import { describe, expect, it } from "vitest";
import { redactWithItems } from "@/lib/intake/redact";
import { applyRedaction, type Span } from "@/lib/redaction/patterns";
import {
  buildReview,
  containsHiddenValue,
  finalizeApproval,
  parseSpans,
  redactValues,
  wordsFound,
} from "@/lib/cases/redaction-review";

const RAW =
  "Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken " +
  "for three weeks, so I can't get in with my wheelchair. Call me at four one six five five five zero one four two.";
const NAME = "Daniel Okafor";
const NONE = { summary: null, aiSummary: null, locationDetail: null };

/** What intake stored: layer 1 + the fake flagPii's name (lib/ai/fakes/flag-pii.json). */
const intake = redactWithItems(RAW, [{ text: NAME, type: "PERSON", reason: "reporter's name" }]);
const PROPOSED: Span[] = intake.spans;

/** Every text a review item shows, joined. */
function shownText(view: ReturnType<typeof buildReview>): string {
  return [view.text, view.summary ?? "", view.aiSummary ?? "", view.locationDetail ?? "",
    ...view.items.flatMap((i) => [i.before, i.token, i.after])].join("\n");
}

describe("parseSpans", () => {
  it("keeps well-formed spans inside the text, in their stored order", () => {
    const stored = PROPOSED.map(({ start, end, type, source }) => ({ start, end, type, source }));
    expect(parseSpans(stored, RAW.length)).toEqual(PROPOSED);
  });

  it("drops anything that is not a span inside the text", () => {
    const spans = parseSpans(
      [
        { start: 0, end: 2, type: "PERSON", source: "llm" },
        { start: 5, end: RAW.length + 1, type: "PERSON", source: "llm" }, // past the end
        { start: -1, end: 2, type: "PERSON", source: "llm" },
        { start: 4, end: 4, type: "PERSON", source: "llm" }, // empty
        { start: 0, end: 2, type: "NAME", source: "llm" }, // unknown type
        { start: 0, end: 2, type: "PERSON", source: "guess" },
        "nonsense",
        null,
      ],
      RAW.length,
    );
    expect(spans).toEqual([{ start: 0, end: 2, type: "PERSON", source: "llm" }]);
    expect(parseSpans(undefined, 10)).toEqual([]);
    expect(parseSpans({ spans: [] }, 10)).toEqual([]);
  });
});

describe("buildReview", () => {
  it("shows the stored redaction, one item per proposed span, and never a hidden value", () => {
    const view = buildReview(RAW, PROPOSED, [], NONE);
    expect(view.text).toBe(intake.redactedText);
    expect(view.text).toContain("[PERSON]");
    expect(view.text).toContain("[PHONE]");
    expect(view.items.map((i) => [i.key, i.type, i.source])).toEqual([
      ["p:0", "PERSON", "llm"],
      ["p:1", "PHONE", "pattern"],
    ]);
    expect(view.items[0].before).toBe("Hi, my name is ");
    expect(view.items[0].after.startsWith(". The automatic door")).toBe(true);
    expect(view.items[1].before.endsWith("Call me at ")).toBe(true);
    const shown = shownText(view);
    expect(shown).not.toContain("Daniel");
    expect(shown).not.toContain("Okafor");
    expect(shown).not.toContain("four one six");
  });

  it("cuts long context at a space, so no token is ever split", () => {
    const view = buildReview(RAW, PROPOSED, [], NONE);
    for (const item of view.items) {
      expect(item.before.length).toBeLessThanOrEqual(50);
      expect(item.after.length).toBeLessThanOrEqual(50);
      expect(item.before).not.toMatch(/^…?[A-Z_]+\]/);
      expect(item.after).not.toMatch(/\[[A-Z_]*…$/);
    }
    expect(view.items[1].before.startsWith("…")).toBe(true);
  });

  it("hides added words everywhere they appear, and lists them as added by the lead", () => {
    const view = buildReview(RAW, PROPOSED, [{ text: "King Street", type: "STREET_ADDRESS" }], NONE);
    expect(view.text).toContain("at the [STREET_ADDRESS] branch");
    expect(view.items).toHaveLength(3);
    expect(view.items[2]).toMatchObject({ key: "a:0", kind: "added", type: "STREET_ADDRESS", source: "human", places: 1, inReport: true });
    expect(view.items[2].before.endsWith("button at the ")).toBe(true);
    expect(shownText(view)).not.toContain("King Street");
  });

  it("counts every place, and words found only in the summary", () => {
    const raw = "The ramp at Elm Park is steep. Elm Park staff said no.";
    const view = buildReview(raw, [], [{ text: "Elm Park", type: "QUASI_ID" }, { text: "Priya", type: "STAFF_NAME" }], {
      summary: "Priya at the desk said the ramp is steep.",
      aiSummary: null,
      locationDetail: "Elm Park, side door",
    });
    expect(view.text).toBe("The ramp at [QUASI_ID] is steep. [QUASI_ID] staff said no.");
    expect(view.items[0]).toMatchObject({ places: 3, inReport: true }); // 2 in the report, 1 in the detail
    expect(view.items[1]).toMatchObject({ places: 1, inReport: false, before: "", after: "" });
    expect(view.summary).toBe("[STAFF_NAME] at the desk said the ramp is steep.");
    expect(view.locationDetail).toBe("[QUASI_ID], side door");
  });

  it("merges words that overlap a proposed span into one token", () => {
    const view = buildReview(RAW, PROPOSED, [{ text: "Okafor", type: "PERSON" }], NONE);
    expect(view.text).toBe(intake.redactedText);
    expect(view.items[2]).toMatchObject({ key: "a:0", token: "[PERSON]", places: 1 });
  });

  it("hides the report's hidden values in the summaries too", () => {
    const view = buildReview(RAW, PROPOSED, [], {
      summary: "Daniel Okafor can't get in.",
      aiSummary: "You can't get in.",
      locationDetail: null,
    });
    expect(view.summary).toBe("[PERSON] can't get in.");
    expect(view.aiSummary).toBe("You can't get in.");
  });
});

describe("wordsFound", () => {
  it("looks in the report and in the other texts, exactly (after trimming)", () => {
    expect(wordsFound(RAW, { text: "  King Street ", type: "STREET_ADDRESS" }, NONE)).toBe(true);
    expect(wordsFound(RAW, { text: "king street", type: "STREET_ADDRESS" }, NONE)).toBe(false);
    expect(wordsFound(RAW, { text: "Queen Street", type: "STREET_ADDRESS" }, NONE)).toBe(false);
    expect(wordsFound(RAW, { text: "Priya", type: "STAFF_NAME" }, { ...NONE, summary: "Ask Priya." })).toBe(true);
    expect(wordsFound(RAW, { text: "a", type: "PERSON" }, NONE)).toBe(false); // too short to match safely
  });
});

describe("finalizeApproval", () => {
  it("keeps the ticked proposed spans, adds the lead's words, and counts both", () => {
    const a = finalizeApproval(RAW, PROPOSED, [0], [{ text: "King Street", type: "STREET_ADDRESS" }], NONE);
    if ("problem" in a) throw new Error(a.problem);
    expect(a.counts).toEqual({ kept: 1, removed: 1, added: 1 });
    expect(a.spans.map((s) => [s.type, s.source])).toEqual([
      ["PERSON", "llm"],
      ["STREET_ADDRESS", "human"],
    ]);
    expect(a.redactedText).toBe(applyRedaction(RAW, a.spans));
    expect(a.redactedText).toContain("my name is [PERSON].");
    expect(a.redactedText).toContain("at the [STREET_ADDRESS] branch");
    expect(a.redactedText).toContain("four one six five"); // the lead removed the phone span
  });

  it("gives back exactly the stored text when everything is kept and nothing is added", () => {
    const a = finalizeApproval(RAW, PROPOSED, [0, 1], [], NONE);
    if ("problem" in a) throw new Error(a.problem);
    expect(a.redactedText).toBe(intake.redactedText);
    expect(a.counts).toEqual({ kept: 2, removed: 0, added: 0 });
  });

  it("redacts the same values out of the summary, the AI summary and the place detail", () => {
    const a = finalizeApproval(RAW, PROPOSED, [0, 1], [{ text: "King Street", type: "STREET_ADDRESS" }], {
      summary: "Daniel Okafor says the King Street door is broken.",
      aiSummary: "The door at King Street is broken.",
      locationDetail: "King Street branch, main entrance",
    });
    if ("problem" in a) throw new Error(a.problem);
    expect(a.summary).toBe("[PERSON] says the [STREET_ADDRESS] door is broken.");
    expect(a.aiSummary).toBe("The door at [STREET_ADDRESS] is broken.");
    expect(a.locationDetail).toBe("[STREET_ADDRESS] branch, main entrance");
  });

  it("refuses indices that are not in the stored proposal", () => {
    for (const keep of [[2], [-1], [0.5], [Number.NaN]]) {
      expect(finalizeApproval(RAW, PROPOSED, keep, [], NONE)).toEqual({ problem: "bad_index" });
    }
  });

  it("refuses words that are no longer anywhere", () => {
    expect(finalizeApproval(RAW, PROPOSED, [0], [{ text: "King Street", type: "STREET_ADDRESS" }, { text: "Nowhere Lane", type: "STREET_ADDRESS" }], NONE))
      .toEqual({ problem: "words_not_found", index: 1 });
    expect(finalizeApproval(RAW, PROPOSED, [0], [{ text: "[PERSON]", type: "PERSON" }], NONE)).toEqual({ problem: "words_not_found", index: 0 });
  });

  it("a value hidden twice in the report is hidden in both places", () => {
    const raw = "Sam Example called. Sam Example says the ramp is steep.";
    const a = finalizeApproval(raw, [], [], [{ text: "Sam Example", type: "PERSON" }], NONE);
    if ("problem" in a) throw new Error(a.problem);
    expect(a.redactedText).toBe("[PERSON] called. [PERSON] says the ramp is steep.");
    expect(a.counts.added).toBe(1);
  });
});

describe("redactValues and containsHiddenValue", () => {
  it("hide every occurrence of the values; unrelated text is unchanged", () => {
    expect(redactValues("Ask Priya, then Priya again.", [{ text: "Priya", type: "STAFF_NAME" }])).toBe("Ask [STAFF_NAME], then [STAFF_NAME] again.");
    expect(redactValues("Nothing here.", [{ text: "Priya", type: "STAFF_NAME" }])).toBe("Nothing here.");
  });

  it("tell whether a public summary would bring back a hidden detail", () => {
    expect(containsHiddenValue("Daniel Okafor could not get in.", RAW, PROPOSED)).toBe(true);
    expect(containsHiddenValue("A door button at a branch entrance was broken.", RAW, PROPOSED)).toBe(false);
  });

  it("also finds a hidden value retyped in another letter case or spacing, as whole words", () => {
    expect(containsHiddenValue("daniel okafor could not get in.", RAW, PROPOSED)).toBe(true);
    expect(containsHiddenValue("DANIEL\n  OKAFOR called again.", RAW, PROPOSED)).toBe(true);
    expect(containsHiddenValue("Okafor's door: daniel okafor's report.", RAW, PROPOSED)).toBe(true);
    // A short hidden name never refuses ordinary words that merely contain it.
    const raw = "Ed said the ramp is too steep.";
    const ed: Span[] = [{ start: 0, end: 2, type: "PERSON", source: "llm" }];
    expect(containsHiddenValue("We fixed the ramp and edited the sign.", raw, ed)).toBe(false);
    expect(containsHiddenValue("Asked ED about the ramp.", raw, ed)).toBe(true);
    expect(containsHiddenValue("Anything at all.", raw, [])).toBe(false);
  });
});
