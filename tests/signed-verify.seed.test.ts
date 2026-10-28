// /verify's fifth check ("Signed by AccessLoop at sign-off") and the offline checker tools/verify-bundle.mjs, on a
// freshly seeded PGlite (docs/domain.md §8; docs/archive/phase7-prompt.md T5 items 4-6). A signed, published report passes
// all five checks and its evidence bundle passes offline (also as the command line, with exit codes). The sign-off
// lock (D7(a)) refuses every change to the stored row, even for the owner. Then, tampering the way whoever controls
// the database could (triggers switched off, this throwaway database only), each change turns the RIGHT check red
// and the offline checker fails on the bundle made from the same database:
//   - the lead's own text            -> only check 5 online; offline: the signed root
//   - a sentence                     -> checks 1 and 5; offline: the root and the numbers
//   - the snapshot (inflated count)  -> checks 1 and 5; offline: the fingerprint and the numbers
//   - a cited case history rewritten with fresh, consistent fingerprints
//                                    -> check 2 still passes (the links join), checks 3 and 5 red; offline: the history
//   - the whole rewrite made consistent (history, snapshot, fingerprint)
//                                    -> checks 1-3 pass, ONLY the signature catches it; offline: the root and the history
//   - a history outside the report edited in place
//                                    -> only check 5 online; the bundle does not carry that history (documented limit)
// Everything is restored after each case and the report checks out again.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { canonicalJson, computeHash, GENESIS_HASH } from "@/lib/case-events";
import { zonedNoon } from "@/lib/dates";
import { thisYear } from "@/lib/metrics";
import type { EvidenceCheck } from "@/lib/report/evidence";
import type { ReportContent, ReportPeriod, ReportSnapshot } from "@/lib/report/types";
import { readKeys, verifyBundle, type VerifyResult } from "@/tools/verify-bundle.mjs";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const NOW = zonedNoon("2026-10-19");
const PERIOD = thisYear(NOW);
const ORG = "maple-harbour";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type WithOrg = typeof import("@/db/tenant").withOrg;
type Edit = typeof import("@/lib/report/edit");
type Access = typeof import("@/lib/report/access");
type SigningKey = typeof import("@/lib/report/signing-key");

let seeded: SeededDb | undefined;
let sql: postgres.Sql;
let orgId = "";
let leadId = "";
let reportId = "";
let withOrg: WithOrg;
let edit: Edit;
let access: Access;
let signingKey: SigningKey;
let dir = "";
const saved = { ...process.env };

async function signedReport(period: ReportPeriod): Promise<string> {
  const { generateReport } = await import("@/lib/report/generate");
  const r = await generateReport({ orgId, memberId: leadId, period, now: NOW });
  if (!r.ok) throw new Error(`generateReport refused: ${r.code}`);
  const [row] = await sql<{ content: ReportContent }[]>`select content from reports where id = ${r.id}`;
  await withOrg({ orgId, role: "lead" }, async (tx) => {
    for (const area of row.content.settings.planAreas) {
      const s = await edit.saveLeadText(tx, { orgId, reportId: r.id, key: `area:${area}`, text: `Our progress on ${area}.` });
      if (!s.ok) throw new Error(s.reason);
    }
    const c = await edit.saveLeadText(tx, { orgId, reportId: r.id, key: "consultations", text: "We met our advisory group twice." });
    if (!c.ok) throw new Error(c.reason);
    const so = await edit.signOffReport(tx, { orgId, reportId: r.id, memberId: leadId, now: NOW });
    if (!so.ok) throw new Error(so.reason);
    const p = await edit.publishReport(tx, { orgId, reportId: r.id, now: NOW });
    if (!p.ok) throw new Error(p.reason);
  });
  return r.id;
}

/** /verify as the public sees it. */
async function online(id = reportId): Promise<EvidenceCheck> {
  const pub = await access.loadPublicEvidence(id);
  if (!pub) throw new Error("not published");
  return pub.check;
}

/** The evidence bundle as a third party reads the downloaded file. */
async function bundle(id = reportId): Promise<unknown> {
  const b = await access.loadPublishedBundle(ORG, id, NOW);
  if (!b) throw new Error("no bundle");
  return JSON.parse(JSON.stringify(b.bundle));
}

/** The published key list, as /.well-known/accessloop-signing-keys.json serves it. */
const keyList = () => ({ issuer: "AccessLoop", keys: [signingKey.publishedKey(signingKey.loadReportSigner())] });

async function offline(id = reportId, expectRoot?: string): Promise<VerifyResult> {
  return verifyBundle(await bundle(id), { keys: readKeys(keyList()), expectRoot });
}

const statusOf = (r: VerifyResult, id: string) => r.checks.find((c) => c.id === id)?.status;
const detailsOf = (r: VerifyResult, id: string) => r.checks.find((c) => c.id === id)?.details.join(" | ") ?? "";

/** The command line on a written bundle: [exit code, stdout]. */
function cli(b: unknown, ...args: string[]): [number | null, string] {
  const file = path.join(dir, `bundle-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(b, null, 2));
  const keys = path.join(dir, "accessloop-signing-keys.json");
  writeFileSync(keys, JSON.stringify(keyList(), null, 2));
  const r = spawnSync(process.execPath, [path.join("tools", "verify-bundle.mjs"), file, ...args.map((a) => (a === "KEYS" ? keys : a))], { encoding: "utf8" });
  return [r.status, r.stdout];
}

/** As whoever controls the database: triggers switched off for this one transaction. */
const asOwner = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");
    return fn(tx);
  }) as Promise<T>;

async function setReportColumn(id: string, column: "snapshot" | "content" | "consultations_text", value: string | null, manifestHash?: string) {
  await asOwner(async (tx) => {
    if (column === "consultations_text") await tx`update reports set consultations_text = ${value} where id = ${id}`;
    else if (column === "snapshot") {
      await tx`update reports set snapshot = ${value}::text::jsonb where id = ${id}`;
      if (manifestHash) await tx`update reports set manifest_hash = ${manifestHash} where id = ${id}`;
    } else await tx`update reports set content = ${value}::text::jsonb where id = ${id}`;
  });
}

const storedText = async (id: string) =>
  (
    await sql<{ snapshot: string; content: string; consultations_text: string | null; manifest_hash: string }[]>`
      select snapshot::text as snapshot, content::text as content, consultations_text, manifest_hash from reports where id = ${id}`
  )[0];

interface EventRow {
  id: string;
  org_id: string;
  case_id: string;
  seq: number;
  type: string;
  actor_kind: string;
  actor_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  prev_hash: string;
  hash: string;
}

/**
 * Rewrite a case history from record `fromSeq` on, as whoever controls the database could: that record's payload
 * changes and every fingerprint from it is recomputed, so the links still join. Returns the new head and a restore.
 */
async function rewriteHistory(caseId: string, fromSeq: number) {
  const rows = await sql<EventRow[]>`select id::text as id, org_id, case_id, seq, type, actor_kind, actor_id, payload, created_at, prev_hash, hash
    from case_events where case_id = ${caseId} order by seq`;
  let prev = fromSeq > 1 ? rows[fromSeq - 2].hash : GENESIS_HASH;
  const updates: { id: string; payload: unknown; prevHash: string; hash: string }[] = [];
  for (const r of rows.filter((x) => x.seq >= fromSeq)) {
    const payload = r.seq === fromSeq ? { ...r.payload, note: "rewritten later" } : r.payload;
    const hash = computeHash(prev, { orgId: r.org_id, caseId: r.case_id, seq: r.seq, type: r.type, actorKind: r.actor_kind, actorId: r.actor_id, payload, createdAt: r.created_at });
    updates.push({ id: r.id, payload, prevHash: prev, hash });
    prev = hash;
  }
  const write = (list: { id: string; payload: unknown; prevHash: string; hash: string }[]) =>
    asOwner(async (tx) => {
      for (const u of list) await tx`update case_events set payload = ${JSON.stringify(u.payload)}::text::jsonb, prev_hash = ${u.prevHash}, hash = ${u.hash} where id = ${u.id}::bigint`;
    });
  await write(updates);
  return {
    oldHead: rows[rows.length - 1].hash,
    newHead: prev,
    restore: () => write(rows.filter((x) => x.seq >= fromSeq).map((r) => ({ id: r.id, payload: r.payload, prevHash: r.prev_hash, hash: r.hash }))),
  };
}

const caseIdOf = async (ref: string) => (await sql<{ id: string }[]>`select id from cases where org_id = ${orgId} and ref = ${ref}`)[0].id;

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env, { FAKE_LLM: "1", AI_BACKEND: "fake", AUTH_MODE: "local", SESSION_SECRET: "test-session-secret" });
  delete process.env.REPORT_SIGNING_KEY;
  delete process.env.VERCEL;
  sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  [{ id: orgId }] = await sql<{ id: string }[]>`select id from orgs where slug = ${ORG}`;
  [{ id: leadId }] = await sql<{ id: string }[]>`select id from org_members where org_id = ${orgId} and role = 'lead'`;
  ({ withOrg } = await import("@/db/tenant"));
  edit = await import("@/lib/report/edit");
  access = await import("@/lib/report/access");
  signingKey = await import("@/lib/report/signing-key");
  reportId = await signedReport(PERIOD);
  dir = mkdtempSync(path.join(tmpdir(), "al-verify-bundle-"));
}, 240_000);

afterAll(async () => {
  await sql?.end().catch(() => {});
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

describe("a signed, published report", () => {
  it("passes all five checks online: the fifth seals every case history of the org", async () => {
    const c = await online();
    expect(c.line).toBe("All records match.");
    expect(c.allOk).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`select count(distinct case_id)::int n from case_events where org_id = ${orgId}`;
    expect(c.signed).toMatchObject({ state: "checked", ok: true, keysAvailable: true, heads: { total: n, changed: [] } });
    expect(c.signed.signature).toMatchObject({ ok: true, rootOk: true, signatureOk: true, keyKnown: true });
    expect(c.signed.signature?.recomputedRoot).toBe(c.signed.root);
    expect(c.rows.length).toBe(16);
    expect(new Set(c.rows.map((r) => r.signed))).toEqual(new Set(["ok"]));
  });

  it("passes offline: the five checks of tools/verify-bundle.mjs, with the fingerprint from the notice too", async () => {
    const r = await offline();
    expect(r.checks.map((x) => [x.id, x.status])).toEqual([
      ["fingerprint", "pass"],
      ["root", "pass"],
      ["signature", "pass"],
      ["histories", "pass"],
      ["numbers", "pass"],
    ]);
    expect(r).toMatchObject({ ok: true, complete: true });
    expect(r.notRecounted).toEqual(expect.arrayContaining(["intake channels", "anonymous feedback", "acknowledgements", "re-test answers"]));
    // The seed closes nothing as not accessibility feedback (domain §10: 0), so the report has no F_NOT_FEEDBACK
    // fact to list (tests/verify-bundle.test.ts covers one that has it).
    expect(r.notRecounted).not.toContain("which submissions were closed as not accessibility feedback");
    expect(r.checks.find((x) => x.id === "numbers")?.summary).toMatch(/total received, areas, outcomes, median time to a confirmed fix and fixed cases recount/);
    const root = (await online()).signed.root!;
    const grouped = root.match(/.{4}/g)!.join(" ");
    expect((await offline(reportId, grouped)).ok).toBe(true); // as typed from the notice, in groups of four
    const wrong = await offline(reportId, "0".repeat(64));
    expect(statusOf(wrong, "root")).toBe("fail");
    expect(detailsOf(wrong, "root")).toContain("is not the fingerprint you gave");
  });

  it("the command line: exit 0 when every check passes, 2 without a key, 1 when a check fails; --json for machines", async () => {
    const b = await bundle();
    const [ok, out] = cli(b, "--keys", "KEYS");
    expect(ok).toBe(0);
    expect(out).toContain("PASS  Signature: Ed25519, valid for key ed25519-");
    expect(out.trim().endsWith("All checks passed.")).toBe(true);
    const [noKey, out2] = cli(b);
    expect(noKey).toBe(2);
    expect(out2).toContain("SKIP  Signature: not checked");
    const [json, out3] = cli(b, "--keys", "KEYS", "--json");
    expect(json).toBe(0);
    expect(JSON.parse(out3)).toMatchObject({ ok: true, complete: true });
    const forged = structuredClone(b) as { report: { consultationsText: string } };
    forged.report.consultationsText = "We met our advisory group every week.";
    const [bad, out4] = cli(forged, "--keys", "KEYS");
    expect(bad).toBe(1);
    expect(out4).toContain("FAIL  Signed root");
    expect(out4).toContain("the lead's own text (the area sections or Consultations) is not the text that was signed");
  });

  it("the sign-off lock (D7(a)): the stored row can't change, even for the owner, and publishing happens once", async () => {
    await expect(sql.begin((tx) => tx`update reports set consultations_text = 'Changed.' where id = ${reportId}`)).rejects.toThrow(/signed off and locked/);
    await expect(sql.begin((tx) => tx`update reports set published_at = now() where id = ${reportId}`)).rejects.toThrow(/signed off and locked/);
    const again = await withOrg({ orgId, role: "lead" }, (tx) => edit.publishReport(tx, { orgId, reportId, now: NOW }));
    expect(again).toMatchObject({ ok: false, reason: "already_published" });
    expect((await online()).allOk).toBe(true);
  });
});

describe("tampering turns the right check red, and the offline checker fails on the same bundle", () => {
  it("the lead's own text: only check 5 online; offline, the signed root", async () => {
    const before = await storedText(reportId);
    await setReportColumn(reportId, "consultations_text", "We met our advisory group every month.");
    try {
      const c = await online();
      expect(c).toMatchObject({ unchanged: true, intact: { ok: true }, matches: { ok: true }, allOk: false });
      expect(c.signed).toMatchObject({ state: "checked", ok: false, signature: { rootOk: false, signatureOk: true } });
      expect(c.signed.signature?.parts).toEqual({ manifest: true, leadText: false, content: true, signedAt: true });
      expect(c.line).toBe("Problems found: it no longer matches what AccessLoop signed at sign-off (the lead's own text changed).");
      expect(new Set(c.rows.map((r) => r.signed))).toEqual(new Set(["report"]));
      const r = await offline();
      expect(r.checks.map((x) => [x.id, x.status])).toEqual([
        ["fingerprint", "pass"],
        ["root", "fail"],
        ["signature", "pass"],
        ["histories", "pass"],
        ["numbers", "pass"],
      ]);
      expect(detailsOf(r, "root")).toContain("the lead's own text");
      expect(r.ok).toBe(false);
    } finally {
      await setReportColumn(reportId, "consultations_text", before.consultations_text);
    }
    expect((await online()).allOk).toBe(true);
    expect((await offline()).ok).toBe(true);
  });

  it("a sentence: checks 1 and 5 online; offline, the root and the numbers", async () => {
    const before = await storedText(reportId);
    const content = JSON.parse(before.content) as ReportContent;
    const feedback = content.sections.find((s) => s.key === "feedback")!;
    const block = feedback.blocks.find((b) => b.kind === "claim")!;
    if (block.kind !== "claim") throw new Error("no claim");
    block.sentence.text = `${block.sentence.text} Another 999 were fixed.`;
    await setReportColumn(reportId, "content", JSON.stringify(content));
    try {
      const c = await online();
      expect(c).toMatchObject({ unchanged: false, fingerprint: { ok: true }, sentences: { ok: false }, intact: { ok: true }, allOk: false });
      expect(c.signed.signature?.parts).toEqual({ manifest: true, leadText: true, content: false, signedAt: true });
      expect(c.line).toContain("it no longer matches what AccessLoop signed at sign-off (its sentences changed)");
      const r = await offline();
      expect(statusOf(r, "fingerprint")).toBe("pass");
      expect(statusOf(r, "root")).toBe("fail");
      expect(detailsOf(r, "root")).toContain("sentences or sections are not the ones that were signed");
      expect(statusOf(r, "numbers")).toBe("fail");
      expect(detailsOf(r, "numbers")).toContain("the number 999 is not a value of the facts it cites");
    } finally {
      await setReportColumn(reportId, "content", before.content);
    }
    expect((await online()).allOk).toBe(true);
  });

  it("the snapshot (the verified count inflated): checks 1 and 5 online; offline, the fingerprint and the numbers", async () => {
    const before = await storedText(reportId);
    const snap = JSON.parse(before.snapshot) as ReportSnapshot;
    const outcome = snap.facts.find((f) => f.id === "F_OUTCOME")!;
    outcome.values.verified = Number(outcome.values.verified) + 5;
    await setReportColumn(reportId, "snapshot", JSON.stringify(snap));
    try {
      const c = await online();
      expect(c).toMatchObject({ unchanged: false, fingerprint: { ok: false }, allOk: false });
      expect(c.signed.signature?.parts.manifest).toBe(false);
      expect(c.line).toMatch(/^Problems found: the report was changed after it was generated/);
      expect(c.line).toContain("(its frozen records changed)");
      const r = await offline();
      expect(statusOf(r, "fingerprint")).toBe("fail");
      expect(statusOf(r, "numbers")).toBe("fail");
      expect(detailsOf(r, "numbers")).toContain("F_OUTCOME: the confirmed fixes does not recount");
      expect(r.ok).toBe(false);
    } finally {
      await setReportColumn(reportId, "snapshot", before.snapshot);
    }
    expect((await online()).allOk).toBe(true);
  });

  it("a cited case history rewritten with consistent fingerprints: check 2 passes, checks 3 and 5 red; offline, the history", async () => {
    const bar3 = await caseIdOf("BAR-0003");
    const rw = await rewriteHistory(bar3, 2);
    try {
      const c = await online();
      expect(c.intact.ok).toBe(true); // the links join: verifyCaseChain alone can't see a consistent rewrite
      const row = c.rows.find((r) => r.ref === "BAR-0003")!;
      expect(row.matches).toMatchObject({ ok: false, headFound: false });
      expect(row.signed).toBe("history");
      expect(c.rows.filter((r) => r.signed !== "ok").map((r) => r.ref)).toEqual(["BAR-0003"]);
      expect(c.signed).toMatchObject({ ok: false, signature: { ok: true } });
      expect(c.signed.heads.changed).toEqual([expect.objectContaining({ caseId: bar3, ref: "BAR-0003", found: false, intact: true })]);
      expect(c.line).toContain("the report doesn't match the records for BAR-0003");
      expect(c.line).toContain("(1 case history changed after sign-off (BAR-0003))");
      const r = await offline();
      expect(r.checks.map((x) => [x.id, x.status])).toEqual([
        ["fingerprint", "pass"],
        ["root", "pass"],
        ["signature", "pass"],
        ["histories", "fail"],
        ["numbers", "pass"],
      ]);
      expect(detailsOf(r, "histories")).toContain("BAR-0003: the history no longer holds the record the report froze");
      expect(detailsOf(r, "histories")).toContain("BAR-0003: the history no longer holds the record that was signed");
    } finally {
      await rw.restore();
    }
    expect((await online()).allOk).toBe(true);
    expect((await offline()).ok).toBe(true);
  });

  it("the whole rewrite made consistent (history, snapshot and fingerprint): checks 1-3 pass, only the signature catches it", async () => {
    const before = await storedText(reportId);
    const bar3 = await caseIdOf("BAR-0003");
    const rw = await rewriteHistory(bar3, 2);
    const snap = JSON.parse(before.snapshot) as ReportSnapshot;
    snap.cases.find((x) => x.id === bar3)!.headHash = rw.newHead;
    await setReportColumn(reportId, "snapshot", JSON.stringify(snap), sha(canonicalJson(snap)));
    try {
      const c = await online();
      expect(c).toMatchObject({ unchanged: true, intact: { ok: true }, matches: { ok: true }, allOk: false });
      expect(c.signed.ok).toBe(false);
      expect(c.signed.signature?.parts.manifest).toBe(false);
      expect(c.signed.heads.changed.map((h) => h.ref)).toEqual(["BAR-0003"]);
      expect(c.line).toBe(
        "Problems found: it no longer matches what AccessLoop signed at sign-off (its frozen records changed; 1 case history changed after sign-off (BAR-0003)).",
      );
      const r = await offline();
      expect(statusOf(r, "fingerprint")).toBe("pass"); // consistent with itself...
      expect(statusOf(r, "root")).toBe("fail"); // ...but not what was signed
      expect(detailsOf(r, "root")).toContain("the report's fingerprint is not the one that was signed");
      expect(statusOf(r, "histories")).toBe("fail");
      expect(detailsOf(r, "histories")).toContain("BAR-0003: the history no longer holds the record that was signed");
    } finally {
      await setReportColumn(reportId, "snapshot", before.snapshot, before.manifest_hash);
      await rw.restore();
    }
    expect((await online()).allOk).toBe(true);
  });

  it("a history outside the report edited in place: only check 5 online; the bundle doesn't carry it (a known limit)", async () => {
    const january = await signedReport({ start: "2026-01-01", end: "2026-01-31" });
    const bar10 = await caseIdOf("BAR-0010");
    expect((await online(january)).rows.map((r) => r.ref)).not.toContain("BAR-0010");
    const [orig] = await sql<{ id: string; payload: Record<string, unknown> }[]>`select id::text as id, payload from case_events where case_id = ${bar10} and seq = 2`;
    await asOwner((tx) => tx`update case_events set payload = ${JSON.stringify({ ...orig.payload, note: "edited" })}::text::jsonb where id = ${orig.id}::bigint`);
    try {
      const c = await online(january);
      expect(c).toMatchObject({ unchanged: true, intact: { ok: true }, matches: { ok: true }, allOk: false });
      expect(c.signed.heads.changed).toEqual([expect.objectContaining({ caseId: bar10, ref: null, found: true, intact: false })]);
      expect(c.line).toBe("Problems found: it no longer matches what AccessLoop signed at sign-off (1 case history changed after sign-off).");
      // Offline, the file holds only the cited histories (and record contents never): this edit is the online check's.
      expect((await offline(january)).ok).toBe(true);
    } finally {
      await asOwner((tx) => tx`update case_events set payload = ${JSON.stringify(orig.payload)}::text::jsonb where id = ${orig.id}::bigint`);
    }
    expect((await online(january)).allOk).toBe(true);
  });
});
