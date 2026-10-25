// Signing at sign-off and the evidence bundle on a freshly seeded PGlite (docs/domain.md §8 "Signed at sign-off"; the
// tests/report-edit.seed.test.ts pattern): without a signing key nothing is signed off; with the local derived key the
// sign-off seals EVERY case history of the org (never another org's) with the snapshot fingerprint, the lead's text
// and the sentences, and the signature checks with the published key; the published report's evidence bundle can be
// checked offline (fingerprint, root, signature, the links of each cited history) and carries no payload text; the
// lead's text changed afterwards turns the signature check red; and a broken case history anywhere in the org, even
// outside the report's period, refuses the sign-off.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { canonicalJson, GENESIS_HASH } from "@/lib/case-events";
import { zonedNoon } from "@/lib/dates";
import { thisYear } from "@/lib/metrics";
import type { EditResult } from "@/lib/report/edit";
import type { ReportPeriod, ReportSigning } from "@/lib/report/types";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const NOW = zonedNoon("2026-10-19");
const PERIOD = thisYear(NOW);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type WithOrg = typeof import("@/db/tenant").withOrg;
type Edit = typeof import("@/lib/report/edit");
type Access = typeof import("@/lib/report/access");
type Signing = typeof import("@/lib/report/signing");
type SigningKey = typeof import("@/lib/report/signing-key");

let seeded: SeededDb | undefined;
let sql: postgres.Sql;
let orgId = "";
let otherOrgId = "";
let leadId = "";
let reportId = "";
let withOrg: WithOrg;
let edit: Edit;
let access: Access;
let signing: Signing;
let signingKey: SigningKey;
const saved = { ...process.env };

async function draft(period: ReportPeriod): Promise<string> {
  const { generateReport } = await import("@/lib/report/generate");
  const r = await generateReport({ orgId, memberId: leadId, period, now: NOW });
  if (!r.ok) throw new Error(`generateReport refused: ${r.code}`);
  const [row] = await sql<{ content: { settings: { planAreas: string[] } } }[]>`select content from reports where id = ${r.id}`;
  await withOrg({ orgId, role: "lead" }, async (tx) => {
    for (const area of row.content.settings.planAreas) {
      const s = await edit.saveLeadText(tx, { orgId, reportId: r.id, key: `area:${area}`, text: `Our progress on ${area}.` });
      if (!s.ok) throw new Error(s.reason);
    }
    const c = await edit.saveLeadText(tx, { orgId, reportId: r.id, key: "consultations", text: "We met our advisory group twice." });
    if (!c.ok) throw new Error(c.reason);
  });
  return r.id;
}

const signOff = (id: string, now = NOW) => withOrg({ orgId, role: "lead" }, (tx) => edit.signOffReport(tx, { orgId, reportId: id, memberId: leadId, now }));
const refusal = (r: EditResult) => (r.ok ? "ok" : r.reason);
const stored = async (id: string) =>
  (
    await sql<{ status: string; content: { signing?: ReportSigning }; manifest_hash: string; area_text: Record<string, string>; consultations_text: string | null; signed_off_at: Date | null }[]>`
      select status, content, manifest_hash, area_text, consultations_text, signed_off_at from reports where id = ${id}`
  )[0];

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env, { FAKE_LLM: "1", AI_BACKEND: "fake", AUTH_MODE: "local", SESSION_SECRET: "test-session-secret" });
  delete process.env.REPORT_SIGNING_KEY;
  delete process.env.VERCEL;
  sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  [{ id: orgId }] = await sql<{ id: string }[]>`select id from orgs where slug = 'maple-harbour'`;
  [{ id: otherOrgId }] = await sql<{ id: string }[]>`select id from orgs where slug = 'lakeview-telecom'`;
  [{ id: leadId }] = await sql<{ id: string }[]>`select id from org_members where org_id = ${orgId} and role = 'lead'`;
  ({ withOrg } = await import("@/db/tenant"));
  edit = await import("@/lib/report/edit");
  access = await import("@/lib/report/access");
  signing = await import("@/lib/report/signing");
  signingKey = await import("@/lib/report/signing-key");
  reportId = await draft(PERIOD);
}, 240_000);

afterAll(async () => {
  await sql?.end().catch(() => {});
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

describe("signing at sign-off", () => {
  it("without a signing key (not AUTH_MODE=local, no REPORT_SIGNING_KEY) nothing is signed off", async () => {
    process.env.AUTH_MODE = "clerk";
    try {
      expect(refusal(await signOff(reportId))).toBe("signing_unavailable");
    } finally {
      process.env.AUTH_MODE = "local";
    }
    expect((await stored(reportId)).status).toBe("draft");
    expect((await stored(reportId)).content.signing).toBeUndefined();
  });

  it("seals every case history of the org at that moment, and the signature checks with the published key", async () => {
    expect(refusal(await signOff(reportId))).toBe("ok");
    const row = await stored(reportId);
    expect(row.status).toBe("signed_off");
    const s = row.content.signing!;
    const signer = signingKey.loadReportSigner();
    expect(s).toMatchObject({ version: 1, alg: "Ed25519", keyId: signer.keyId, signedAt: NOW.toISOString(), manifestHash: row.manifest_hash });
    expect(row.signed_off_at?.toISOString()).toBe(s.signedAt);

    // Exactly this org's histories, each at its latest record; never another org's.
    const latest = await sql<{ case_id: string; seq: number; hash: string }[]>`
      select distinct on (case_id) case_id, seq, hash from case_events where org_id = ${orgId} order by case_id, seq desc`;
    expect(latest.length).toBeGreaterThanOrEqual(16);
    expect([...s.heads].sort((a, b) => a.caseId.localeCompare(b.caseId))).toEqual(
      latest.map((l) => ({ caseId: l.case_id, seq: l.seq, hash: l.hash })).sort((a, b) => a.caseId.localeCompare(b.caseId)),
    );
    expect(s.heads.map((h) => h.hash)).toEqual(s.heads.map((h) => h.hash).sort());
    // (The equality above already excludes them; this also holds once a seed gives Lakeview case histories.)
    const other = await sql<{ case_id: string }[]>`select distinct case_id from case_events where org_id = ${otherOrgId}`;
    for (const o of other) expect(s.heads.some((h) => h.caseId === o.case_id)).toBe(false);

    const check = signing.checkSignature(
      { id: reportId, signedOffAt: row.signed_off_at, manifestHash: row.manifest_hash, content: row.content, areaText: row.area_text, consultationsText: row.consultations_text },
      new Map([[signer.keyId, signer.publicKey]]),
    );
    expect(check.ok).toBe(true);
    const published = signing.publicKeyFromSpki(signingKey.publishedKey(signer).publicKey)!;
    expect(signing.rootSignatureValid(s.root, s.signature, published)).toBe(true);
  });

  it("the evidence check still passes after signing (content.signing is outside check 1's sentences)", async () => {
    const ev = await access.loadStaffEvidence({ orgId, role: "lead" }, reportId);
    expect(ev?.check.allOk).toBe(true);
  });
});

describe("the evidence bundle", () => {
  it("is there for the published report only", async () => {
    expect(await access.loadPublishedBundle("maple-harbour", reportId, NOW)).toBeNull(); // signed off, not published
    const p = await withOrg({ orgId, role: "lead" }, (tx) => edit.publishReport(tx, { orgId, reportId, now: NOW }));
    expect(p.ok).toBe(true);
    expect(await access.loadPublishedBundle("lakeview-telecom", reportId, NOW)).toBeNull();
    expect(await access.loadPublishedBundle("maple-harbour", "not-a-report", NOW)).toBeNull();
    expect(await access.loadPublishedBundle("maple-harbour", reportId, NOW)).not.toBeNull();
  });

  it("checks offline: fingerprint, root, signature and the links of every cited history", async () => {
    const { bundle: b } = (await access.loadPublishedBundle("maple-harbour", reportId, NOW))!;
    const file = JSON.parse(JSON.stringify(b)) as typeof b; // as a third party reads the downloaded file
    expect(sha(canonicalJson(file.report.snapshot))).toBe(file.report.manifestHash);
    const sig = file.signature!;
    const root = signing.reportRoot({
      reportId: file.report.id,
      signedAt: sig.signedAt,
      heads: sig.heads,
      manifestHash: file.report.manifestHash,
      leadTextHash: sha(canonicalJson({ areaText: file.report.areaText, consultationsText: file.report.consultationsText })),
      contentHash: sha(canonicalJson(file.report.content)),
    });
    expect(root).toBe(sig.root);
    const key = signing.publicKeyFromSpki(signingKey.publishedKey(signingKey.loadReportSigner()).publicKey)!;
    expect(signing.rootSignatureValid(sig.root, sig.signature, key)).toBe(true);

    expect(file.chains.length).toBe(16);
    for (const c of file.chains) {
      let prev = GENESIS_HASH;
      for (const [i, e] of c.events.entries()) {
        expect(e.seq).toBe(i + 1);
        expect(e.prevHash).toBe(prev);
        prev = e.hash;
      }
      const hashes = c.events.map((e) => e.hash);
      expect(hashes).toContain(c.reportHead);
      expect(c.signedHead).not.toBeNull();
      expect(hashes).toContain(c.signedHead);
      expect(sig.heads).toContain(c.signedHead);
    }
  });

  it("carries no payload text: nothing a person typed, no staff note, no contact detail", async () => {
    const { bundle: b } = (await access.loadPublishedBundle("maple-harbour", reportId, NOW))!;
    const json = JSON.stringify(b);
    // Text that is public anyway (the published report and its sources) may repeat; nothing else from a payload.
    const published = JSON.stringify([b.report.snapshot, b.report.content, b.report.areaText, b.report.consultationsText]);
    const ids = b.chains.map((c) => c.caseId);
    const payloads = await sql<{ payload: unknown }[]>`select payload from case_events where org_id = ${orgId} and case_id in ${sql(ids)}`;
    const strings = new Set<string>();
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.add(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    payloads.forEach((p) => walk(p.payload));
    let checked = 0;
    for (const s of strings) {
      // (Dates may equal a record time, which the bundle shows on purpose.)
      if (s.length < 12 || published.includes(s) || /^d{4}-d{2}-d{2}/.test(s)) continue;
      checked++;
      expect(json, "a payload string reached the bundle").not.toContain(s);
    }
    expect(checked).toBeGreaterThan(10); // the seed's payloads do hold text this test would catch
    expect(json).not.toMatch(/"payload"|"actorId"|"actorKind"|"signedOffBy"|"createdBy"/);
    // The only email address is the organization's own public contact (General, ACR s.14(2)).
    const orgEmail = (b.report.content as { settings: { contactEmail: string } }).settings.contactEmail;
    expect(new Set(json.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [])).toEqual(new Set([orgEmail]));
  });

  it("the lead's text changed after sign-off (whoever controls the database) turns the signature check red", async () => {
    const before = await stored(reportId);
    const signer = signingKey.loadReportSigner();
    const keys = new Map([[signer.keyId, signer.publicKey]]);
    const check = (r: typeof before) =>
      signing.checkSignature({ id: reportId, signedOffAt: r.signed_off_at, manifestHash: r.manifest_hash, content: r.content, areaText: r.area_text, consultationsText: r.consultations_text }, keys);
    // Triggers off (session_replication_role = replica), as whoever controls the database could: a sign-off lock
    // trigger (D7) must not hide what the signature catches.
    const asOwner = (text: string | null) =>
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        await tx`update reports set consultations_text = ${text} where id = ${reportId}`;
      });
    await asOwner("We met our advisory group every month.");
    try {
      const after = await stored(reportId);
      expect(check(after)).toMatchObject({ ok: false, rootOk: false, signatureOk: true, parts: { leadText: false, content: true, manifest: true } });
    } finally {
      await asOwner(before.consultations_text);
    }
    expect(check(await stored(reportId)).ok).toBe(true);
  });
});

describe("a broken case history refuses the sign-off", () => {
  it("anywhere in the org, even outside the report's period (this throwaway database only)", async () => {
    // January's report cites BAR-0001 and BAR-0002 only; break BAR-0010 (received in September).
    const january = await draft({ start: "2026-01-01", end: "2026-01-31" });
    const [{ id: bar10 }] = await sql<{ id: string }[]>`select id from cases where org_id = ${orgId} and ref = 'BAR-0010'`;
    const ev = await access.loadStaffEvidence({ orgId, role: "lead" }, january);
    expect(ev?.check.rows.map((r) => r.ref)).not.toContain("BAR-0010");
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      const hit = await tx`update case_events set payload = payload || '{"note":"edited"}'::jsonb where case_id = ${bar10} and seq = 2 returning id`;
      expect(hit).toHaveLength(1);
    });
    expect((await access.loadStaffEvidence({ orgId, role: "lead" }, january))?.check.allOk).toBe(true); // /verify can't see it
    expect(refusal(await signOff(january))).toBe("evidence_failed");
    const row = await stored(january);
    expect(row.status).toBe("draft");
    expect(row.content.signing).toBeUndefined();
  });
});
