// The offline checker tools/verify-bundle.mjs (docs/domain.md §8; docs/archive/phase7-prompt.md T5 item 4), pure: a bundle
// built by lib/report/bundle.ts from synthetic chains and signed with the local derived key passes all five checks;
// its canonicalJson is the frozen one; keys come from the published list (SPKI or JWK); each kind of damage to the
// file fails the right check; an unknown kind of fact is listed, never failed; a submission closed as not
// accessibility feedback (decision D6) and a case reopened after its fix was confirmed (D4) recount like the report
// counts them; the command line's exit codes. The
// same checker on a real seeded database, tampered the way a database owner could, is tests/signed-verify.seed.test.ts.
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { canonicalJson as frozenCanonicalJson } from "@/lib/case-events";
import { zonedNoon } from "@/lib/dates";
import { buildEvidenceBundle, type EvidenceBundle } from "@/lib/report/bundle";
import { compileClaims } from "@/lib/report/claims";
import { buildContent, reportSettings } from "@/lib/report/compose";
import type { ChainEvent } from "@/lib/report/evidence";
import { buildSigning } from "@/lib/report/signing";
import { loadReportSigner, publishedKey } from "@/lib/report/signing-key";
import { snapshotFromCases, manifestHash } from "@/lib/report/snapshot";
import { chooseSentences, validationContext } from "@/lib/report/validate";
import { canonicalJson, formatResult, main, readKeys, verifyBundle, type VerifyResult } from "@/tools/verify-bundle.mjs";
import { Story, caseId, ref } from "./support/report-story";

const NOW = zonedNoon("2026-10-19");
const YEAR = { start: "2026-01-01", end: "2026-12-31" };
const GENESIS = "0".repeat(64);
const SIGNED_AT = new Date("2026-10-19T16:00:00.000Z");
const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const signer = loadReportSigner({ AUTH_MODE: "local", SESSION_SECRET: "test-session-secret" });
const keyList = { issuer: "AccessLoop", keys: [publishedKey(signer)] };
const keys = readKeys(keyList);

function stories(extra: Story[] = []): Story[] {
  const list = [
    new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "The app's sign-in button had no label.").assign(1).fixWithRetest(10).verdict(14, "fixed"),
    new Story(caseId(2), ref(2), "2026-03-01T15:00:00Z", { channel: "email", anonymous: false })
      .ack(1, "email").triage(0, "built_environment", "A ramp had no handrail.").assign(1).fixNoRetest(5),
    new Story(caseId(3), ref(3), "2026-04-01T15:00:00Z").triage(0, "ict", "A form timed out."),
    new Story(caseId(4), ref(4), "2026-05-01T15:00:00Z").triage(0, "built_environment", "The door was too heavy.").assign(1).fixWithRetest(3).verdict(30, "fixed"),
    ...extra,
  ];
  // Real-looking fingerprints (the story's stand-ins are not hex): what the bundle's links are checked against.
  for (const s of list) for (const e of s.events) e.hash = sha(`${s.id}:${e.seq}`);
  return list;
}

/** A signed, published report's evidence bundle, as a third party reads the downloaded file. */
function makeBundle(extra: Story[] = []): EvidenceBundle {
  const list = stories(extra);
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
  const content = buildContent(settings, YEAR, claims, chooseSentences(claims, null, validationContext(snapshot)), {
    ok: true,
    backend: "fake",
    model: "fake",
    promptSha: "x",
    latencyMs: 1,
  });
  const chains = new Map<string, ChainEvent[]>();
  for (const s of list) chains.set(s.id, s.case.events.map((e, i, all) => ({ ...e, hash: e.hash!, prevHash: i === 0 ? GENESIS : all[i - 1].hash! })));
  const areaText = { ict: "We fixed the site.", built_environment: "We fixed the ramp." };
  const consultationsText = "We met our advisory group twice.";
  const saved = manifestHash(snapshot);
  const signing = buildSigning({
    reportId: REPORT_ID,
    signedAt: SIGNED_AT,
    heads: [...list.map((s) => ({ caseId: s.id, seq: s.events.length, hash: s.events[s.events.length - 1].hash! })), { caseId: "outside", seq: 2, hash: "e".repeat(64) }],
    manifestHash: saved,
    areaText,
    consultationsText,
    content,
    signer,
  });
  const b = buildEvidenceBundle({
    org: { name: "Test Org", slug: "test-org" },
    report: {
      id: REPORT_ID,
      title: "Accessibility progress report 2026, version 1",
      periodStart: YEAR.start,
      periodEnd: YEAR.end,
      signedOffAt: SIGNED_AT,
      publishedAt: SIGNED_AT,
      manifestHash: saved,
      snapshot,
      content: { ...content, signing },
      areaText,
      consultationsText,
    },
    chains,
    now: NOW,
    links: { report: "", verify: "", signingKeys: "", verifier: "" },
  });
  return JSON.parse(JSON.stringify(b)) as EvidenceBundle;
}

const statuses = (r: VerifyResult) => Object.fromEntries(r.checks.map((c) => [c.id, c.status]));
const details = (r: VerifyResult, id: string) => r.checks.find((c) => c.id === id)?.details.join(" | ") ?? "";

describe("verifyBundle", () => {
  it("a signed, published report's bundle passes all five checks", () => {
    const r = verifyBundle(makeBundle(), { keys });
    expect(statuses(r)).toEqual({ fingerprint: "pass", root: "pass", signature: "pass", histories: "pass", numbers: "pass" });
    expect(r).toMatchObject({ ok: true, complete: true, report: { id: REPORT_ID, org: "Test Org", keyId: signer.keyId } });
    expect(r.checks.find((c) => c.id === "root")?.summary).toContain("(5 case histories sealed)");
    expect(r.checks.find((c) => c.id === "histories")?.summary).toMatch(/^4 histories, \d+ records: every link joins/);
    expect(formatResult(r).trim().endsWith("All checks passed.")).toBe(true);
  });

  it("uses the frozen canonicalJson: sorted keys, no whitespace, undefined dropped", () => {
    const v = { b: [1, { z: null, a: "é\"" }], a: undefined, c: { y: 2.5, x: true } };
    expect(canonicalJson(v)).toBe(frozenCanonicalJson(v));
    const b = makeBundle();
    expect(canonicalJson(b.report.snapshot)).toBe(frozenCanonicalJson(b.report.snapshot));
  });

  it("keys: the published list (SPKI) or a JWK; other key types are skipped; a key under another key's ID fails", () => {
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ keyId: signer.keyId, keyIdMatches: true });
    const jwkOnly = readKeys([{ keyId: signer.keyId, jwk: publishedKey(signer).jwk }]);
    expect(verifyBundle(makeBundle(), { keys: jwkOnly }).ok).toBe(true);
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(readKeys({ keys: [{ keyId: "x", publicKey: rsa }, { keyId: "y", publicKey: "not a key" }] })).toEqual([]);
    const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const impostor = verifyBundle(makeBundle(), { keys: readKeys({ keys: [{ keyId: signer.keyId, publicKey: other }] }) });
    expect(statuses(impostor).signature).toBe("fail");
    expect(impostor.checks.find((c) => c.id === "signature")?.summary).toContain("does not have that key ID");
    const unknown = verifyBundle(makeBundle(), { keys: readKeys({ keys: [{ publicKey: other }] }) });
    expect(unknown.checks.find((c) => c.id === "signature")?.summary).toContain("which is not among the keys you gave");
    const none = verifyBundle(makeBundle());
    expect(none).toMatchObject({ ok: false, complete: false });
    expect(statuses(none).signature).toBe("skipped");
  });

  it("the signed part changed fails the root, with which part", () => {
    const b = makeBundle();
    (b.report.areaText as Record<string, string>).ict = "We rebuilt the whole site.";
    expect(details(verifyBundle(b, { keys }), "root")).toContain("the lead's own text");
    const c = makeBundle();
    c.report.signedOffAt = "2026-10-20T16:00:00.000Z";
    expect(details(verifyBundle(c, { keys }), "root")).toContain("the sign-off time is not the one that was signed");
    const d = makeBundle();
    d.signature!.heads = d.signature!.heads.slice(1);
    const rd = verifyBundle(d, { keys });
    expect(statuses(rd).root).toBe("fail");
    expect(details(rd, "root")).toMatch(/recomputed [0-9a-f]{16}…, signed/);
    const e = makeBundle();
    e.signature = null;
    expect(statuses(verifyBundle(e, { keys }))).toMatchObject({ root: "fail", signature: "skipped" });
  });

  it("a damaged history fails 'Case histories': a gap, a missing cited history, a changed status or summary", () => {
    const gap = makeBundle();
    gap.chains[0].events.splice(2, 1);
    expect(details(verifyBundle(gap, { keys }), "histories")).toContain("BAR-0001: record 3 does not join the record before it");
    const gone = makeBundle();
    gone.chains = gone.chains.slice(1);
    expect(details(verifyBundle(gone, { keys }), "histories")).toContain("1 cited case has no history in the file (BAR-0001)");
    const status = makeBundle();
    const last = status.chains[1].events.at(-1)!;
    last.to = "verified";
    expect(details(verifyBundle(status, { keys }), "histories")).toContain("BAR-0002: replaying its records gives a different status than the report says");
    const summary = makeBundle();
    summary.chains[2].publicSummary = "Something else.";
    expect(details(verifyBundle(summary, { keys }), "histories")).toContain("BAR-0003: the public summary differs from the report's");
  });

  it("report numbers: a recount that differs fails; an unknown kind of fact is listed, never failed", () => {
    const b = makeBundle();
    const snap = b.report.snapshot as { facts: { id: string; kind: string; values: Record<string, number | string>; caseIds: string[] }[] };
    snap.facts.find((f) => f.id === "F_OUTCOME")!.values.unverified = 7;
    snap.facts.push({ id: "F_NEW", kind: "F_NEW", values: { n: 1 }, caseIds: [] });
    b.report.manifestHash = sha(canonicalJson(b.report.snapshot)); // consistent with itself (not with the signature)
    const r = verifyBundle(b, { keys });
    expect(statuses(r)).toMatchObject({ fingerprint: "pass", root: "fail", numbers: "fail" });
    expect(details(r, "numbers")).toContain("F_OUTCOME: the fixes not confirmed does not recount from the report's cases");
    expect(r.notRecounted).toContain("F_NEW (a kind this tool does not know)");
  });

  it("a submission closed as not accessibility feedback is in the case list for its own fact only (D6); a reopened confirmed fix (D4)", () => {
    const extra = () => [
      new Story(caseId(5), ref(5), "2026-06-01T15:00:00Z").close(1, "spam"),
      new Story(caseId(6), ref(6), "2026-06-02T15:00:00Z")
        .triage(0, "ict", "A video had no captions.")
        .assign(1)
        .fixWithRetest(3)
        .verdict(5, "fixed")
        .move(8, "reopened", "assigned", { reason: "The captions are gone again." }),
    ];
    type Snap = { cases: { id: string; ref: string; status: string }[]; facts: { id: string; values: Record<string, unknown>; caseIds: string[] }[] };
    const b = makeBundle(extra());
    const snap = b.report.snapshot as unknown as Snap;
    expect(snap.cases.map((c) => c.ref)).toEqual([ref(1), ref(2), ref(3), ref(4), ref(5), ref(6)]);
    expect(snap.facts.find((f) => f.id === "F_NOT_FEEDBACK")).toMatchObject({ values: { notFeedback: 1 }, caseIds: [caseId(5)] });
    expect(snap.facts.find((f) => f.id === "F_TOTAL")?.values.total).toBe(5);
    expect(snap.cases.find((c) => c.ref === ref(6))?.status).toBe("assigned");
    const r = verifyBundle(b, { keys });
    expect(statuses(r)).toEqual({ fingerprint: "pass", root: "pass", signature: "pass", histories: "pass", numbers: "pass" });
    expect(r.notRecounted).toContain("which submissions were closed as not accessibility feedback");
    expect(b.chains.map((c) => c.ref)).toContain(ref(5)); // cited by its sentence, so its history is in the file

    const open = makeBundle(extra());
    const fact = (open.report.snapshot as unknown as Snap).facts.find((f) => f.id === "F_NOT_FEEDBACK")!;
    fact.caseIds = [caseId(3)]; // an open case "closed as not feedback": it would drop out of every other count
    open.report.manifestHash = sha(canonicalJson(open.report.snapshot));
    const ro = verifyBundle(open, { keys });
    expect(details(ro, "numbers")).toContain("F_NOT_FEEDBACK: the count does not recount from the report's cases");
    expect(details(ro, "numbers")).toContain("F_TOTAL: the total does not recount from the report's cases");
  });

  it("not an evidence bundle: says so, checks nothing", () => {
    expect(verifyBundle({ format: "something-else" })).toMatchObject({ ok: false, unreadable: "This file is not an AccessLoop evidence bundle (version 1)." });
    expect(verifyBundle(null).checks).toEqual([]);
  });
});

describe("the command line (main)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "al-verify-cli-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const sink = () => {
    const chunks: string[] = [];
    return { chunks, write: (t: string) => chunks.push(t) };
  };
  const run = (...argv: string[]) => {
    const out = sink();
    const err = sink();
    return { code: main(argv, out, err), out: out.chunks.join(""), err: err.chunks.join("") };
  };

  it("exit 0 when every check passes, 1 when one fails, 2 when it can't run or finish", () => {
    const file = path.join(dir, "bundle.json");
    const keysFile = path.join(dir, "keys.json");
    writeFileSync(file, `﻿${JSON.stringify(makeBundle(), null, 2)}`); // a byte-order mark from an editor is fine
    writeFileSync(keysFile, JSON.stringify(keyList));
    expect(run(file, "--keys", keysFile)).toMatchObject({ code: 0 });
    expect(run(file, "--public-key", keyList.keys[0].publicKey).code).toBe(0);
    expect(run(file, "--keys", keysFile, "--expect-root", "0".repeat(64)).code).toBe(1);
    expect(run(file).code).toBe(2);
    expect(JSON.parse(run(file, "--keys", keysFile, "--json").out)).toMatchObject({ ok: true });
    expect(run().err).toContain("No evidence bundle given");
    expect(run(file, "--nope").code).toBe(2);
    expect(run(path.join(dir, "missing.json")).err).toContain("Could not read");
    writeFileSync(path.join(dir, "other.json"), "{}");
    expect(run(path.join(dir, "other.json"), "--keys", keysFile)).toMatchObject({ code: 2, out: "This file is not an AccessLoop evidence bundle (version 1).\n" });
    expect(run("--help")).toMatchObject({ code: 0 });
  });
});
