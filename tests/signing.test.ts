// The signed root and the evidence bundle, pure (docs/domain.md §8 "Signed at sign-off"): the signing key (from
// REPORT_SIGNING_KEY, or derived from SESSION_SECRET in AUTH_MODE=local only; errors name the variable, never a value),
// the published key entry, the root's exact formula (a golden value a third party can recompute), the signature, the
// stored-row check (each covered part changes the root), and the bundle's allow-list (no payload text ever leaves).
import { createHash, createPublicKey, generateKeyPairSync, hkdfSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GENESIS_HASH } from "@/lib/case-events";
import { buildEvidenceBundle, bundleFilename, bundleJson, publicEvent } from "@/lib/report/bundle";
import type { ChainEvent } from "@/lib/report/evidence";
import {
  buildSigning,
  checkSignature,
  contentForSigning,
  contentHash,
  groupedHex,
  leadTextHash,
  publicKeyFromSpki,
  readSigning,
  reportRoot,
  rootSignatureValid,
  signRoot,
} from "@/lib/report/signing";
import { deriveLocalSecret } from "@/lib/env";
import { ed25519FromSeed, keyIdOf, loadReportSigner, publishedKey, SigningKeyError } from "@/lib/report/signing-key";
import type { ReportContent, ReportSnapshot } from "@/lib/report/types";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const LOCAL = { AUTH_MODE: "local", SESSION_SECRET: "test-session-secret" };

function ed25519Pkcs8(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

describe("the signing key", () => {
  it("in AUTH_MODE=local without REPORT_SIGNING_KEY: derived from SESSION_SECRET with HKDF-SHA256, the same every time", () => {
    const a = loadReportSigner({ ...LOCAL });
    const b = loadReportSigner({ ...LOCAL });
    expect(a.keyId).toBe(b.keyId);
    expect(a.keyId).toMatch(/^ed25519-[0-9a-f]{16}$/);
    expect(a).toMatchObject({ source: "local-derived", created: null });
    // The seed is exactly HKDF-SHA256(SESSION_SECRET, empty salt, info "REPORT_SIGNING_KEY", 32 bytes): lib/env.ts's
    // shared derivation (deriveLocalSecret(sessionSecret, name)), the one every Phase 7 secret uses.
    const seed = Buffer.from(hkdfSync("sha256", "test-session-secret", Buffer.alloc(0), "REPORT_SIGNING_KEY", 32));
    expect(deriveLocalSecret("test-session-secret", "REPORT_SIGNING_KEY")).toEqual(seed);
    expect(keyIdOf(createPublicKey(ed25519FromSeed(seed)))).toBe(a.keyId);
    // Another secret or another name gives another key.
    expect(loadReportSigner({ ...LOCAL, SESSION_SECRET: "another-secret" }).keyId).not.toBe(a.keyId);
    expect(deriveLocalSecret("test-session-secret", "RETEST_LINK_SECRET")).not.toEqual(seed);
  });

  it("is never derived on Vercel or outside AUTH_MODE=local: sign-off needs REPORT_SIGNING_KEY there", () => {
    for (const env of [{ ...LOCAL, VERCEL: "1" }, { AUTH_MODE: "clerk", SESSION_SECRET: "x" }, { SESSION_SECRET: "x" }]) {
      expect(() => loadReportSigner(env)).toThrow(SigningKeyError);
      expect(() => loadReportSigner(env)).toThrow(/^REPORT_SIGNING_KEY is not set/);
    }
    expect(() => loadReportSigner({ AUTH_MODE: "local" })).toThrow(/^SESSION_SECRET is not set/);
  });

  it("uses a configured PKCS8 Ed25519 key, with its creation date, and refuses anything else without printing it", () => {
    const pkcs8 = ed25519Pkcs8();
    const s = loadReportSigner({ AUTH_MODE: "clerk", REPORT_SIGNING_KEY: pkcs8, REPORT_SIGNING_KEY_CREATED: "2026-10-20" });
    expect(s).toMatchObject({ source: "configured", created: "2026-10-20T00:00:00.000Z" });
    expect(s.keyId).toBe(keyIdOf(s.publicKey));
    // A configured key wins over derivation in local mode too.
    expect(loadReportSigner({ ...LOCAL, REPORT_SIGNING_KEY: pkcs8 }).keyId).toBe(s.keyId);

    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    for (const bad of [ec, "not-a-key", Buffer.from("x".repeat(48)).toString("base64")]) {
      let message = "";
      try {
        loadReportSigner({ AUTH_MODE: "clerk", REPORT_SIGNING_KEY: bad });
      } catch (e) {
        expect(e).toBeInstanceOf(SigningKeyError);
        message = (e as Error).message;
      }
      expect(message).toMatch(/^REPORT_SIGNING_KEY is not an Ed25519 private key/);
      expect(message).not.toContain(bad);
    }
    expect(() => loadReportSigner({ AUTH_MODE: "clerk", REPORT_SIGNING_KEY: pkcs8, REPORT_SIGNING_KEY_CREATED: "soon" })).toThrow(
      /^REPORT_SIGNING_KEY_CREATED is not a date/,
    );
  });

  it("publishes public values only: key ID, algorithm, created, SPKI and JWK of the same key", () => {
    const s = loadReportSigner({ ...LOCAL });
    const k = publishedKey(s);
    expect(k).toMatchObject({ keyId: s.keyId, algorithm: "Ed25519", created: null, source: "local-derived" });
    expect(k.jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", kid: s.keyId, alg: "EdDSA", use: "sig" });
    expect(JSON.stringify(k)).not.toMatch(/"d"|PRIVATE/);
    const fromSpki = publicKeyFromSpki(k.publicKey)!;
    const fromJwk = createPublicKey({ key: k.jwk, format: "jwk" });
    expect(keyIdOf(fromSpki)).toBe(s.keyId);
    expect(keyIdOf(fromJwk)).toBe(s.keyId);
    expect(publicKeyFromSpki("bm90IGEga2V5")).toBeNull();
  });
});

describe("the root and its signature", () => {
  const inputs = {
    reportId: "11111111-1111-4111-8111-111111111111",
    signedAt: "2026-10-19T16:00:00.000Z",
    heads: ["b".repeat(64), "a".repeat(64)],
    manifestHash: "c".repeat(64),
    leadTextHash: "d".repeat(64),
    contentHash: "e".repeat(64),
  };

  it("is sha256 of the canonical JSON statement, heads sorted: a value anyone can recompute", () => {
    const statement =
      `{"contentHash":"${"e".repeat(64)}","heads":["${"a".repeat(64)}","${"b".repeat(64)}"],"kind":"accessloop.report-root",` +
      `"leadTextHash":"${"d".repeat(64)}","manifestHash":"${"c".repeat(64)}","reportId":"${inputs.reportId}","signedAt":"${inputs.signedAt}","version":1}`;
    expect(reportRoot(inputs)).toBe(sha(statement));
    expect(reportRoot({ ...inputs, heads: [...inputs.heads].reverse() })).toBe(reportRoot(inputs));
    for (const change of [
      { reportId: "22222222-2222-4222-8222-222222222222" },
      { signedAt: "2026-10-19T16:00:00.001Z" },
      { heads: ["a".repeat(64)] },
      { heads: [...inputs.heads, "f".repeat(64)] },
      { manifestHash: "0".repeat(64) },
      { leadTextHash: "0".repeat(64) },
      { contentHash: "0".repeat(64) },
    ]) {
      expect(reportRoot({ ...inputs, ...change })).not.toBe(reportRoot(inputs));
    }
  });

  it("covers the lead's text and the content (without its own signing key), key order aside", () => {
    expect(leadTextHash({ ict: "A", built_environment: "B" }, "C")).toBe(leadTextHash({ built_environment: "B", ict: "A" }, "C"));
    expect(leadTextHash({ ict: "A" }, "C")).toBe(sha('{"areaText":{"ict":"A"},"consultationsText":"C"}'));
    expect(leadTextHash({}, null)).toBe(leadTextHash(undefined, undefined));
    expect(leadTextHash({ ict: "A" }, null)).not.toBe(leadTextHash({ ict: "A." }, null));
    expect(leadTextHash({}, null)).not.toBe(leadTextHash({}, ""));
    const content = { version: 1, sections: [{ key: "feedback" }] };
    expect(contentForSigning({ ...content, signing: { root: "x" } })).toEqual(content);
    expect(contentHash({ ...content, signing: { root: "x" } })).toBe(contentHash(content));
    expect(contentHash({ ...content, version: 2 })).not.toBe(contentHash(content));
  });

  it("is signed with Ed25519 over the root's 64 ASCII characters", () => {
    const s = loadReportSigner({ ...LOCAL });
    const root = reportRoot(inputs);
    const sig = signRoot(root, s.privateKey);
    expect(verify(null, Buffer.from(root, "ascii"), s.publicKey, Buffer.from(sig, "base64"))).toBe(true);
    expect(rootSignatureValid(root, sig, s.publicKey)).toBe(true);
    expect(rootSignatureValid(reportRoot({ ...inputs, contentHash: "0".repeat(64) }), sig, s.publicKey)).toBe(false);
    expect(rootSignatureValid(root, "AAAA", s.publicKey)).toBe(false);
    const other = generateKeyPairSync("ed25519").publicKey;
    expect(rootSignatureValid(root, sig, other)).toBe(false);
    expect(groupedHex("0123456789abcdef")).toBe("0123 4567 89ab cdef");
  });
});

describe("checkSignature over a stored row", () => {
  const signer = loadReportSigner({ ...LOCAL });
  const keys = new Map([[signer.keyId, signer.publicKey]]);
  const signedOffAt = new Date("2026-10-19T16:00:00.000Z");
  const content = { version: 1, settings: { planAreas: ["ict"] }, sections: [{ key: "feedback", heading: "Feedback", blocks: [{ kind: "claim", sentence: { id: "C:F_TOTAL", text: "We received 16." } }] }] };
  const base = { id: "11111111-1111-4111-8111-111111111111", signedOffAt, manifestHash: "c".repeat(64), areaText: { ict: "We fixed the site." }, consultationsText: "We met twice." };
  const signing = buildSigning({
    reportId: base.id,
    signedAt: signedOffAt,
    heads: [
      { caseId: "case-b", seq: 4, hash: "b".repeat(64) },
      { caseId: "case-a", seq: 7, hash: "a".repeat(64) },
    ],
    manifestHash: base.manifestHash,
    areaText: base.areaText,
    consultationsText: base.consultationsText,
    content,
    signer,
  });
  const row = { ...base, content: { ...content, signing } };

  it("passes for the row as signed; the heads are stored sorted by hash", () => {
    expect(signing.heads.map((h) => h.caseId)).toEqual(["case-a", "case-b"]);
    expect(signing).toMatchObject({ version: 1, alg: "Ed25519", keyId: signer.keyId, signedAt: signedOffAt.toISOString() });
    expect(readSigning(row.content)).toEqual(signing);
    expect(checkSignature(row, keys)).toEqual({
      present: true,
      keyKnown: true,
      rootOk: true,
      recomputedRoot: signing.root,
      signatureOk: true,
      parts: { manifest: true, leadText: true, content: true, signedAt: true },
      ok: true,
    });
  });

  it("turns red when the lead's text, a sentence, the fingerprint or the sign-off time changes", () => {
    const changed = (r: typeof row) => checkSignature(r, keys);
    const lead = changed({ ...row, areaText: { ict: "We fixed everything." } });
    expect(lead).toMatchObject({ ok: false, rootOk: false, signatureOk: true, parts: { leadText: false, content: true } });
    expect(changed({ ...row, consultationsText: "We met once." })).toMatchObject({ ok: false, parts: { leadText: false } });
    const sentence = structuredClone(row);
    (sentence.content.sections[0].blocks[0] as { sentence: { text: string } }).sentence.text = "We received 61.";
    expect(changed(sentence)).toMatchObject({ ok: false, rootOk: false, parts: { content: false } });
    expect(changed({ ...row, manifestHash: "0".repeat(64) })).toMatchObject({ ok: false, parts: { manifest: false } });
    expect(changed({ ...row, signedOffAt: new Date(signedOffAt.getTime() + 1000) })).toMatchObject({ ok: false, parts: { signedAt: false } });
  });

  it("an unknown key, a forged signature or no signature at all never passes", () => {
    expect(checkSignature(row, new Map())).toMatchObject({ present: true, keyKnown: false, signatureOk: false, ok: false });
    const forged = { ...row, content: { ...content, signing: { ...signing, signature: signRoot(signing.root, generateKeyPairSync("ed25519").privateKey) } } };
    expect(checkSignature(forged, keys)).toMatchObject({ rootOk: true, signatureOk: false, ok: false });
    // A re-signed root over changed text needs the private key: a rewritten root with the old signature fails.
    const rewritten = { ...row, areaText: { ict: "Changed." }, content: { ...content, signing: { ...signing, root: "f".repeat(64) } } };
    expect(checkSignature(rewritten, keys)).toMatchObject({ rootOk: false, signatureOk: false, ok: false });
    expect(checkSignature({ ...row, content }, keys)).toMatchObject({ present: false, ok: false });
    expect(readSigning({ signing: { ...signing, root: "not hex" } })).toBeNull();
  });
});

describe("the evidence bundle (public-safe fields only)", () => {
  const at = (d: string) => new Date(`2026-${d}T15:00:00.000Z`);
  const PRIVATE = ["Daniel Okafor", "daniel@example.com", "416-555-0199", "the only wheelchair user at the depot", "Changed my mind", "INTERNAL NOTE"];
  const caseId = "33333333-3333-4333-8333-333333333333";
  const events: ChainEvent[] = [
    { seq: 1, type: "submitted", payload: { channel: "web", anonymous: false, text: PRIVATE[0], email: PRIVATE[1] }, createdAt: at("03-01"), hash: "1".repeat(64), prevHash: GENESIS_HASH },
    { seq: 2, type: "ai_structured", payload: { aiValue: PRIVATE[3], confirmedValue: PRIVATE[3] }, createdAt: at("03-01"), hash: "2".repeat(64), prevHash: "1".repeat(64) },
    { seq: 3, type: "redaction_approved", payload: { spans: [{ start: 0, end: 4, type: "PHONE" }], note: PRIVATE[2] }, createdAt: at("03-02"), hash: "3".repeat(64), prevHash: "2".repeat(64) },
    { seq: 4, type: "triaged", payload: { from: "new", to: "triaged", priorityArea: "ict", publicSummary: "The site's form had no labels.", comment: PRIVATE[4] }, createdAt: at("03-03"), hash: "4".repeat(64), prevHash: "3".repeat(64) },
    { seq: 5, type: "note_added", payload: { text: PRIVATE[5], kind: "internal" }, createdAt: at("03-04"), hash: "5".repeat(64), prevHash: "4".repeat(64) },
    { seq: 6, type: "closed", payload: { from: "triaged", to: "made_up", priorityArea: "not_an_area", reason: PRIVATE[4] }, createdAt: at("03-05"), hash: "6".repeat(64), prevHash: "5".repeat(64) },
  ];

  it("keeps hashes, record types, times, statuses and areas; staff-internal types say 'internal'", () => {
    expect(events.map(publicEvent)).toEqual([
      { seq: 1, type: "submitted", at: "2026-03-01T15:00:00.000Z", hash: "1".repeat(64), prevHash: GENESIS_HASH },
      { seq: 2, type: "ai_structured", at: "2026-03-01T15:00:00.000Z", hash: "2".repeat(64), prevHash: "1".repeat(64) },
      { seq: 3, type: "internal", at: "2026-03-02T15:00:00.000Z", hash: "3".repeat(64), prevHash: "2".repeat(64) },
      { seq: 4, type: "triaged", at: "2026-03-03T15:00:00.000Z", hash: "4".repeat(64), prevHash: "3".repeat(64), from: "new", to: "triaged", priorityArea: "ict" },
      { seq: 5, type: "internal", at: "2026-03-04T15:00:00.000Z", hash: "5".repeat(64), prevHash: "4".repeat(64) },
      { seq: 6, type: "closed", at: "2026-03-05T15:00:00.000Z", hash: "6".repeat(64), prevHash: "5".repeat(64) },
    ]);
  });

  it("holds the published report, the signature and each cited chain, and never a payload's text", () => {
    const signer = loadReportSigner({ ...LOCAL });
    const snapshot = {
      version: 1,
      period: { start: "2026-01-01", end: "2026-12-31" },
      asOf: "2026-10-19T16:00:00.000Z",
      cases: [
        { id: caseId, ref: "BAR-0001", status: "triaged", priorityArea: "ict", publicSummary: "The site's form had no labels.", receivedAt: "2026-03-01T15:00:00.000Z", verifiedAt: null, headHash: "4".repeat(64) },
        { id: "44444444-4444-4444-8444-444444444444", ref: "BAR-0002", status: "new", priorityArea: null, publicSummary: null, receivedAt: "2026-03-01T15:00:00.000Z", verifiedAt: null, headHash: "9".repeat(64) },
      ],
      facts: [{ id: "F_TOTAL", kind: "F_TOTAL", values: { total: 1 }, caseIds: [caseId] }],
    } as unknown as ReportSnapshot;
    const bare = {
      version: 1,
      settings: { planAreas: [] },
      sections: [{ key: "feedback", heading: "Feedback", level: 2, blocks: [{ kind: "claim", sentence: { id: "C:F_TOTAL", text: "We received 1.", factIds: ["F_TOTAL"], fallback: false } }] }],
      phrase: { ok: true, backend: "fake", model: null, promptSha: null, latencyMs: 0, fallbacks: 0 },
    } as unknown as ReportContent;
    const signedAt = new Date("2026-10-20T14:00:00.000Z");
    const signing = buildSigning({
      reportId: "11111111-1111-4111-8111-111111111111",
      signedAt,
      heads: [{ caseId, seq: 6, hash: "6".repeat(64) }, { caseId: "other", seq: 2, hash: "0".repeat(64) }],
      manifestHash: "c".repeat(64),
      areaText: {},
      consultationsText: "We met.",
      content: bare,
      signer,
    });
    const content: ReportContent = { ...bare, signing };
    const b = buildEvidenceBundle({
      org: { name: "Maple Harbour Bank", slug: "maple-harbour" },
      report: { id: "11111111-1111-4111-8111-111111111111", title: "Accessibility progress report 2026, version 1", periodStart: "2026-01-01", periodEnd: "2026-12-31", signedOffAt: signedAt, publishedAt: signedAt, manifestHash: "c".repeat(64), snapshot, content, areaText: {}, consultationsText: "We met." },
      chains: new Map([[caseId, [...events].reverse()]]),
      now: new Date("2026-10-21T12:00:00.000Z"),
      links: { report: "/p/maple-harbour/reports/x", verify: "/verify/x", signingKeys: "/.well-known/accessloop-signing-keys.json", verifier: "/verify/verify-bundle.mjs" },
    });
    expect(b).toMatchObject({ format: "accessloop-evidence-bundle", version: 1, createdAt: "2026-10-21T12:00:00.000Z" });
    // Only the cited case (F_TOTAL cites BAR-0001), in seq order, with both heads marked.
    expect(b.chains.map((c) => c.ref)).toEqual(["BAR-0001"]);
    expect(b.chains[0]).toMatchObject({ reportHead: "4".repeat(64), signedHead: "6".repeat(64), publicSummary: "The site's form had no labels." });
    expect(b.chains[0].events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    // The content as covered by contentHash; the signature with every org head, sorted.
    expect(b.report.content).toEqual(bare);
    expect(contentHash(b.report.content)).toBe(signing.contentHash);
    expect(b.signature).toMatchObject({ alg: "Ed25519", keyId: signer.keyId, root: signing.root, heads: ["0".repeat(64), "6".repeat(64)] });
    expect(rootSignatureValid(b.signature!.root, b.signature!.signature, signer.publicKey)).toBe(true);
    expect(
      reportRoot({ reportId: b.report.id, signedAt: b.signature!.signedAt, heads: b.signature!.heads, manifestHash: b.report.manifestHash, leadTextHash: leadTextHash(b.report.areaText, b.report.consultationsText), contentHash: contentHash(b.report.content) }),
    ).toBe(b.signature!.root);
    // Nothing from a payload but statuses and areas: no reporter text, contact detail, staff comment or note.
    const json = bundleJson(b);
    for (const text of PRIVATE) expect(json).not.toContain(text);
    expect(json).not.toMatch(/payload|actor|"channel"|"anonymous"|"spans"|"comment"|made_up|not_an_area/);
    expect(JSON.parse(json)).toEqual(b);
    expect(bundleFilename("Accessibility progress report 2026, version 1")).toBe("accessibility-progress-report-2026-version-1-evidence.json");
  });

  it("a report signed off before signing existed still downloads, with no signature", () => {
    const snapshot = { version: 1, period: { start: "2026-01-01", end: "2026-12-31" }, asOf: "x", cases: [], facts: [] } as unknown as ReportSnapshot;
    const content = { version: 1, settings: { planAreas: [] }, sections: [], phrase: { ok: true, backend: null, model: null, promptSha: null, latencyMs: null, fallbacks: 0 } } as unknown as ReportContent;
    const b = buildEvidenceBundle({
      org: { name: "O", slug: "o" },
      report: { id: "r", title: "T", periodStart: "2026-01-01", periodEnd: "2026-12-31", signedOffAt: null, publishedAt: null, manifestHash: "m", snapshot, content, areaText: null, consultationsText: null },
      chains: new Map(),
      now: new Date(0),
      links: { report: "", verify: "", signingKeys: "", verifier: "" },
    });
    expect(b.signature).toBeNull();
    expect(b.chains).toEqual([]);
    expect(b.report).toMatchObject({ areaText: {}, consultationsText: null });
  });
});
