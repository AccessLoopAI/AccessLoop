// lib/report, pure (docs/domain.md §7, §8): facts as thin wrappers over lib/metrics, the snapshot and its fingerprint,
// claims and templates, the validator and its template fallback, the AI wording step's error rules, the draft
// structure with its checks, and the replay. Synthetic chains (tests/support/report-story.ts) cover what the seed does
// not: spam, the Toronto period edge, staff-relayed verifications, areas outside the plan, odd public summaries. The
// seed's exact values are in tests/report.seed.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import { zonedNoon } from "@/lib/dates";
import { acknowledgementCompliance, medianDaysToVerifiedFix, outcomes, totalReceived, type MetricCase } from "@/lib/metrics";
import { AiBackendUnavailableError, AiCallError, AiConfigError, AiNotAllowedError, AiOutputError, AiTimeoutError } from "@/lib/ai/errors";
import { fillClaimTemplate } from "@/lib/ai/claims";
import type { Claim, PhraseClaimsOutput } from "@/lib/ai/schemas";
import { CLAIM, compileClaims, fillTemplate } from "@/lib/report/claims";
import { buildContent, citedCaseIds, generalSentences, reportChecks, reportSettings, sentenceSources, toDraftSections } from "@/lib/report/compose";
import { compileFacts, factKindOf } from "@/lib/report/facts";
import { checkProgressReport, passes } from "@/lib/report/headings";
import { isCalendarYear, parsePeriod, periodYears, reportPeriodLabel } from "@/lib/report/period";
import { caseClaimRefs, claimsForAi, phraseOrTemplates } from "@/lib/report/phrase";
import { cutAtHead, replaySnapshot } from "@/lib/report/replay";
import { manifestHash, snapshotFromCases } from "@/lib/report/snapshot";
import type { Fact, ReportSnapshot } from "@/lib/report/types";
import { chooseSentences, exportBlockers, numberWordsIn, numbersIn, revalidateContent, validateSentence, validationContext } from "@/lib/report/validate";
import { Story, caseId, ref } from "./support/report-story";

const NOW = zonedNoon("2026-10-19");
const YEAR = { start: "2026-01-01", end: "2026-12-31" };

function stories(): Story[] {
  const s1 = new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "The app's sign-in button had no label.").assign(1).fixWithRetest(10).verdict(14, "fixed");
  const s2 = new Story(caseId(2), ref(2), "2026-03-01T15:00:00Z", { channel: "email", anonymous: false })
    .ack(1, "email").triage(0, "built_environment", "A ramp had no handrail").assign(1).fixNoRetest(5);
  const s3 = new Story(caseId(3), ref(3), "2026-04-01T15:00:00Z", { channel: "phone", anonymous: false, relayed: true })
    .ack(2, "phone").triage(0, "ict", "Phone menus timed out after 10 seconds.").assign(1).fixWithRetest(3).verdict(4, "partly").fixWithRetest(10, 2).verdict(12, "fixed", 2);
  const spam = new Story(caseId(4), ref(4), "2026-05-01T15:00:00Z").close(1, "spam");
  const edge = new Story(caseId(5), ref(5), "2026-01-01T04:30:00Z").triage(0, "transportation"); // Dec 31, 2025 in Toronto
  const s6 = new Story(caseId(6), ref(6), "2026-06-01T15:00:00Z").triage(0, "employment", "A job posting PDF could not be read.");
  return [s1, s2, s3, spam, edge, s6];
}
const casesOf = (list: Story[]): MetricCase[] => list.map((s) => s.case);
const byId = (facts: Fact[]) => new Map(facts.map((f) => [f.id, f]));
const ORG = {
  name: "Test Org",
  slug: "test-org",
  planAreas: ["built_environment", "ict"] as const,
  feedbackDesignateTitle: "Manager, Accessibility",
  contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
  contactPhone: "1-800-555-0199",
  contactEmail: "access@example.org",
};

describe("periods", () => {
  it("parses typed dates, allows a future end, refuses start after end and non-dates", () => {
    expect(parsePeriod("2026-01-01", "2026-12-31")).toEqual({ ok: true, period: YEAR });
    expect(parsePeriod("2026-03-01", "2026-02-01").ok).toBe(false);
    const bad = parsePeriod("2026-02-30", "");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.fieldErrors).sort()).toEqual(["end", "start"]);
  });
  it("labels a calendar year by its year, other periods by their dates; years span the period", () => {
    expect(isCalendarYear(YEAR)).toBe(true);
    expect(reportPeriodLabel(YEAR)).toBe("2026");
    expect(reportPeriodLabel({ start: "2026-01-01", end: "2026-03-31" })).toBe("Jan 1, 2026 to Mar 31, 2026");
    expect(periodYears({ start: "2025-04-01", end: "2026-03-31" })).toEqual([2025, 2026]);
  });
});

describe("facts: thin wrappers over lib/metrics", () => {
  const cases = casesOf(stories());
  const facts = compileFacts({ cases, period: YEAR, now: NOW });
  const f = byId(facts);

  it("come in a fixed order, F_AREA for all 7 areas (zeros included), one F_CASE per fixed case in seq order", () => {
    expect(facts.map((x) => x.id)).toEqual([
      "F_TOTAL", "F_ANON", "F_NOT_FEEDBACK",
      "F_AREA:employment", "F_AREA:built_environment", "F_AREA:ict", "F_AREA:communication_other",
      "F_AREA:procurement", "F_AREA:programs_services", "F_AREA:transportation",
      "F_OUTCOME", "F_VERIFY_TIME", "F_ACK", "F_RETEST",
      "F_CASE:BAR-0001", "F_CASE:BAR-0002", "F_CASE:BAR-0003",
    ]);
    expect(facts.every((x) => factKindOf(x.id) === x.kind)).toBe(true);
    expect(factKindOf("F_AREA:")).toBeNull();
    expect(factKindOf("F_TOTAL:x")).toBeNull();
  });

  it("exclude spam and the case received on Dec 31 in Toronto (04:30 UTC on Jan 1)", () => {
    expect(f.get("F_TOTAL")!.values).toEqual({ total: 4, web: 2, email: 1, phone: 1, mail: 0, in_person: 0, other: 0 });
    expect(f.get("F_TOTAL")!.caseIds).toEqual([caseId(1), caseId(2), caseId(3), caseId(6)]);
    expect(f.get("F_AREA:transportation")!.values).toEqual({ count: 0, area: "Transportation" });
    const lastYear = byId(compileFacts({ cases, period: { start: "2025-01-01", end: "2025-12-31" }, now: NOW }));
    expect(lastYear.get("F_TOTAL")!.caseIds).toEqual([caseId(5)]);
    expect(lastYear.get("F_AREA:transportation")!.values.count).toBe(1);
  });

  it("D6: F_NOT_FEEDBACK counts the period's submissions closed as not accessibility feedback, with their cases (only when there are any)", () => {
    expect(f.get("F_NOT_FEEDBACK")).toEqual({ id: "F_NOT_FEEDBACK", kind: "F_NOT_FEEDBACK", values: { notFeedback: 1 }, caseIds: [caseId(4)] });
    expect(factKindOf("F_NOT_FEEDBACK")).toBe("F_NOT_FEEDBACK");
    expect(factKindOf("F_NOT_FEEDBACK:x")).toBeNull();
    const lastYear = compileFacts({ cases, period: { start: "2025-01-01", end: "2025-12-31" }, now: NOW });
    expect(lastYear.some((x) => x.id === "F_NOT_FEEDBACK")).toBe(false);
    // No other fact counts or cites the spam case.
    expect(facts.filter((x) => x.caseIds.includes(caseId(4))).map((x) => x.id)).toEqual(["F_NOT_FEEDBACK"]);
  });

  it("match the lib/metrics functions value for value", () => {
    const input = { cases, period: YEAR, now: NOW };
    const o = outcomes(input);
    expect(f.get("F_OUTCOME")!.values).toEqual({
      verified: o.verified.count, verifiedViaStaffCode: o.verifiedStaffRelayed.count, unverified: o.fixedUnverified.count,
      open: o.inProgress.count, closed: o.closed.count,
    });
    expect(f.get("F_OUTCOME")!.values).toEqual({ verified: 1, verifiedViaStaffCode: 1, unverified: 1, open: 1, closed: 0 });
    expect(f.get("F_ANON")!.values).toEqual({ anonymous: 2, total: totalReceived(input).total.count });
    expect(f.get("F_VERIFY_TIME")!.values).toEqual({ medianDays: medianDaysToVerifiedFix(input).days, verified: 2 });
    expect(f.get("F_VERIFY_TIME")!.values.medianDays).toBe(13); // 14 and 12 days
    const ack = acknowledgementCompliance(input);
    expect(f.get("F_ACK")!.values).toEqual({ nonAnonymous: 2, acked: 2, medianHours: ack.medianHours });
    expect(f.get("F_ACK")!.values.medianHours).toBe(36); // 24 h and 48 h, rounded to one decimal by lib/metrics
    expect(f.get("F_RETEST")!.values).toEqual({ requested: 3, answered: 3, partlyOrNotFixed: 1 });
    expect(f.get("F_RETEST")!.caseIds).toEqual([caseId(1), caseId(3)]);
    expect(f.get("F_CASE:BAR-0003")!.values).toEqual({ publicSummary: "Phone menus timed out after 10 seconds.", outcome: "verified", viaStaffCode: "yes" });
    expect(f.get("F_CASE:BAR-0002")!.values).toEqual({ publicSummary: "A ramp had no handrail", outcome: "fixed_unverified", viaStaffCode: "no" });
  });

  it("leave out F_VERIFY_TIME with no verified case, and F_ACK's median with no acknowledgement", () => {
    const only6 = compileFacts({ cases: [stories()[5].case], period: YEAR, now: NOW });
    expect(only6.some((x) => x.id === "F_VERIFY_TIME")).toBe(false);
    expect(byId(only6).get("F_ACK")!.values).toEqual({ nonAnonymous: 0, acked: 0 });
    expect(only6.flatMap((x) => Object.values(x.values)).every((v) => v !== null && !Number.isNaN(v))).toBe(true);
  });
});

describe("snapshot and manifestHash", () => {
  const all = casesOf(stories());
  const { snapshot, cases } = snapshotFromCases(all, YEAR, NOW);

  it("holds every case received in the period (D6: a spam close too, cited only by F_NOT_FEEDBACK), replayed, with its latest event's hash", () => {
    expect(snapshot.cases.map((c) => c.ref)).toEqual(["BAR-0001", "BAR-0002", "BAR-0003", "BAR-0004", "BAR-0006"]);
    expect(snapshot.cases[3]).toMatchObject({ status: "closed", priorityArea: null, publicSummary: null });
    expect(cases.map((c) => c.id)).toEqual(snapshot.cases.map((c) => c.id));
    const c3 = snapshot.cases[2];
    expect(c3).toMatchObject({ status: "verified", priorityArea: "ict", publicSummary: "Phone menus timed out after 10 seconds.", receivedAt: "2026-04-01T15:00:00.001Z" });
    expect(c3.headHash).toBe(all[2].events[all[2].events.length - 1].hash);
    expect(snapshot).toMatchObject({ version: 1, period: YEAR, asOf: NOW.toISOString() });
    expect(snapshot.facts).toEqual(compileFacts({ cases, period: YEAR, now: NOW }));
  });

  it("is fingerprinted independently of key order, and any changed value changes the fingerprint", () => {
    const h = manifestHash(snapshot);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const reverseKeys = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;
    const shuffled = reverseKeys(snapshot) as ReportSnapshot;
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(snapshot));
    expect(manifestHash(shuffled)).toBe(h);
    const inflated = structuredClone(snapshot);
    inflated.facts.find((x) => x.id === "F_OUTCOME")!.values.verified = 9;
    expect(manifestHash(inflated)).not.toBe(h);
    const renamed = structuredClone(snapshot);
    renamed.cases[0].publicSummary = "Something else.";
    expect(manifestHash(renamed)).not.toBe(h);
    expect(manifestHash({ ...snapshot, period: { start: "2026-01-02", end: "2026-12-31" } })).not.toBe(h);
  });
});

describe("claims and templates", () => {
  const { snapshot } = snapshotFromCases(casesOf(stories()), YEAR, NOW);
  const claims = compileClaims(snapshot, ORG);
  const text = (id: string) => fillTemplate(claims.find((c) => c.claimId === id)!);

  it("templates contain no digits: every number is a slot", () => {
    for (const c of claims) expect(c.template.replace(/\{\w+\}/g, ""), c.claimId).not.toMatch(/\d/);
    expect(claims.every((c) => c.factIds.length > 0)).toBe(true);
  });

  it("F_OUTCOME says 'confirmed by the person who reported', singular forms included; relayed codes are their own sentence", () => {
    expect(text(CLAIM.outcome)).toBe(
      "Of these, 1 was fixed and confirmed by the person who reported it, 1 was fixed but not yet confirmed, and 1 is still in progress.",
    );
    expect(text(CLAIM.outcomeRelayed)).toBe(
      "The person who reported it confirmed 1 more fix, using a code our staff passed on to them.",
    );
  });

  it("with no direct verification, the outcome sentence still says who confirms, and staff-relayed ones are not 'more'", () => {
    const s3 = stories()[2];
    const snap = snapshotFromCases([s3.case], YEAR, NOW).snapshot;
    const c = compileClaims(snap, ORG);
    const fill = (id: string) => fillTemplate(c.find((x) => x.claimId === id)!);
    expect(fill(CLAIM.outcome)).toBe("Of these, none were confirmed by the person who reported them with a code only they held.");
    expect(fill(CLAIM.outcomeRelayed)).toBe("The person who reported it confirmed 1 fix, using a code our staff passed on to them.");
    const s6 = snapshotFromCases([stories()[5].case], YEAR, NOW).snapshot;
    expect(fillTemplate(compileClaims(s6, ORG).find((x) => x.claimId === CLAIM.outcome)!)).toBe(
      "Of these, none have been fixed and confirmed by the person who reported them yet, and 1 is still in progress.",
    );
  });

  it("D6: says how many submissions were closed as not accessibility feedback, singular and plural, citing F_NOT_FEEDBACK", () => {
    const c = claims.find((x) => x.claimId === CLAIM.notFeedback)!;
    expect(c).toMatchObject({ place: "feedback:intro", factIds: ["F_NOT_FEEDBACK"], slots: { notFeedback: 1 } });
    expect(fillTemplate(c)).toBe("We also closed 1 submission as not accessibility feedback, so it is not counted in this section.");
    const two = new Story(caseId(9), ref(9), "2026-07-01T15:00:00Z").close(1, "spam");
    const snap = snapshotFromCases([...casesOf(stories()), two.case], YEAR, NOW).snapshot;
    expect(fillTemplate(compileClaims(snap, ORG).find((x) => x.claimId === CLAIM.notFeedback)!)).toBe(
      "We also closed 2 submissions as not accessibility feedback, so they are not counted in this section.",
    );
    const none = snapshotFromCases([stories()[0].case], YEAR, NOW).snapshot;
    expect(compileClaims(none, ORG).some((x) => x.claimId === CLAIM.notFeedback)).toBe(false);
    // It passes the validator with its own sources (the spam case), and comes right after the anonymous sentence.
    const ctx = validationContext(snapshot);
    expect(validateSentence({ text: fillTemplate(c), factIds: c.factIds }, ctx, c)).toEqual({ ok: true });
    expect(sentenceSources({ factIds: c.factIds }, snapshot).map((x) => x.ref)).toEqual(["BAR-0004"]);
    const intro = claims.filter((x) => x.place === "feedback:intro").map((x) => x.claimId);
    expect(intro).toEqual([CLAIM.total, CLAIM.anon, CLAIM.notFeedback]);
  });

  it("lists only the channels that were used; plural and singular words are chosen from the values", () => {
    expect(text(CLAIM.total)).toBe(
      "In this reporting period, we received 4 pieces of feedback about accessibility: 2 through our online form, 1 by email and 1 by phone.",
    );
    expect(text(CLAIM.anon)).toBe("People chose to stay anonymous for 2 of them, which our feedback process always allows.");
    expect(text(CLAIM.verifyTime)).toBe(
      "For the fixes confirmed by the person who reported them, the median time from receiving the feedback to that confirmation was 13 days.",
    );
    expect(text(CLAIM.ack)).toBe(
      "We acknowledged 2 of the 2 pieces of feedback that were not anonymous, in the same way they reached us. The median time to acknowledge was 36 hours.",
    );
    expect(text(CLAIM.retest)).toBe(
      "We asked the person who reported a barrier to check the fix 3 times and got 3 answers. In 1 of those checks, the person told us the fix only partly worked or did not work yet, so we kept working on it.",
    );
  });

  it("one 'Feedback received in this area: N' per plan area; an area outside the plan with feedback goes to Feedback", () => {
    expect(claims.filter((c) => c.place.startsWith("area:")).map((c) => [c.claimId, fillTemplate(c), c.heading])).toEqual([
      ["C:F_AREA:built_environment", "Feedback received in this area: 1.", "The built environment"],
      ["C:F_AREA:ict", "Feedback received in this area: 2.", "Information and communication technologies"],
    ]);
    expect(text("C:F_AREA:employment")).toBe(
      "We also received 1 piece of feedback about employment, which is not an area in our current accessibility plan.",
    );
    expect(claims.some((c) => c.claimId === "C:F_AREA:transportation")).toBe(false); // 0 and not in the plan
  });

  it("one claim per fixed case, quoting its public summary (with a full stop when it has none)", () => {
    expect(claims.filter((c) => c.claimId.startsWith("C:F_CASE:")).map(fillTemplate)).toEqual([
      "Fixed and confirmed by the person who reported it: The app's sign-in button had no label.",
      "Fixed, but not yet confirmed by the person who reported it: A ramp had no handrail.",
      "Fixed and confirmed by the person who reported it, using a code our staff passed on: Phone menus timed out after 10 seconds.",
    ]);
  });

  it("an empty period still says so, cited", () => {
    const empty = snapshotFromCases([], YEAR, NOW).snapshot;
    const c = compileClaims(empty, ORG);
    expect(c.filter((x) => !x.place.startsWith("area:")).map(fillTemplate)).toEqual(["We received no feedback about accessibility in this reporting period."]);
    expect(c.filter((x) => x.place.startsWith("area:")).map(fillTemplate)).toEqual(["Feedback received in this area: 0.", "Feedback received in this area: 0."]);
  });
});

describe("the validator (domain §7.5)", () => {
  const { snapshot } = snapshotFromCases(casesOf(stories()), YEAR, NOW);
  const ctx = validationContext(snapshot);
  const claims = compileClaims(snapshot, ORG);
  const claim = (id: string) => claims.find((c) => c.claimId === id)!;
  const reasons = (text: string, factIds: string[], c?: Claim) => {
    const r = validateSentence({ text, factIds }, ctx, c);
    return r.ok ? [] : r.reasons.map((x) => (x.detail ? `${x.code}:${x.detail}` : x.code));
  };

  it("accepts every template fill", () => {
    for (const c of claims) expect(reasons(fillTemplate(c), c.factIds, c), c.claimId).toEqual([]);
  });

  it("reads numbers the way people write them", () => {
    expect(numbersIn("1,234 and 11,2 and 24.5, then 7.")).toEqual([1234, 11, 2, 24.5, 7]);
  });

  it("ignores digits inside a quoted public summary and inside cited case refs", () => {
    expect(reasons("Fixed and confirmed by the person who reported it, using a code our staff passed on: Phone menus timed out after 10 seconds.", ["F_CASE:BAR-0003"])).toEqual([]);
    expect(reasons("BAR-0003 was fixed and confirmed by the person who reported it.", ["F_CASE:BAR-0003"])).toEqual([]);
  });

  it("a digit inside a quoted summary does not license the same number elsewhere in the sentence", () => {
    expect(reasons("After 10 days it was fixed and confirmed by the person who reported it, using a code our staff passed on: Phone menus timed out after 10 seconds.", ["F_CASE:BAR-0003"])).toEqual(["invented_number:10"]);
  });

  it("counts numbers written as words: an invented one is refused like digits, a cited value is not", () => {
    expect(numberWordsIn("Twenty-one, one hundred and five, twice, half, dozens, ten and eleven; anyone, someone, none, behalf.").map((w) => [w.word, w.value])).toEqual([
      ["Twenty-one", 21],
      ["one hundred and five", 105],
      ["ten", 10],
      ["eleven", 11],
      ["twice", 2],
      ["half", 0.5],
      ["dozens", NaN],
    ]);
    const total = claim(CLAIM.total);
    const kept = fillTemplate(total);
    expect(reasons(`${kept} Twenty more came by phone.`, ["F_TOTAL"], total)).toEqual(["invented_number:twenty"]);
    expect(reasons(`${kept} About half of it was about the website.`, ["F_TOTAL"], total)).toEqual(["invented_number:half"]);
    expect(reasons(`${kept} Dozens of people wrote.`, ["F_TOTAL"], total)).toEqual(["invented_number:dozens"]);
    // "four" is F_TOTAL's own value: a number word may say a cited value (the digits must still be there).
    expect(reasons(`${kept} That is four in total.`, ["F_TOTAL"], total)).toEqual([]); // "in all" would be a banned word now
    // Full-width digits are numbers too.
    expect(reasons(`${kept} ９ more by phone.`, ["F_TOTAL"], total)).toEqual(["invented_number:9"]);
  });

  it("number words inside a quoted public summary are its text, not numbers of the sentence", () => {
    const story = new Story(caseId(9), ref(9), "2026-07-01T15:00:00Z").triage(0, "built_environment", "One of the two lifts at the east door was out of service for half a day").assign(1).fixNoRetest(3);
    const snap = snapshotFromCases([story.case], YEAR, NOW).snapshot;
    const c = compileClaims(snap, ORG).find((x) => x.claimId === "C:F_CASE:BAR-0009")!;
    const [s] = chooseSentences([c], null, validationContext(snap));
    expect(s).toMatchObject({ fallback: true, text: "Fixed, but not yet confirmed by the person who reported it: One of the two lifts at the east door was out of service for half a day." });
    expect(s.blocked).toBeUndefined();
    // The same words outside the quote are numbers the facts don't have.
    expect(validateSentence({ text: `Two of them, ${s.text}`, factIds: s.factIds }, validationContext(snap), c)).toMatchObject({ ok: false, reasons: [{ code: "invented_number", detail: "two" }] });
  });

  it("reads a case reference in any letter case", () => {
    expect(reasons("bar-0003 was fixed and confirmed by the person who reported it.", ["F_CASE:BAR-0003"])).toEqual([]);
    expect(reasons("bar-0007 was fixed and confirmed by the person who reported it.", ["F_CASE:BAR-0003"])).toEqual(["uncited_case_ref:BAR-0007"]);
  });

  it("allows the period's year, refuses another year", () => {
    expect(reasons("In 2026, we received 4 pieces of feedback.", ["F_TOTAL"])).toEqual([]);
    expect(reasons("In 2025, we received 4 pieces of feedback.", ["F_TOTAL"])).toEqual(["invented_number:2025"]);
  });

  it("keeps a lead-approved summary with brackets from blocking its own sentence", () => {
    const story = new Story(caseId(9), ref(9), "2026-07-01T15:00:00Z").triage(0, "ict", "The [Submit] button had no label (see BAR-0001).").assign(1).fixNoRetest(3);
    const snap = snapshotFromCases([story.case], YEAR, NOW).snapshot;
    const c = compileClaims(snap, ORG).find((x) => x.claimId === "C:F_CASE:BAR-0009")!;
    const [s] = chooseSentences([c], null, validationContext(snap));
    expect(s).toMatchObject({ fallback: true, text: "Fixed, but not yet confirmed by the person who reported it: The [Submit] button had no label (see BAR-0001)." });
    expect(s.blocked).toBeUndefined();
  });

  it("marks a sentence blocked (not an exception) when even its template fails", () => {
    const broken: Claim = { claimId: "C:F_TOTAL", heading: "Feedback", template: "We received {total} pieces, {extra} more.", slots: { total: 4, extra: 99 }, factIds: ["F_TOTAL"] };
    const [s] = chooseSentences([broken], null, ctx);
    expect(s.blocked).toEqual(["invented_number"]);
    expect(exportBlockers({ sections: [{ key: "feedback", heading: "Feedback", level: 2, blocks: [{ kind: "claim", sentence: s }] }] })).toEqual([
      { sentenceId: "C:F_TOTAL", reason: "blocked" },
    ]);
  });

  it("falls back per claim: a missing or refused phrased sentence uses its template, a good one is kept", () => {
    const picked = [claim(CLAIM.total), claim(CLAIM.outcome), claim(CLAIM.anon)];
    const phrased: PhraseClaimsOutput = [
      { claimId: CLAIM.total, text: "We got 4 pieces of feedback this period: 2 through our online form, 1 by email and 1 by phone." },
      { claimId: CLAIM.outcome, text: "Of these, 9 were fixed and confirmed by the person who reported them." },
    ];
    const out = chooseSentences(picked, phrased, ctx);
    expect(out.map((s) => [s.id, s.fallback, s.rejected ?? null])).toEqual([
      [CLAIM.total, false, null],
      [CLAIM.outcome, true, ["invented_number", "dropped_slot"]],
      [CLAIM.anon, true, null],
    ]);
    expect(out[1].text).toBe(fillClaimTemplate(claim(CLAIM.outcome)));
    expect(chooseSentences(picked, null, ctx).every((s) => s.fallback && s.text === fillTemplate(claims.find((c) => c.claimId === s.id)!))).toBe(true);
  });
});

describe("the AI wording step (phraseClaims errors)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const claims: Claim[] = [{ claimId: "C:F_TOTAL", heading: "Feedback", template: "We received {total} pieces.", slots: { total: 4 }, factIds: ["F_TOTAL"] }];

  it("the fake backend returns the template text, so nothing falls back", async () => {
    process.env.FAKE_LLM = "1";
    const { phraseClaims } = await import("@/lib/ai");
    const r = await phraseOrTemplates(claims, undefined, phraseClaims);
    expect(r.meta).toMatchObject({ ok: true, backend: "fake" });
    expect(r.sentences).toEqual([{ claimId: "C:F_TOTAL", text: "We received 4 pieces." }]);
  });

  it("any AiError means templates for every sentence, with only the error's class name kept", async () => {
    for (const err of [
      new AiTimeoutError("claude-cli", 60_000),
      new AiBackendUnavailableError("api", "No ANTHROPIC_API_KEY."),
      new AiNotAllowedError("claude-cli", "Not a local request."),
      new AiCallError("api", "HTTP 529."),
      new AiOutputError("api", "Did not match."),
    ]) {
      const r = await phraseOrTemplates(claims, undefined, () => Promise.reject(err));
      expect(r).toEqual({ sentences: null, meta: { ok: false, backend: null, model: null, promptSha: null, latencyMs: null, error: err.name } });
    }
  });

  it("AiConfigError and non-AI errors are rethrown (loud)", async () => {
    await expect(phraseOrTemplates(claims, undefined, () => Promise.reject(new AiConfigError("bad AI_BACKEND")))).rejects.toThrow(AiConfigError);
    await expect(phraseOrTemplates(claims, undefined, () => Promise.reject(new TypeError("bug")))).rejects.toThrow(TypeError);
  });
  it("\"Don't use AI on my report\" (domain §4): an opted-out case's own sentence is never sent to the AI", () => {
    const own = (r: string): Claim => ({ claimId: CLAIM.case(r), heading: "Feedback", template: "Fixed: {publicSummary}", slots: { publicSummary: `Summary of ${r}.` }, factIds: [`F_CASE:${r}`] });
    const all = [...claims, own("BAR-0001"), own("BAR-0002"), own("BAR-0010")];
    expect(caseClaimRefs(all)).toEqual(["BAR-0001", "BAR-0002", "BAR-0010"]);
    expect(claimsForAi(all, new Set(["BAR-0002"])).map((c) => c.claimId)).toEqual(["C:F_TOTAL", CLAIM.case("BAR-0001"), CLAIM.case("BAR-0010")]);
    expect(claimsForAi(all, new Set())).toEqual(all);
    // A count sentence that cites many cases is never dropped, whatever the refs: it carries no case text.
    expect(claimsForAi(claims, new Set(["F_TOTAL", "C:F_TOTAL"]))).toEqual(claims);
    // Left out of the AI's list, the sentence falls back to its template (chooseSentences).
  });
});

describe("the draft (domain §7.7) and its checks", () => {
  const { snapshot } = snapshotFromCases(casesOf(stories()), YEAR, NOW);
  const settings = reportSettings({ ...ORG, planAreas: ["ict", "built_environment", "ict"] }, "http://localhost:3000/o/test-org/report");
  const claims = compileClaims(snapshot, settings);
  const sentences = chooseSentences(claims, null, validationContext(snapshot));
  const content = buildContent(settings, YEAR, claims, sentences, { ok: false, backend: null, model: null, promptSha: null, latencyMs: null, error: "AiTimeoutError" });

  it("has General, one h2 per plan area (ACA order, once each), Consultations, Feedback", () => {
    expect(content.sections.map((s) => [s.key, s.heading, s.level])).toEqual([
      ["general", "General", 2],
      ["area:built_environment", "The built environment", 2],
      ["area:ict", "Information and communication technologies", 2],
      ["consultations", "Consultations", 2],
      ["feedback", "Feedback", 2],
    ]);
    expect(content.phrase).toMatchObject({ ok: false, error: "AiTimeoutError", fallbacks: sentences.length });
    const feedback = content.sections[4].blocks;
    expect(feedback.filter((b) => b.kind === "subheading").map((b) => (b.kind === "subheading" ? b.text : ""))).toEqual([
      "What happened to the feedback", "How we followed up", "How feedback was taken into consideration",
    ]);
    const list = feedback.find((b) => b.kind === "claimList");
    expect(list && list.kind === "claimList" ? list.sentences.map((s) => s.id) : []).toEqual(["C:F_CASE:BAR-0001", "C:F_CASE:BAR-0002", "C:F_CASE:BAR-0003"]);
  });

  it("General gives the designate title, mail, phone, email and alternate formats (R5), and a period sentence", () => {
    const g = generalSentences(settings, YEAR).join(" ");
    expect(g).toContain("This report covers feedback received in 2026.");
    expect(g).toContain("The Manager, Accessibility receives feedback on behalf of Test Org.");
    expect(g).toContain("alternate format");
    expect(g).toContain("http://localhost:3000/o/test-org/report");
    expect(generalSentences({ ...settings, feedbackDesignateTitle: "The Accessibility Office" }, YEAR)[1]).toBe("The Accessibility Office receives feedback on behalf of Test Org.");
    expect(generalSentences(settings, { start: "2026-01-01", end: "2026-03-31" })[0]).toBe("This report covers feedback received from Jan 1, 2026 to Mar 31, 2026.");
    const results = checkProgressReport(toDraftSections(content, {}, null), { ...settings });
    expect(results.filter((r) => r.id.startsWith("R5")).every((r) => r.ok)).toBe(true);
  });

  it("passes with only warnings while the text boxes are empty; sign-off waits until every box is written", () => {
    const empty = reportChecks(content, {}, null);
    expect(empty.passes).toBe(true);
    expect(empty.results.filter((r) => !r.ok).map((r) => r.id).sort()).toEqual(["W:built_environment", "W:consultations", "W:ict"]);
    expect(empty).toMatchObject({ toWrite: 3, blockers: [], canSignOff: false });
    const partial = reportChecks(content, { ict: "We added labels." }, null);
    expect(partial).toMatchObject({ toWrite: 2, canSignOff: false });
    const full = reportChecks(content, { ict: "We added labels.", built_environment: "  We fixed ramps. " }, "We met with our advisory group.");
    expect(full).toMatchObject({ passes: true, toWrite: 0, canSignOff: true });
    expect(passes(full.results) && full.results.every((r) => r.ok)).toBe(true);
  });

  it("a draft without settings in General fails the required checks", () => {
    const bare = buildContent({ ...settings, contactPhone: "613-555-0000" }, YEAR, claims, sentences, content.phrase);
    const checks = reportChecks({ ...bare, settings }, {}, null);
    expect(checks.passes).toBe(false);
    expect(checks.results.find((r) => r.id === "R5:phone")?.ok).toBe(false);
  });

  it("lists each sentence's sources and the cited cases in snapshot order", () => {
    const total = sentences.find((s) => s.id === CLAIM.total)!;
    expect(sentenceSources(total, snapshot).map((c) => c.ref)).toEqual(["BAR-0001", "BAR-0002", "BAR-0003", "BAR-0006"]);
    expect(sentenceSources(sentences.find((s) => s.id === "C:F_CASE:BAR-0002")!, snapshot).map((c) => c.ref)).toEqual(["BAR-0002"]);
    expect(citedCaseIds(content, snapshot)).toEqual(snapshot.cases.map((c) => c.id));
  });

  it("re-validating stored sentences against the snapshot catches a changed number or citation", () => {
    expect(revalidateContent(content, snapshot)).toEqual({ ok: true, failed: [] });
    const tampered = structuredClone(content);
    for (const sec of tampered.sections) for (const b of sec.blocks) if (b.kind === "claim" && b.sentence.id === CLAIM.outcome) b.sentence.text = b.sentence.text.replace("1 was fixed and", "6 were fixed and");
    expect(revalidateContent(tampered, snapshot)).toEqual({ ok: false, failed: [CLAIM.outcome] });
    const recited = structuredClone(content);
    for (const sec of recited.sections) for (const b of sec.blocks) if (b.kind === "claim" && b.sentence.id === CLAIM.anon) b.sentence.factIds = ["F_TOTAL"];
    expect(revalidateContent(recited, snapshot).failed).toEqual([CLAIM.anon]);
  });

  it("re-validating catches two of a sentence's numbers swapped (number_order), though both are cited values", () => {
    const swapped = structuredClone(content);
    const sentences = swapped.sections.flatMap((sec) => sec.blocks.flatMap((b) => (b.kind === "claim" ? [b.sentence] : b.kind === "claimList" ? b.sentences : [])));
    // The first sentence with two different numbers (e.g. "4 ... 2 ..."): write each where the other was.
    const target = sentences.find((s) => new Set(numbersIn(s.text)).size >= 2);
    expect(target).toBeDefined();
    const [a, c] = [...new Set(numbersIn(target!.text))].map(String);
    target!.text = target!.text.replace(/\d+/g, (m) => (m === a ? c : m === c ? a : m));
    // Both numbers are cited values, so without the claim's template order the sentence would pass.
    expect(validateSentence(target!, validationContext(snapshot)).ok).toBe(true);
    expect(revalidateContent(swapped, snapshot)).toEqual({ ok: false, failed: [target!.id] });
  });
});

describe("replay (domain §8 check 3)", () => {
  const all = casesOf(stories());
  const { snapshot } = snapshotFromCases(all, YEAR, NOW);

  it("replaying each case to its head gives the snapshot back, and the facts recompute exactly", () => {
    const r = replaySnapshot(snapshot, all);
    expect(r.ok).toBe(true);
    expect(r.facts).toEqual({ ok: true, mismatched: [] });
    expect(r.rows.map((x) => [x.ref, x.ok, x.laterUpdates])).toEqual([
      ["BAR-0001", true, 0], ["BAR-0002", true, 0], ["BAR-0003", true, 0], ["BAR-0004", true, 0], ["BAR-0006", true, 0],
    ]);
    expect(r.rows.map((x) => x.replayed)).toEqual(snapshot.cases);
  });

  it("a snapshot frozen before D6 (no spam case, no F_NOT_FEEDBACK) still recomputes exactly", () => {
    const old = structuredClone(snapshot);
    old.cases = old.cases.filter((c) => c.id !== caseId(4));
    old.facts = old.facts.filter((f) => f.id !== "F_NOT_FEEDBACK");
    const r = replaySnapshot(old, all);
    expect(r.facts).toEqual({ ok: true, mismatched: [] });
    expect(r.ok).toBe(true);
  });

  it("events after the head are later updates, not errors", () => {
    const later = stories();
    later[5].assign(200);
    const r = replaySnapshot(snapshot, casesOf(later));
    expect(r.ok).toBe(true);
    expect(r.rows.find((x) => x.ref === "BAR-0006")).toMatchObject({ ok: true, laterUpdates: 1 });
  });

  it("an unknown head, an edited event and a missing case all fail", () => {
    const edited = casesOf(stories());
    const c2 = edited[1];
    const triaged = c2.events.find((e) => e.type === "triaged")!;
    (triaged.payload as Record<string, unknown>).publicSummary = "Something else";
    const r = replaySnapshot(snapshot, edited);
    expect(r.ok).toBe(false);
    expect(r.rows.find((x) => x.ref === "BAR-0002")).toMatchObject({ ok: false, headFound: true, differs: ["publicSummary"], factsDiffer: true });
    expect(r.facts.mismatched).toEqual(["F_CASE:BAR-0002"]);

    expect(cutAtHead(all[0], "f".repeat(64))).toBeNull();
    const unknownHead = structuredClone(snapshot);
    unknownHead.cases[0].headHash = "f".repeat(64);
    const u = replaySnapshot(unknownHead, all);
    expect(u.rows[0]).toMatchObject({ headFound: false, ok: false });
    expect(u.ok).toBe(false);

    const missing = replaySnapshot(snapshot, all.filter((c) => c.id !== caseId(6)));
    expect(missing.rows.find((x) => x.ref === "BAR-0006")).toMatchObject({ headFound: false, ok: false });
    expect(missing.facts.ok).toBe(false);
  });

  it("an inflated snapshot fact does not recompute", () => {
    const inflated = structuredClone(snapshot);
    inflated.facts.find((f) => f.id === "F_OUTCOME")!.values.verified = 6;
    const r = replaySnapshot(inflated, all);
    expect(r.facts.mismatched).toEqual(["F_OUTCOME"]);
    // Every case F_OUTCOME cites is marked; the spam close is not one of them (only F_NOT_FEEDBACK cites it).
    expect(r.rows.filter((x) => x.ref !== "BAR-0004").every((x) => x.factsDiffer && !x.ok)).toBe(true);
    expect(r.rows.find((x) => x.ref === "BAR-0004")).toMatchObject({ factsDiffer: false, ok: true });
  });

  it("an inflated F_NOT_FEEDBACK does not recompute either", () => {
    const inflated = structuredClone(snapshot);
    inflated.facts.find((f) => f.id === "F_NOT_FEEDBACK")!.values.notFeedback = 0;
    const r = replaySnapshot(inflated, all);
    expect(r.facts.mismatched).toEqual(["F_NOT_FEEDBACK"]);
    expect(r.rows.find((x) => x.ref === "BAR-0004")).toMatchObject({ factsDiffer: true, ok: false });
  });
});
