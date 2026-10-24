// /verify (docs/domain.md §8), pure: the four checks over synthetic chains (tests/support/report-story.ts), the status
// line, the chain drawing derived from check 2's verdict, and the "Records" table rendered to static HTML (one row per
// cited case, every mark with its words). The seeded-PGlite version with real hashes, the frozen verifyCaseChain and
// real tampering is tests/evidence.seed.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChainCheck } from "@/lib/case-events";
import { zonedNoon } from "@/lib/dates";
import { EvidenceChecks, EvidenceRecords, EvidenceVerdict } from "@/components/report/EvidenceCheck";
import { compileClaims } from "@/lib/report/claims";
import { buildContent, reportSettings } from "@/lib/report/compose";
import { checkEvidence, eventWord, readStoredReport, refList, type ChainEvent } from "@/lib/report/evidence";
import { manifestHash, snapshotFromCases } from "@/lib/report/snapshot";
import type { ReportContent, ReportSnapshot } from "@/lib/report/types";
import { chooseSentences, validationContext } from "@/lib/report/validate";
import { Story, caseId, ref } from "./support/report-story";

const NOW = zonedNoon("2026-10-19");
const YEAR = { start: "2026-01-01", end: "2026-12-31" };
const GENESIS = "0".repeat(64);

function stories(): Story[] {
  return [
    new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "The app's sign-in button had no label.").assign(1).fixWithRetest(10).verdict(14, "fixed"),
    new Story(caseId(2), ref(2), "2026-03-01T15:00:00Z", { channel: "email", anonymous: false })
      .ack(1, "email").triage(0, "built_environment", "A ramp had no handrail.").assign(1).fixNoRetest(5),
    new Story(caseId(3), ref(3), "2026-04-01T15:00:00Z").triage(0, "ict", "A form timed out."),
  ];
}

const ORG = {
  name: "Test Org",
  slug: "test-org",
  planAreas: ["built_environment", "ict"] as const,
  feedbackDesignateTitle: "Manager, Accessibility",
  contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
  contactPhone: "1-800-555-0199",
  contactEmail: "access@example.org",
};

function build(list: Story[]) {
  const { snapshot } = snapshotFromCases(list.map((s) => s.case), YEAR, NOW);
  const settings = reportSettings({ ...ORG, planAreas: [...ORG.planAreas] }, "http://localhost:3000/o/test-org/report");
  const claims = compileClaims(snapshot, settings);
  const sentences = chooseSentences(claims, null, validationContext(snapshot));
  const content = buildContent(settings, YEAR, claims, sentences, { ok: true, backend: "fake", model: "fake", promptSha: "x", latencyMs: 1 });
  return { snapshot, content, saved: manifestHash(snapshot) };
}

/** The stored chains (with prevHash) and the verdicts verifyCaseChain would give for intact chains. */
function chainsOf(list: Story[]) {
  const chains = new Map<string, ChainEvent[]>();
  const verdicts = new Map<string, ChainCheck>();
  for (const s of list) {
    const events = s.case.events.map((e, i, all) => ({ ...e, hash: e.hash!, prevHash: i === 0 ? GENESIS : all[i - 1].hash! }));
    chains.set(s.id, events);
    verdicts.set(s.id, { ok: true, headHash: events[events.length - 1].hash, length: events.length });
  }
  return { chains, verdicts };
}

function check(snapshot: unknown, content: unknown, saved: string, list: Story[], adjust?: (v: Map<string, ChainCheck>) => void) {
  const { chains, verdicts } = chainsOf(list);
  adjust?.(verdicts);
  return checkEvidence(readStoredReport({ snapshot, content }), saved, chains, verdicts);
}

describe("the four checks (domain §8)", () => {
  it("all green: one row per cited case, every link joins up, the head is the last record, 'All records match.'", () => {
    const list = stories();
    const { snapshot, content, saved } = build(list);
    const c = check(snapshot, content, saved, list);
    expect(c.allOk).toBe(true);
    expect(c.line).toBe("All records match.");
    expect(c.fingerprint).toEqual({ saved, now: saved, ok: true });
    expect(c.sentences.ok).toBe(true);
    expect(c.rows.map((r) => r.ref)).toEqual(["BAR-0001", "BAR-0002", "BAR-0003"]);
    for (const r of c.rows) {
      expect(r).toMatchObject({ unchanged: true, intact: { ok: true, brokenAtSeq: null }, matches: { ok: true, headFound: true }, laterUpdates: 0 });
      expect(r.chain.every((l) => l.state === "ok" && !l.after)).toBe(true);
      expect(r.chain.map((l) => l.head)).toEqual(r.chain.map((_, i) => i === r.chain.length - 1));
    }
    expect(c.intact).toMatchObject({ ok: true, cases: 3, broken: [] });
    expect(c.intact.records).toBe(list.reduce((n, s) => n + s.events.length, 0));
    expect(c.later).toEqual({ updates: 0, refs: [] });
  });

  it("records written after the report are information, not a problem", () => {
    const list = stories();
    const { snapshot, content, saved } = build(list);
    list[2].assign(30);
    const c = check(snapshot, content, saved, list);
    expect(c.allOk).toBe(true);
    expect(c.line).toBe("All records match (1 update since this report).");
    expect(c.later).toEqual({ updates: 1, refs: ["BAR-0003"] });
    const row = c.rows.find((r) => r.ref === "BAR-0003")!;
    expect(row.laterUpdates).toBe(1);
    expect(row.chain.map((l) => [l.head, l.after])).toEqual([...row.chain.slice(0, -2).map(() => [false, false]), [true, false], [false, true]]);
  });

  it("an inflated snapshot (the demo's jsonb_set) turns check 1 red, and the recount fails too", () => {
    const list = stories();
    const { snapshot, content, saved } = build(list);
    const tampered = structuredClone(snapshot) as ReportSnapshot;
    const outcome = tampered.facts.find((f) => f.id === "F_OUTCOME")!;
    outcome.values.verified = Number(outcome.values.verified) + 5;
    const c = check(tampered, content, saved, list);
    expect(c.fingerprint.ok).toBe(false);
    expect(c.unchanged).toBe(false);
    expect(c.allOk).toBe(false);
    expect(c.rows.every((r) => !r.unchanged)).toBe(true);
    expect(c.intact.ok).toBe(true); // the case histories themselves are fine
    expect(c.matches.facts.mismatched).toEqual(["F_OUTCOME"]);
    expect(c.rows.every((r) => r.matches.factsDiffer && !r.matches.ok)).toBe(true);
    expect(c.line).toBe(
      "Problems found: the report was changed after it was generated (its fingerprint no longer matches); 1 of the report's counts doesn't match a recount of the records.",
    );
    expect(c.line).not.toMatch(/all records match/i);
  });

  it("a changed sentence with the snapshot untouched still fails check 1", () => {
    const list = stories();
    const { snapshot, content, saved } = build(list);
    const edited = structuredClone(content) as ReportContent;
    for (const s of edited.sections) for (const b of s.blocks) if (b.kind === "claim" && b.sentence.id === "C:F_TOTAL") b.sentence.text = b.sentence.text.replace("3", "30");
    const c = check(snapshot, edited, saved, list);
    expect(c.fingerprint.ok).toBe(true);
    expect(c.sentences).toEqual({ ok: false, failed: ["C:F_TOTAL"] });
    expect(c.unchanged).toBe(false);
    expect(c.line).toBe("Problems found: the report's sentences were changed after it was generated.");
  });

  it("a broken history (verifyCaseChain) turns that row's check 2 red and the drawing breaks at the same record", () => {
    const list = stories();
    const { snapshot, content, saved } = build(list);
    const c = check(snapshot, content, saved, list, (v) => v.set(caseId(2), { ok: false, headHash: "x", length: 2, brokenAtSeq: 3 }));
    const row = c.rows.find((r) => r.ref === "BAR-0002")!;
    expect(row.intact).toMatchObject({ ok: false, brokenAtSeq: 3, length: list[1].events.length, broken: { word: "Internal record" } }); // seq 3 is the redaction approval: staff-internal
    expect(row.chain.map((l) => l.state)).toEqual(row.chain.map((l) => (l.seq < 3 ? "ok" : l.seq === 3 ? "broken" : "unchecked")));
    expect(c.intact).toMatchObject({ ok: false, broken: ["BAR-0002"] });
    expect(c.unchanged).toBe(true);
    expect(c.line).toBe("Problems found: 1 case history has a broken link (BAR-0002).");
  });

  it("a cited case with no history left, or a head that is gone, fails checks 2 and 3", () => {
    const list = stories();
    const { snapshot, content, saved } = build(list);
    const { chains, verdicts } = chainsOf(list);
    chains.delete(caseId(3));
    verdicts.set(caseId(3), { ok: true, headHash: GENESIS, length: 0 }); // what verifyCaseChain says for no rows
    const c = checkEvidence(readStoredReport({ snapshot, content }), saved, chains, verdicts);
    const row = c.rows.find((r) => r.ref === "BAR-0003")!;
    expect(row.intact.ok).toBe(false);
    expect(row.matches).toMatchObject({ ok: false, headFound: false });
    expect(c.line).toBe(
      "Problems found: 1 case history has a broken link (BAR-0003); the report doesn't match the records for BAR-0003; 4 of the report's counts don't match a recount of the records.",
    );
  });

  it("a snapshot that can't be read fails every check and lists no rows", () => {
    const list = stories();
    const { content, saved } = build(list);
    const c = check({ cases: "gone" }, content, saved, list);
    expect(c).toMatchObject({ readable: false, allOk: false, unchanged: false, rows: [] });
    expect(c.line).toBe("Problems found: the report was changed after it was generated (its fingerprint no longer matches); its frozen records can't be read.");
  });
});

describe("words", () => {
  it("names records in plain words, and never says what staff did inside a case", () => {
    expect(["submitted", "triaged", "fix_logged", "retest_verdict"].map(eventWord)).toEqual(["Received", "Triaged", "Fix logged", "Reporter answered"]);
    for (const t of ["private_revealed", "note_added", "redaction_proposed", "redaction_approved", "anything_new"]) expect(eventWord(t)).toBe("Internal record");
  });
  it("lists refs briefly", () => {
    expect(refList([])).toBe("");
    expect(refList(["BAR-0001"])).toBe("BAR-0001");
    expect(refList(["BAR-0001", "BAR-0002"])).toBe("BAR-0001 and BAR-0002");
    expect(refList(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });
});

describe("the page's parts, rendered", () => {
  const list = stories();
  const { snapshot, content, saved } = build(list);
  const tampered = structuredClone(snapshot) as ReportSnapshot;
  tampered.facts.find((f) => f.id === "F_OUTCOME")!.values.verified = 9;

  it("the Records table: one row per cited case, a column per check, every mark with its words, the drawing hidden", () => {
    const c = check(snapshot, content, saved, list, (v) => v.set(caseId(2), { ok: false, headHash: "x", length: 2, brokenAtSeq: 3 }));
    const html = renderToStaticMarkup(createElement(EvidenceRecords, { check: c }));
    expect(html).toContain("<caption");
    expect(html.match(/<caption[^>]*>.*?<\/caption>/)![0].replace(/<[^>]+>/g, "")).toBe("Records");
    expect(html.match(/<th scope="col"/g)).toHaveLength(6);
    for (const h of ["Case", "Report unchanged", "Records intact", "Report matches records", "Later updates", "Signed at sign-off"]) expect(html).toContain(`>${h}</th>`);
    expect(html.split("Not signed yet").length - 1).toBe(3); // a draft: every row says so in words
    const rows = html.match(/<tbody[\s\S]*<\/tbody>/)![0].match(/<tr[\s>]/g);
    expect(rows).toHaveLength(3);
    for (const r of ["BAR-0001", "BAR-0002", "BAR-0003"]) expect(html.split(r).length - 1).toBe(1); // each ref in exactly one row
    expect(html).toContain("Intact (");
    expect(html).toContain("Broken at record 3 of ");
    expect(html).toContain("or one just before it, was changed or removed after it was written");
    expect(html.match(/<ol aria-hidden="true" class="al-chain/g)).toHaveLength(6); // per row: the phone copy (with the case) and the wide one
    expect(html).toContain("Broken here");
    expect(html).not.toMatch(/role="status"|<output/);
  });

  it("the verdict and the checks say what failed, in words", () => {
    const c = check(tampered, content, saved, list);
    const verdict = renderToStaticMarkup(createElement(EvidenceVerdict, { check: c, checkedAt: NOW }));
    const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
    expect(text(verdict)).toContain(c.line); // the headline and its detail read as the one status line
    expect(c.line).toMatch(/^Problems found: the report was changed after it was generated/);
    expect(verdict).not.toMatch(/role="status"/);
    const checks = renderToStaticMarkup(createElement(EvidenceChecks, { check: c }));
    expect(checks).toContain("Report unchanged");
    expect(checks).toContain("Failed");
    expect(checks).toContain("The two fingerprints are different.");
    expect(checks).toContain(`Fingerprint saved when the report was built: ${saved}`);
    const ok = renderToStaticMarkup(createElement(EvidenceChecks, { check: check(snapshot, content, saved, list) }));
    expect(ok).toContain("The two fingerprints are the same.");
    expect(ok).not.toContain("Failed");
  });
});
