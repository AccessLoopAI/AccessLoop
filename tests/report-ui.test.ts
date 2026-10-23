// What the report pages render (lib/report/view.ts) and the plain-text export (lib/report/text.ts), pure, over
// synthetic chains (tests/support/report-story.ts): the sources behind each sentence, the footnote button's exact
// name, the checklist's grouping and its "All required checks pass" line, the dashboard's report-readiness card (the
// same checks, re-run from the stored row), the lead's paragraphs, the ACR s.16 reminder, and an export with headings,
// [n] markers, SOURCES, RECORDS and the fingerprint (never "undefined").
import { describe, expect, it } from "vitest";
import { zonedNoon } from "@/lib/dates";
import type { MetricCase } from "@/lib/metrics";
import { compileClaims, fillTemplate } from "@/lib/report/claims";
import { buildContent, reportChecks, reportSettings, sentenceSources } from "@/lib/report/compose";
import { manifestHash, snapshotFromCases } from "@/lib/report/snapshot";
import { reportReadiness, type ReadinessInput } from "@/lib/report/readiness";
import { noSummaryWords } from "@/lib/report/labels";
import { plainTextFilename, reportPlainText } from "@/lib/report/text";
import type { ReportContent } from "@/lib/report/types";
import { chooseSentences, contentSentences, validationContext } from "@/lib/report/validate";
import {
  checksSummary,
  checksView,
  leadLabel,
  leadParagraphs,
  receivedPhrase,
  regulatorNoticeDue,
  reportState,
  reportView,
  sectionCitation,
  sourcesButtonName,
  toWriteLine,
} from "@/lib/report/view";
import { Story, caseId, ref } from "./support/report-story";

const NOW = zonedNoon("2026-10-19");
const YEAR = { start: "2026-01-01", end: "2026-12-31" };
const ORG = {
  name: "Test Org",
  slug: "test-org",
  planAreas: ["built_environment", "ict"] as const,
  feedbackDesignateTitle: "Manager, Accessibility",
  contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
  contactPhone: "1-800-555-0199",
  contactEmail: "access@example.org",
};

function cases(): MetricCase[] {
  return [
    new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "The app's sign-in button had no label.").assign(1).fixWithRetest(10).verdict(14, "fixed"),
    new Story(caseId(2), ref(2), "2026-03-01T15:00:00Z", { channel: "email", anonymous: false })
      .ack(1, "email")
      .triage(0, "built_environment", "A ramp had no handrail")
      .assign(1)
      .fixNoRetest(5),
    new Story(caseId(3), ref(3), "2026-06-01T15:00:00Z"),
  ].map((s) => s.case);
}

function draft() {
  const { snapshot } = snapshotFromCases(cases(), YEAR, NOW);
  const settings = reportSettings(ORG, "https://example.org/o/test-org/report");
  const claims = compileClaims(snapshot, settings);
  const sentences = chooseSentences(claims, null, validationContext(snapshot));
  const content: ReportContent = buildContent(settings, YEAR, claims, sentences, { ok: true, backend: "fake", model: "fake", promptSha: null, latencyMs: 0 });
  return { snapshot, content, claims };
}

describe("the report view", () => {
  it("keeps every section and heading, and each sentence's sources are its facts' cases, as snapshot indexes", () => {
    const { snapshot, content } = draft();
    const view = reportView(content, snapshot);
    expect(view.sections.map((s) => s.heading)).toEqual(["General", "The built environment", "Information and communication technologies", "Consultations", "Feedback"]);
    expect(view.cases.map((c) => c.ref)).toEqual(snapshot.cases.map((c) => c.ref));
    const all = view.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "claim" ? [b.sentence] : b.kind === "claimList" ? b.sentences : [])));
    expect(all.length).toBe(contentSentences(content).length);
    for (const s of contentSentences(content)) {
      const v = all.find((x) => x.id === s.id)!;
      expect(v.sources.map((i) => view.cases[i].ref)).toEqual(sentenceSources(s, snapshot).map((c) => c.ref));
    }
    const total = all.find((s) => s.id === "C:F_TOTAL")!;
    expect(total.sources).toHaveLength(3);
    expect(view.cases[0]).toMatchObject({ ref: ref(1), summary: "The app's sign-in button had no label.", status: "verified", statusLabel: "Verified by reporter" });
    expect(view.cases[2]).toMatchObject({ summary: null, statusLabel: "New" });
  });

  it("names the footnote button exactly as domain §7.9 says, singular for one record", () => {
    expect(sourcesButtonName(3)).toBe("Sources for this sentence (3 records)");
    expect(sourcesButtonName(1)).toBe("Sources for this sentence (1 record)");
    expect(sourcesButtonName(0)).toBe("Sources for this sentence (0 records)");
    for (const n of [0, 1, 2, 16, 400]) expect(sourcesButtonName(n)).toMatch(/^Sources for this sentence \(\d+ records?\)$/);
  });

  it("cites the law behind each section", () => {
    expect(sectionCitation("general")).toBe("ACR s.14(1)(a) and s.14(2)");
    expect(sectionCitation("area:built_environment")).toBe("ACR s.14(1)(b); ACA s.5(b)");
    expect(sectionCitation("consultations")).toContain("ACA s.71(4)");
    expect(sectionCitation("feedback")).toContain("ACA s.71(5)");
  });

  it("labels the lead's text boxes and splits their text into paragraphs on blank lines", () => {
    expect(leadLabel("area:built_environment", "The built environment")).toBe("Your progress on the built environment");
    expect(leadLabel("area:employment", "Employment")).toBe("Your progress on employment");
    expect(leadLabel("consultations", "Consultations")).toBe("How you consulted persons with disabilities for this report");
    expect(leadParagraphs("First line\nsame paragraph\r\n\r\n  Second  \n\n\n")).toEqual(["First line\nsame paragraph", "Second"]);
    expect(leadParagraphs(null)).toEqual([]);
  });

  it("says when the period was, for a year or for dates", () => {
    expect(receivedPhrase(YEAR)).toBe("in 2026");
    expect(receivedPhrase({ start: "2026-01-01", end: "2026-03-31" })).toBe("from Jan 1, 2026 to Mar 31, 2026");
  });
});

describe("the Report checks list", () => {
  it("groups required checks and the parts still to write, ties each to its section, and says 'All required checks pass'", () => {
    const { snapshot, content } = draft();
    const view = reportView(content, snapshot);
    const live = reportChecks(content, {}, null);
    const c = checksView(live.results, view.sections);
    expect(c.passes).toBe(true);
    expect(c.failing).toBe(0);
    expect(c.required.every((x) => x.state === "passed")).toBe(true);
    expect(c.toWrite.map((x) => x.id)).toEqual(["W:built_environment", "W:ict", "W:consultations"]);
    expect(c.toWrite.every((x) => x.state === "to_write")).toBe(true);
    const sectionOf = (id: string) => view.sections[[...c.required, ...c.toWrite].find((x) => x.id === id)!.section].key;
    expect(sectionOf("R1")).toBe("general");
    expect(sectionOf("R5:email")).toBe("general");
    expect(sectionOf("R2:ict")).toBe("area:ict");
    expect(sectionOf("W:built_environment")).toBe("area:built_environment");
    expect(sectionOf("R3")).toBe("consultations");
    expect(sectionOf("W:consultations")).toBe("consultations");
    expect(sectionOf("R4")).toBe("feedback");
    expect(checksSummary(c, 0)).toBe("All required checks pass");
    expect(toWriteLine(live.toWrite)).toBe("3 parts still need your text");
    expect(toWriteLine(1)).toBe("1 part still needs your text");
    expect(toWriteLine(0)).toBe("Every part has its text");
  });

  it("never says 'All required checks pass' while a required check fails or a sentence blocks sign-off", () => {
    const { snapshot, content } = draft();
    const broken = { ...content, settings: { ...content.settings, contactEmail: "other@example.org" } };
    const c = checksView(reportChecks(broken, {}, null).results, reportView(broken, snapshot).sections);
    expect(c.passes).toBe(false);
    expect(c.required.find((x) => x.id === "R5:email")!.state).toBe("missing");
    expect(checksSummary(c, 0)).toBe("1 required check fails");
    const ok = checksView(reportChecks(content, {}, null).results, []);
    expect(checksSummary(ok, 2)).toBe("2 required checks fail");
  });
});

describe("report state and the ACR s.16 reminder", () => {
  it("is a draft until signed off, then signed off, then published", () => {
    expect(reportState({ status: "draft", publishedAt: null })).toBe("draft");
    expect(reportState({ status: "signed_off", publishedAt: null })).toBe("signed_off");
    expect(reportState({ status: "signed_off", publishedAt: new Date() })).toBe("published");
  });
  it("reminds 48 hours after publishing", () => {
    expect(regulatorNoticeDue(new Date("2026-10-19T14:00:00Z")).toISOString()).toBe("2026-10-21T14:00:00.000Z");
  });
});

describe("the dashboard's report-readiness card (domain §10 item 5)", () => {
  const stored = (content: ReportContent, extra: Partial<ReadinessInput> = {}): ReadinessInput => ({
    status: "draft",
    publishedAt: null,
    content,
    areaText: {},
    consultationsText: null,
    ...extra,
  });

  it("says what the report page's 'Report checks' says, re-run from the stored content and the lead's text", () => {
    const { snapshot, content } = draft();
    for (const [areaText, consultationsText] of [
      [{}, null],
      [{ ict: "We added labels." }, null],
      [{ ict: "We added labels.", built_environment: "We fixed ramps." }, "We met our advisory group."],
    ] as [Record<string, string>, string | null][]) {
      const r = reportReadiness(stored(content, { areaText, consultationsText }));
      const live = reportChecks(content, areaText, consultationsText);
      expect(r.summary).toBe(checksSummary(checksView(live.results, reportView(content, snapshot).sections), live.blockers.length));
      expect(r.toWriteLine).toBe(toWriteLine(live.toWrite));
      expect([r.toWrite, r.canSignOff]).toEqual([live.toWrite, live.canSignOff]);
    }
  });

  it("a fresh draft passes with parts to write; a written one is ready for sign-off", () => {
    const { content } = draft();
    expect(reportReadiness(stored(content))).toEqual({
      state: "draft",
      ok: true,
      summary: "All required checks pass",
      toWrite: 3,
      toWriteLine: "3 parts still need your text",
      blockers: 0,
      canSignOff: false,
      next: "Write the missing parts, then sign off.",
    });
    const written = reportReadiness(stored(content, { areaText: { ict: "We added labels.", built_environment: "We fixed ramps." }, consultationsText: "We met our advisory group." }));
    expect(written).toMatchObject({ ok: true, toWrite: 0, toWriteLine: "Every part has its text", canSignOff: true, next: "Ready for sign-off." });
    expect(reportReadiness(stored(content, { areaText: null })).toWrite).toBe(3); // a missing area_text reads as nothing written
  });

  it("never says the checks pass while a required check fails or a sentence blocks sign-off", () => {
    const { content } = draft();
    const broken = reportReadiness(stored({ ...content, settings: { ...content.settings, contactEmail: "other@example.org" } }));
    expect(broken).toMatchObject({ ok: false, summary: "1 required check fails", canSignOff: false, next: "Fix the required checks before sign-off." });
    const blocked = structuredClone(content);
    const claim = blocked.sections.flatMap((s) => s.blocks).find((b) => b.kind === "claim");
    if (claim?.kind === "claim") claim.sentence.blocked = ["invented_number"];
    const r = reportReadiness(stored(blocked));
    expect(r).toMatchObject({ ok: false, blockers: 1, summary: "1 required check fails", canSignOff: false });
    expect(r.next).toContain("Build a new one.");
    // A sentence without sources blocks sign-off too (exportBlockers), and the next step says so.
    const unsourced = structuredClone(content);
    const bare = unsourced.sections.flatMap((s) => s.blocks).find((b) => b.kind === "claim");
    if (bare?.kind === "claim") bare.sentence.factIds = [];
    const u = reportReadiness(stored(unsourced));
    expect(u).toMatchObject({ ok: false, blockers: 1, summary: "1 required check fails", canSignOff: false });
    expect(u.next).toBe("A sentence has no sources or did not pass the sentence checks, so this draft can't be signed off. Build a new one.");
  });

  it("names the state of a signed-off and a published report", () => {
    const { content } = draft();
    const text = { areaText: { ict: "We added labels.", built_environment: "We fixed ramps." }, consultationsText: "We met our advisory group." };
    expect(reportReadiness(stored(content, { ...text, status: "signed_off" }))).toMatchObject({ state: "signed_off", ok: true, next: "Signed off, not published yet." });
    expect(reportReadiness(stored(content, { ...text, status: "signed_off", publishedAt: new Date() }))).toMatchObject({ state: "published", next: "Published on your public page." });
  });
});

describe("the plain-text export", () => {
  it("has the title, each heading in capitals, a [n] after every sentence, SOURCES, RECORDS and the fingerprint", () => {
    const { snapshot, content } = draft();
    const text = reportPlainText({
      title: "Accessibility progress report 2026, version 1",
      orgName: ORG.name,
      content,
      snapshot,
      areaText: { built_environment: "We fixed two ramps.\n\nWe added handrails." },
      consultationsText: null,
      manifestHash: manifestHash(snapshot),
      signedOffAt: null,
      publishedAt: null,
      verifyUrl: "https://example.org/verify/x",
    });
    expect(text.split("\n")[0]).toBe("ACCESSIBILITY PROGRESS REPORT 2026, VERSION 1");
    expect(text).toContain("DRAFT: not signed off yet.");
    for (const h of ["GENERAL", "THE BUILT ENVIRONMENT", "INFORMATION AND COMMUNICATION TECHNOLOGIES", "CONSULTATIONS", "FEEDBACK", "SOURCES", "RECORDS"]) {
      expect(text.split("\n")).toContain(h);
    }
    const n = contentSentences(content).length;
    for (let i = 1; i <= n; i++) expect(text).toContain(`[${i}]`);
    expect(text).not.toContain(`[${n + 1}]`);
    expect(text).toContain("We fixed two ramps.");
    expect(text).toContain("We added handrails.");
    expect(text).toContain("(Not written yet.)");
    expect(text).toContain(`${ref(1)} (Verified by reporter): The app's sign-in button had no label.`);
    expect(text).toContain(`${ref(3)} (New): Waiting for review`);
    expect(text).toContain(`Fingerprint of this report (SHA-256): ${manifestHash(snapshot)}`);
    expect(text).toContain("Evidence check: https://example.org/verify/x");
    expect(text).toContain(fillTemplate(compileClaims(snapshot, { planAreas: [...ORG.planAreas] }).find((c) => c.claimId === "C:F_OUTCOME")!).slice(0, 40));
    expect(text).not.toMatch(/undefined|null|\[object/);
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(110);
  });

  it("a cited case closed before review (spam, D6) says so, not \"Waiting for review\" (Sources, /verify and the export share the words)", () => {
    const withSpam = [...cases(), new Story(caseId(4), ref(4), "2026-07-01T15:00:00Z").close(1, "spam").case];
    const { snapshot } = snapshotFromCases(withSpam, YEAR, NOW);
    const settings = reportSettings(ORG, "https://example.org/o/test-org/report");
    const claims = compileClaims(snapshot, settings);
    expect(claims.some((c) => c.claimId === "C:F_NOT_FEEDBACK")).toBe(true); // it is cited
    const content = buildContent(settings, YEAR, claims, chooseSentences(claims, null, validationContext(snapshot)), { ok: true, backend: "fake", model: "fake", promptSha: null, latencyMs: 0 });
    const text = reportPlainText({
      title: "Accessibility progress report 2026, version 1", orgName: ORG.name, content, snapshot, areaText: {}, consultationsText: null,
      manifestHash: manifestHash(snapshot), signedOffAt: null, publishedAt: null, verifyUrl: "https://example.org/verify/x",
    });
    expect(text).toContain(`${ref(4)} (Closed): Closed before review (no public summary).`);
    expect(text).toContain(`${ref(3)} (New): Waiting for review (no public summary yet).`);
    expect(noSummaryWords("closed")).toBe("Closed before review (no public summary)");
    expect(noSummaryWords("new")).toBe("Waiting for review");
    expect(noSummaryWords(undefined)).toBe("Waiting for review");
  });

  it("says when it was signed off and published", () => {
    const { snapshot, content } = draft();
    const text = reportPlainText({
      title: "T",
      orgName: ORG.name,
      content,
      snapshot,
      areaText: {},
      consultationsText: "We met the advisory group.",
      manifestHash: "a".repeat(64),
      signedOffAt: zonedNoon("2026-10-19"),
      publishedAt: zonedNoon("2026-10-20"),
      verifyUrl: "/verify/x",
    });
    expect(text).toContain("Signed off on October 19, 2026. Published on October 20, 2026.");
    expect(text).not.toContain("DRAFT");
    expect(text).toContain("We met the advisory group.");
  });

  it("says which period it covers, for a year or for dates", () => {
    const year = draft();
    const base = { title: "T", orgName: ORG.name, areaText: {}, consultationsText: null, manifestHash: "a".repeat(64), signedOffAt: null, publishedAt: null, verifyUrl: "/verify/x" };
    expect(reportPlainText({ ...base, content: year.content, snapshot: year.snapshot }).split("\n")).toContain("Feedback received in 2026.");

    const Q1 = { start: "2026-01-01", end: "2026-03-31" };
    const { snapshot } = snapshotFromCases(cases(), Q1, NOW);
    const settings = reportSettings(ORG, "https://example.org/o/test-org/report");
    const claims = compileClaims(snapshot, settings);
    const content = buildContent(settings, Q1, claims, chooseSentences(claims, null, validationContext(snapshot)), { ok: true, backend: "fake", model: "fake", promptSha: null, latencyMs: 0 });
    const lines = reportPlainText({ ...base, content, snapshot }).split("\n");
    expect(lines).toContain(`Feedback received ${receivedPhrase(Q1)}.`);
    expect(lines.some((l) => l.startsWith("Feedback received in Jan"))).toBe(false);
  });

  it("names the file after the title", () => {
    expect(plainTextFilename("Accessibility progress report 2026, version 3")).toBe("accessibility-progress-report-2026-version-3.txt");
    expect(plainTextFilename("!!!")).toBe("progress-report.txt");
  });
});
