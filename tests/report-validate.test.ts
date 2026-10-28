// The sentence validator's Phase 7 rules (lib/report/validate.ts; docs/archive/phase7-prompt.md T1 item 6), checked BEFORE
// real AI rewords anything: numbers in the template's order, at most 1.3 times the template's words, and no banned
// word the template does not have. The first three cases are the sentences the review saw accepted (validate.ts
// before Phase 7): an added "fully compliant", "every barrier ... removed", and two numbers swapped.
import { describe, expect, it } from "vitest";
import type { Claim, PhraseClaimsOutput } from "@/lib/ai/schemas";
import { CLAIM, compileClaims, fillTemplate } from "@/lib/report/claims";
import type { Fact } from "@/lib/report/types";
import {
  BANNED_WORDS,
  bannedWordsIn,
  chooseSentences,
  maxWords,
  validateSentence,
  wordCount,
  type ValidationContext,
} from "@/lib/report/validate";

const FACTS: Fact[] = [
  { id: "F_TOTAL", kind: "F_TOTAL", values: { total: 14, web: 9, email: 5 }, caseIds: ["c1", "c2"] },
  { id: "F_OUTCOME", kind: "F_OUTCOME", values: { verified: 7, unverified: 4, open: 2, closed: 1, verifiedViaStaffCode: 0 }, caseIds: ["c1", "c2"] },
  { id: "F_AREA:ict", kind: "F_AREA", values: { count: 6 }, caseIds: ["c1"] },
  { id: "F_CASE:BAR-0001", kind: "F_CASE", values: { publicSummary: "The elevator was out of service almost every week.", outcome: "verified", viaStaffCode: "no" }, caseIds: ["c1"] },
];
const ONE_CHANNEL: Fact = { id: "F_TOTAL", kind: "F_TOTAL", values: { total: 14, web: 14 }, caseIds: ["c1", "c2"] };

const ctxOf = (facts: Fact[]): ValidationContext => ({
  facts: new Map(facts.map((f) => [f.id, f])),
  refsById: new Map([["c1", "BAR-0001"], ["c2", "BAR-0002"]]),
  allowedYears: [2026],
});
const CTX = ctxOf(FACTS);
const CLAIMS = compileClaims({ facts: FACTS }, { planAreas: ["ict"] });
const claim = (id: string, claims: Claim[] = CLAIMS) => claims.find((c) => c.claimId === id)!;

const reasons = (text: string, c: Claim, ctx: ValidationContext = CTX) => {
  const r = validateSentence({ text, factIds: c.factIds }, ctx, c);
  return r.ok ? [] : r.reasons.map((x) => (x.detail ? `${x.code}:${x.detail}` : x.code));
};
const codes = (text: string, c: Claim, ctx?: ValidationContext) => [...new Set(reasons(text, c, ctx).map((r) => r.split(":")[0]))];

describe("the templates these tests reword", () => {
  it("are what claims.ts writes", () => {
    expect(fillTemplate(claim(CLAIM.total))).toBe(
      "In this reporting period, we received 14 pieces of feedback about accessibility: 9 through our online form and 5 by email.",
    );
    expect(fillTemplate(claim(CLAIM.outcome))).toBe(
      "Of these, 7 were fixed and confirmed by the person who reported them, 4 were fixed but not yet confirmed, 2 are still in progress, and 1 was closed without a change.",
    );
    expect(fillTemplate(claim(CLAIM.area("ict")))).toBe("Feedback received in this area: 6.");
    // Every template fill passes every rule, new ones included.
    for (const c of CLAIMS) expect(reasons(fillTemplate(c), c), c.claimId).toEqual([]);
  });
});

describe("the three sentences the review saw accepted are refused", () => {
  it('"... As a result, we are fully compliant with the Accessible Canada Act."', () => {
    const total = claim(CLAIM.total);
    const text = `${fillTemplate(total)} As a result, we are fully compliant with the Accessible Canada Act.`;
    expect(reasons(text, total)).toEqual(["banned_word:fully", "banned_word:compliant", "too_long:28"]);
    const [s] = chooseSentences([total], [{ claimId: total.claimId, text }], CTX);
    expect(s).toMatchObject({ fallback: true, text: fillTemplate(total), rejected: ["banned_word", "too_long"] });
  });

  it('"Every barrier reported this year has been removed."', () => {
    const outcome = claim(CLAIM.outcome);
    expect(codes("Every barrier reported this year has been removed.", outcome)).toEqual(["dropped_slot", "banned_word"]);
    // Even with every number kept, the sweeping word alone is enough.
    const kept = `${fillTemplate(outcome).slice(0, -1)}, so every barrier has been removed.`;
    expect(reasons(kept, outcome)).toEqual(["banned_word:every"]);
    expect(chooseSentences([outcome], [{ claimId: outcome.claimId, text: kept }], CTX)[0]).toMatchObject({ fallback: true, rejected: ["banned_word"] });
  });

  it("a sentence with two numbers swapped", () => {
    const outcome = claim(CLAIM.outcome);
    const swapped =
      "Of these, 4 were fixed and confirmed by the person who reported them, 7 were fixed but not yet confirmed, 2 are still in progress, and 1 was closed without a change.";
    expect(reasons(swapped, outcome)).toEqual(["number_order"]);
    const total = claim(CLAIM.total);
    expect(reasons("We received 14 pieces of feedback about accessibility: 5 through our online form and 9 by email.", total)).toEqual(["number_order"]);
    const [s] = chooseSentences([outcome], [{ claimId: outcome.claimId, text: swapped }], CTX);
    expect(s).toMatchObject({ fallback: true, text: fillTemplate(outcome), rejected: ["number_order"] });
  });
});

describe("numbers in the template's order", () => {
  const total = claim(CLAIM.total);
  it("accepts a plain rewording that keeps the order, and the period's year anywhere", () => {
    expect(reasons("We got 14 pieces of feedback about accessibility: 9 through our online form and 5 by email.", total)).toEqual([]);
    expect(reasons("In 2026, we got 14 pieces of feedback about accessibility: 9 through our online form and 5 by email.", total)).toEqual([]);
  });
  it("refuses a value said twice or out of place, even when every value is there", () => {
    expect(reasons("We got 14 pieces of feedback: 9 through our online form and 5 by email, 14 in total.", total)).toEqual(["number_order"]);
    expect(reasons("Through our online form 9, by email 5: 14 pieces of feedback about accessibility.", total)).toEqual(["number_order"]);
  });
  it("leaves a dropped value to dropped_slot (one reason, not two)", () => {
    expect(reasons("We got 14 pieces of feedback about accessibility, most through our online form.", total)).toEqual(["dropped_slot:web", "dropped_slot:email"]);
  });
});

describe("at most 1.3 times the template's words", () => {
  it("counts words the same way on both sides", () => {
    expect([maxWords(6), maxWords(10), maxWords(21), maxWords(70)]).toEqual([8, 13, 28, 91]);
    expect(wordCount("Feedback received in this area: 6.")).toBe(6);
    expect(wordCount("The account-opening form didn't work.")).toBe(6);
  });
  it("refuses an added claim, accepts a reword within the limit", () => {
    const area = claim(CLAIM.area("ict"));
    // 6 words: the limit is 8 (6 x 1.3 = 7.8, rounded up).
    expect(reasons("In this area, we received 6 pieces.", area)).toEqual([]);
    expect(reasons("We received 6 pieces of feedback in this area.", area)).toEqual(["too_long:8"]);
    expect(reasons("Feedback received in this area: 6. Our team fixed them quickly and the people were happy.", area)).toEqual(["too_long:8"]);
  });
  it("a quoted public summary counts on both sides", () => {
    const c = claim(CLAIM.case("BAR-0001"));
    expect(fillTemplate(c)).toBe("Fixed and confirmed by the person who reported it: The elevator was out of service almost every week.");
    expect(reasons("Fixed, and the person who reported it confirmed the fix: The elevator was out of service almost every week.", c)).toEqual([]);
  });
});

describe("banned words the template does not have", () => {
  it("covers the brief's list, in English and French", () => {
    for (const w of ["compliant", "compliance", "certified", "guarantee", "guaranteed", "fully", "every", "all", "satisfied", "resolved"]) {
      expect(BANNED_WORDS, w).toContain(w);
    }
    for (const w of ["conforme", "conformité", "certifié", "garanti", "garantie", "entièrement", "pleinement", "chaque", "tous", "toutes", "satisfait", "résolu"]) {
      expect(BANNED_WORDS, w).toContain(w);
    }
    expect([...bannedWordsIn("Fully COMPLIANT, 100% and 100 % and 100 per cent and cent pour cent; Toutes résolues.")]).toEqual([
      ["fully", 1], ["compliant", 1], ["100%", 4], ["toutes", 1], ["résolues", 1],
    ]);
    // Whole words only: "allow", "overall", "fullyear" and "100.5%" are not banned words.
    expect([...bannedWordsIn("We allow it overall; fullyear; 100.5% of 1100%.")]).toEqual([]);
  });

  it("refuses each one when the rewording adds it", () => {
    const total = claim(CLAIM.total);
    const base = "We got 14 pieces of feedback about accessibility: 9 through our online form and 5 by email";
    expect(reasons(`${base}, and all of it was resolved.`, total)).toEqual(["banned_word:all", "banned_word:resolved"]);
    expect(reasons(`${base}; we guarantee it.`, total)).toEqual(["banned_word:guarantee"]);
    expect(reasons(`${base}, 100% answered.`, total)).toEqual(["invented_number:100", "banned_word:100%"]);
    expect(reasons(`${base}, toutes résolues.`, total)).toEqual(["banned_word:toutes", "banned_word:résolues"]);
  });

  it("allows a word the template already has, as often as it has it", () => {
    const facts = [ONE_CHANNEL, ...FACTS.slice(1)];
    const total = claim(CLAIM.total, compileClaims({ facts }, { planAreas: ["ict"] }));
    expect(fillTemplate(total)).toBe("In this reporting period, we received 14 pieces of feedback about accessibility, all through our online form.");
    expect(reasons("This period, we received 14 pieces of feedback about accessibility, all through our online form.", total, ctxOf(facts))).toEqual([]);
    expect(reasons("This period, all 14 pieces of feedback about accessibility came all through our online form.", total, ctxOf(facts))).toEqual(["banned_word:all"]);
  });

  it("a quoted public summary's own words never license the same word elsewhere", () => {
    const c = claim(CLAIM.case("BAR-0001"));
    expect(reasons(fillTemplate(c), c)).toEqual([]); // "every week" is the lead-approved summary's text
    expect(reasons(`Every fix was confirmed: ${fillTemplate(c).split(": ")[1]}`, c)).toEqual(["banned_word:every"]);
  });

  it("without a claim to compare against, any banned word is refused", () => {
    const r = validateSentence({ text: "We are fully committed.", factIds: ["F_TOTAL"] }, CTX);
    expect(r).toEqual({ ok: false, reasons: [{ code: "banned_word", detail: "fully" }] });
  });
});

describe("chooseSentences keeps a good rewording and falls back for each refused one", () => {
  it("one call, three outcomes", () => {
    const picked = [claim(CLAIM.total), claim(CLAIM.outcome), claim(CLAIM.area("ict"))];
    const phrased: PhraseClaimsOutput = [
      { claimId: CLAIM.total, text: "We got 14 pieces of feedback about accessibility: 9 through our online form and 5 by email." },
      { claimId: CLAIM.outcome, text: "Of these, 7 were fixed and confirmed by the person who reported them, 4 were fixed but not yet confirmed, 2 are still in progress, and 1 was closed without a change, so we are fully compliant." },
      { claimId: CLAIM.area("ict"), text: "Feedback in this area: 6, every barrier fixed and checked." },
    ];
    expect(chooseSentences(picked, phrased, CTX).map((s) => [s.id, s.fallback, s.rejected ?? null])).toEqual([
      [CLAIM.total, false, null],
      [CLAIM.outcome, true, ["banned_word"]],
      [CLAIM.area("ict"), true, ["banned_word", "too_long"]],
    ]);
  });
});
