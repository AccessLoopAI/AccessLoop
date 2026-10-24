// /verify's fifth check, "Signed by AccessLoop at sign-off" (docs/domain.md §8), pure: lib/report/signed-check.ts over
// a report built from synthetic chains (tests/support/report-story.ts) and signed with the local derived key. A draft
// is "not signed yet" and never fails the page; a signed row passes only when its root, its signature and every sealed
// history hold; each kind of change gives its own plain reason; the status line, the check list and the "Records"
// column say so in words. The seeded-PGlite version with real tampering is tests/signed-verify.seed.test.ts.
import { generateKeyPairSync } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChainCheck } from "@/lib/case-events";
import { zonedNoon } from "@/lib/dates";
import { EvidenceChecks, EvidenceRecords } from "@/components/report/EvidenceCheck";
import { compileClaims } from "@/lib/report/claims";
import { buildContent, reportSettings } from "@/lib/report/compose";
import { checkEvidence, readStoredReport, type ChainEvent } from "@/lib/report/evidence";
import {
  checkSigned,
  headsPhrase,
  NOT_SIGNED_YET,
  rowSigned,
  signedClause,
  signedReasons,
  type HeadNow,
  type SignedCheck,
  type SignedRow,
} from "@/lib/report/signed-check";
import { buildSigning } from "@/lib/report/signing";
import { loadReportSigner } from "@/lib/report/signing-key";
import { manifestHash, snapshotFromCases } from "@/lib/report/snapshot";
import type { ReportContent } from "@/lib/report/types";
import { chooseSentences, validationContext } from "@/lib/report/validate";
import { Story, caseId, ref } from "./support/report-story";

const NOW = zonedNoon("2026-10-19");
const YEAR = { start: "2026-01-01", end: "2026-12-31" };
const GENESIS = "0".repeat(64);
const SIGNED_AT = new Date("2026-10-19T16:00:00.000Z");
const OUTSIDE = "99999999-9999-4999-8999-999999999999"; // a case history of the org that the report does not cite

const signer = loadReportSigner({ AUTH_MODE: "local", SESSION_SECRET: "test-session-secret" });
const keys = new Map([[signer.keyId, signer.publicKey]]);

function stories(): Story[] {
  return [
    new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "The app's sign-in button had no label.").assign(1).fixWithRetest(10).verdict(14, "fixed"),
    new Story(caseId(2), ref(2), "2026-03-01T15:00:00Z", { channel: "email", anonymous: false })
      .ack(1, "email").triage(0, "built_environment", "A ramp had no handrail.").assign(1).fixNoRetest(5),
    new Story(caseId(3), ref(3), "2026-04-01T15:00:00Z").triage(0, "ict", "A form timed out."),
  ];
}

const list = stories();
const { snapshot } = snapshotFromCases(list.map((s) => s.case), YEAR, NOW);
const settings = reportSettings(
  {
    name: "Test Org",
    slug: "test-org",
    planAreas: ["built_environment", "ict"],
    feedbackDesignateTitle: "Manager, Accessibility",
    contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
    contactPhone: "1-800-555-0199",
    contactEmail: "access@example.org",
  },
  "http://localhost:3000/o/test-org/report",
);
const claims = compileClaims(snapshot, settings);
const content: ReportContent = buildContent(settings, YEAR, claims, chooseSentences(claims, null, validationContext(snapshot)), {
  ok: true,
  backend: "fake",
  model: "fake",
  promptSha: "x",
  latencyMs: 1,
});
const saved = manifestHash(snapshot);
const areaText = { ict: "We fixed the site.", built_environment: "We fixed the ramp." };
const consultationsText = "We met our advisory group twice.";
const heads = [
  ...list.map((s) => ({ caseId: s.id, seq: s.events.length, hash: s.events[s.events.length - 1].hash! })),
  { caseId: OUTSIDE, seq: 3, hash: "e".repeat(64) },
];
const signing = buildSigning({ reportId: "11111111-1111-4111-8111-111111111111", signedAt: SIGNED_AT, heads, manifestHash: saved, areaText, consultationsText, content, signer });

const row: SignedRow = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "signed_off",
  signedOffAt: SIGNED_AT,
  manifestHash: saved,
  snapshot,
  content: { ...content, signing },
  areaText,
  consultationsText,
};
const allThere = (): Map<string, HeadNow> => new Map(heads.map((h) => [h.caseId, { found: true, intact: true }]));
const refsById = new Map(snapshot.cases.map((c) => [c.id, c.ref]));
const signed = (over: Partial<SignedRow> = {}, headsNow = allThere(), k: ReadonlyMap<string, import("node:crypto").KeyObject> = keys) =>
  checkSigned({ row: { ...row, ...over }, keys: k, headsNow, refsById });

function evidence(s: SignedCheck) {
  const chains = new Map<string, ChainEvent[]>();
  const verdicts = new Map<string, ChainCheck>();
  for (const st of list) {
    const events = st.case.events.map((e, i, all) => ({ ...e, hash: e.hash!, prevHash: i === 0 ? GENESIS : all[i - 1].hash! }));
    chains.set(st.id, events);
    verdicts.set(st.id, { ok: true, headHash: events[events.length - 1].hash, length: events.length });
  }
  return checkEvidence(readStoredReport({ snapshot, content: { ...content, signing } }), saved, chains, verdicts, s);
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'").replace(/\s+/g, " ");

describe("checkSigned", () => {
  it("a draft is not signed yet, and never fails the page", () => {
    const c = signed({ status: "draft" });
    expect(c).toMatchObject({ state: "draft", ok: false, keysAvailable: true });
    expect(signedReasons(c)).toEqual([]);
    expect(signedClause(c)).toBeNull();
    expect(rowSigned(c, caseId(1))).toBe("draft");
    const e = evidence(c);
    expect(e.allOk).toBe(true);
    expect(e.line).toBe("All records match.");
    expect(evidence(NOT_SIGNED_YET).allOk).toBe(true); // checkEvidence's default
  });

  it("a signed row whose root, signature and every sealed history hold passes", () => {
    const c = signed();
    expect(c).toMatchObject({ state: "checked", ok: true, keyId: signer.keyId, root: signing.root, signedAt: SIGNED_AT.toISOString(), heads: { total: 4, changed: [] } });
    expect(c.signature).toMatchObject({ ok: true, recomputedRoot: signing.root });
    for (const s of list) expect(rowSigned(c, s.id)).toBe("ok");
    expect(rowSigned(c, "not-sealed")).toBe("absent");
    const e = evidence(c);
    expect(e.allOk).toBe(true);
    expect(e.rows.map((r) => r.signed)).toEqual(["ok", "ok", "ok"]);
  });

  it("signed off without a signature: its own reason", () => {
    const { signing: _drop, ...bare } = row.content as ReportContent;
    void _drop;
    const c = signed({ content: bare });
    expect(c.state).toBe("unsigned");
    expect(signedClause(c)).toBe("it was signed off without AccessLoop's signature, so it can't be checked against what was signed");
    expect(rowSigned(c, caseId(1))).toBe("report");
    expect(evidence(c).allOk).toBe(false);
  });

  it("each stored part changed gives its own reason; the signature itself still checks", () => {
    const lead = signed({ consultationsText: "We met every month." });
    expect(signedReasons(lead)).toEqual(["the lead's own text changed"]);
    expect(lead.signature).toMatchObject({ signatureOk: true, rootOk: false });
    const sentences = structuredClone(row.content) as ReportContent;
    const b = sentences.sections.find((s) => s.key === "feedback")!.blocks.find((x) => x.kind === "claim")!;
    if (b.kind === "claim") b.sentence.text += " More were fixed.";
    expect(signedReasons(signed({ content: sentences }))).toEqual(["its sentences changed"]);
    const inflated = structuredClone(snapshot);
    inflated.facts.find((f) => f.id === "F_OUTCOME")!.values.verified = 9;
    expect(signedReasons(signed({ snapshot: inflated }))).toEqual(["its frozen records changed"]);
    expect(signedReasons(signed({ manifestHash: "d".repeat(64) }))).toEqual(["its frozen records changed"]);
    expect(signedReasons(signed({ signedOffAt: new Date("2026-10-20T16:00:00.000Z") }))).toEqual(["its sign-off date changed"]);
    expect(signedClause(lead)).toBe("it no longer matches what AccessLoop signed at sign-off (the lead's own text changed)");
    const e = evidence(lead);
    expect(e.allOk).toBe(false);
    expect(e.line).toBe("Problems found: it no longer matches what AccessLoop signed at sign-off (the lead's own text changed).");
    expect(e.rows.map((r) => r.signed)).toEqual(["report", "report", "report"]);
  });

  it("a sealed history that lost its signed record or broke before it: named when the report cites it, counted otherwise", () => {
    const now = allThere();
    now.set(caseId(2), { found: false, intact: true });
    now.set(OUTSIDE, { found: true, intact: false });
    const c = signed({}, now);
    expect(c.ok).toBe(false);
    expect(c.signature?.ok).toBe(true);
    expect(c.heads.changed.map((h) => [h.ref, h.found, h.intact])).toEqual([
      ["BAR-0002", false, true],
      [null, true, false],
    ]);
    expect(signedReasons(c)).toEqual(["2 case histories changed after sign-off (BAR-0002 and 1 other)"]);
    expect([rowSigned(c, caseId(1)), rowSigned(c, caseId(2))]).toEqual(["ok", "history"]);
    const missing = allThere();
    missing.delete(OUTSIDE); // no answer for a sealed history = it is gone
    expect(signedReasons(signed({}, missing))).toEqual(["1 case history changed after sign-off"]);
  });

  it("a cited case whose history the signature did not seal fails too, as offline (a sign-off seals every history)", () => {
    const fewer = heads.filter((h) => h.caseId !== caseId(2));
    const other = buildSigning({ reportId: row.id, signedAt: SIGNED_AT, heads: fewer, manifestHash: saved, areaText, consultationsText, content, signer });
    const cited = list.map((s) => s.id);
    const c = checkSigned({ row: { ...row, content: { ...content, signing: other } }, keys, headsNow: allThere(), refsById, citedIds: cited });
    expect(c.signature?.ok).toBe(true); // the signature over those heads holds...
    expect(c.heads.unsealed).toEqual(["BAR-0002"]); // ...but they leave out a case the report cites
    expect(c.ok).toBe(false);
    expect(signedReasons(c)).toEqual(["1 cited case was not sealed at sign-off (BAR-0002)"]);
    expect([rowSigned(c, caseId(1)), rowSigned(c, caseId(2))]).toEqual(["ok", "absent"]);
    const e = evidence(c);
    expect(e.allOk).toBe(false);
    expect(e.line).toBe("Problems found: it no longer matches what AccessLoop signed at sign-off (1 cited case was not sealed at sign-off (BAR-0002)).");
    // A real sign-off seals every cited case.
    expect(checkSigned({ row, keys, headsNow: allThere(), refsById, citedIds: cited })).toMatchObject({ ok: true, heads: { unsealed: [] } });
  });

  it("an unknown key, no key at all, or a forged signature", () => {
    const other = generateKeyPairSync("ed25519").publicKey;
    expect(signedReasons(signed({}, allThere(), new Map([["ed25519-0000000000000000", other]])))).toEqual(["it was signed with a key AccessLoop doesn't publish"]);
    expect(signedReasons(signed({}, allThere(), new Map([[signer.keyId, other]])))).toEqual(["it was signed with a key AccessLoop doesn't publish"]);
    expect(signedReasons(signed({}, allThere(), new Map()))).toEqual(["this server has no signing key to check the signature with"]);
    const forged = { ...(row.content as ReportContent), signing: { ...signing, signature: Buffer.alloc(64, 1).toString("base64") } };
    expect(signedReasons(signed({ content: forged }))).toEqual(["the signature doesn't match the signed fingerprint"]);
    const reRooted = { ...(row.content as ReportContent), signing: { ...signing, root: "f".repeat(64) } };
    expect(signedReasons(signed({ content: reRooted }))).toEqual(["the signature doesn't match the signed fingerprint", "the signed values were changed"]);
  });

  it("headsPhrase names at most three refs", () => {
    const h = (r: string | null) => ({ caseId: r ?? "x", ref: r, seq: 1, found: false, intact: true, ok: false });
    expect(headsPhrase([h("BAR-0001")])).toBe("BAR-0001");
    expect(headsPhrase([h("BAR-0001"), h("BAR-0002")])).toBe("BAR-0001 and BAR-0002");
    expect(headsPhrase([h("BAR-0001"), h("BAR-0002"), h("BAR-0003"), h("BAR-0004"), h(null)])).toBe("BAR-0001, BAR-0002, BAR-0003 and 2 others");
    expect(headsPhrase([h(null), h(null)])).toBe("");
  });
});

describe("rendered: the fifth check and its column", () => {
  it("a draft says 'Not signed yet' in words, with what will be sealed", () => {
    const html = renderToStaticMarkup(createElement(EvidenceChecks, { check: evidence(signed({ status: "draft" })) }));
    expect(text(html)).toContain("Signed by AccessLoop at sign-off : Not signed yet");
    expect(text(html)).toContain("A draft is not signed.");
    expect(html.match(/<li /g)).toHaveLength(5);
  });

  it("passed: the signed fingerprint next to the one computed now, and the published keys", () => {
    const html = renderToStaticMarkup(createElement(EvidenceChecks, { check: evidence(signed()) }));
    expect(text(html)).toContain("Signed by AccessLoop at sign-off : Passed");
    expect(text(html)).toContain("the latest record of all 4 case histories of the organization");
    expect(text(html)).toContain(`Signed fingerprint: ${signing.root}`);
    expect(text(html)).toContain("The two signed fingerprints are the same.");
    expect(html).toContain('href="/.well-known/accessloop-signing-keys.json"');
  });

  it("failed: what changed, in words, and the two fingerprints differ; the column says it per case", () => {
    const now = allThere();
    now.set(caseId(3), { found: false, intact: true });
    const c = evidence(signed({ consultationsText: "Changed." }, now));
    const html = renderToStaticMarkup(createElement(EvidenceChecks, { check: c }));
    expect(text(html)).toContain("Signed by AccessLoop at sign-off : Failed");
    expect(text(html)).toContain(
      "This report no longer matches what AccessLoop signed at sign-off: the lead's own text changed; 1 case history changed after sign-off (BAR-0003).",
    );
    expect(text(html)).toContain("The two signed fingerprints are different.");
    const table = renderToStaticMarkup(createElement(EvidenceRecords, { check: c }));
    expect(table).toContain(">Signed at sign-off</th>");
    expect(text(table).match(/Signature fails/g)).toHaveLength(3);
    const ok = renderToStaticMarkup(createElement(EvidenceRecords, { check: evidence(signed({}, now)) }));
    expect(text(ok).match(/Changed after signing/g)).toHaveLength(1);
    expect(text(ok).match(/ Signed (?!at sign-off)/g)).toHaveLength(2); // the column header aside
  });
});
