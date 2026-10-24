// /verify/[reportId] (docs/domain.md §8), the database part. Takes a transaction the CALLER opened inside withOrg
// (the org resolved server-side: the staff session, or resolvePublishedReport() for the public) and imports only
// `type Tx`, so the seeded-PGlite tests can drive it. It reads the reports row as stored and case_events (the cited
// cases, and for a signed-off report every case history its signature sealed); never the `cases` projection (refs
// come from the snapshot).
import type { KeyObject } from "node:crypto";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { caseEvents, reports } from "@/db/schema";
import { verifyCaseChain, type ChainCheck } from "@/lib/case-events";
import { checkEvidence, isCaseId, readStoredReport, type ChainEvent, type EvidenceCheck } from "./evidence";
import { checkSigned, NOT_SIGNED_YET, type HeadNow, type SignedCheck } from "./signed-check";
import { readSigning } from "./signing";
import { verificationKeys } from "./signing-key";
import type { SignedHead } from "./types";

export interface VerifyTarget {
  id: string;
  title: string;
  status: "draft" | "signed_off";
  periodStart: string;
  periodEnd: string;
  createdAt: Date;
  signedOffAt: Date | null;
  publishedAt: Date | null;
  manifestHash: string;
  /** As stored (unknown on purpose: a tampered value is checked as it is). */
  snapshot: unknown;
  content: unknown;
  /** The lead's text as stored (covered by the signed root, check 5). */
  areaText: unknown;
  consultationsText: unknown;
}

/** The report with this id in `orgId` (publishedOnly: signed off AND published), or null. */
export async function loadVerifyTarget(tx: Tx, orgId: string, reportId: string, opts: { publishedOnly: boolean }): Promise<VerifyTarget | null> {
  if (!isCaseId(reportId)) return null;
  const where = opts.publishedOnly
    ? and(eq(reports.id, reportId), eq(reports.orgId, orgId), eq(reports.status, "signed_off"), isNotNull(reports.publishedAt))
    : and(eq(reports.id, reportId), eq(reports.orgId, orgId));
  const [row] = await tx
    .select({
      id: reports.id,
      title: reports.title,
      status: reports.status,
      periodStart: reports.periodStart,
      periodEnd: reports.periodEnd,
      createdAt: reports.createdAt,
      signedOffAt: reports.signedOffAt,
      publishedAt: reports.publishedAt,
      manifestHash: reports.manifestHash,
      snapshot: reports.snapshot,
      content: reports.content,
      areaText: reports.areaText,
      consultationsText: reports.consultationsText,
    })
    .from(reports)
    .where(where)
    .limit(1);
  return row ?? null;
}

/** Each case's stored events (seq order), by case id. Only case_events is read. */
export async function loadChains(tx: Tx, orgId: string, caseIds: readonly string[]): Promise<Map<string, ChainEvent[]>> {
  const ids = [...new Set(caseIds.filter(isCaseId))];
  const byCase = new Map<string, ChainEvent[]>();
  if (ids.length === 0) return byCase;
  const rows = await tx
    .select({
      caseId: caseEvents.caseId,
      seq: caseEvents.seq,
      type: caseEvents.type,
      payload: caseEvents.payload,
      createdAt: caseEvents.createdAt,
      hash: caseEvents.hash,
      prevHash: caseEvents.prevHash,
    })
    .from(caseEvents)
    .where(and(eq(caseEvents.orgId, orgId), inArray(caseEvents.caseId, ids)))
    .orderBy(asc(caseEvents.caseId), asc(caseEvents.seq));
  for (const r of rows) {
    const list = byCase.get(r.caseId) ?? [];
    list.push({ seq: r.seq, type: r.type, payload: r.payload ?? {}, createdAt: r.createdAt, hash: r.hash, prevHash: r.prevHash });
    byCase.set(r.caseId, list);
  }
  return byCase;
}

/**
 * Every case history of the org as it is now, each checked by the frozen verifyCaseChain (pipelined on the
 * transaction's connection): the heads a sign-off seals (docs/domain.md §8 "Signed at sign-off"). `broken`: the
 * case ids whose history does not verify (then nothing may be signed).
 */
export async function loadOrgHeads(tx: Tx, orgId: string): Promise<{ heads: SignedHead[]; broken: string[] }> {
  const ids = (await tx.selectDistinct({ caseId: caseEvents.caseId }).from(caseEvents).where(eq(caseEvents.orgId, orgId))).map((r) => r.caseId);
  const results = await Promise.all(ids.map((id) => verifyCaseChain(tx, orgId, id)));
  const heads: SignedHead[] = [];
  const broken: string[] = [];
  results.forEach((r, i) => {
    if (r.ok && r.length > 0) heads.push({ caseId: ids[i], seq: r.length, hash: r.headHash });
    else broken.push(ids[i]);
  });
  return { heads, broken };
}

/** The frozen verifyCaseChain for each id (pipelined on the transaction's connection; a busy org has hundreds). */
async function verdictsFor(tx: Tx, orgId: string, caseIds: readonly string[], known?: ReadonlyMap<string, ChainCheck>): Promise<Map<string, ChainCheck>> {
  const out = new Map<string, ChainCheck>();
  const todo: string[] = [];
  for (const id of new Set(caseIds.filter(isCaseId))) {
    const v = known?.get(id);
    if (v) out.set(id, v);
    else todo.push(id);
  }
  const results = await Promise.all(todo.map((id) => verifyCaseChain(tx, orgId, id)));
  todo.forEach((id, i) => out.set(id, results[i]));
  return out;
}

/**
 * Check 5's database part: for each case history a signature sealed, whether a record is still stored at the
 * signed position with the signed fingerprint, and whether the history still verifies (frozen verifyCaseChain) up
 * to and including it. `known`: verdicts already computed (the cited cases), reused.
 */
export async function loadSignedHeads(
  tx: Tx,
  orgId: string,
  heads: readonly SignedHead[],
  known?: ReadonlyMap<string, ChainCheck>,
): Promise<Map<string, HeadNow>> {
  const ids = [...new Set(heads.map((h) => h.caseId).filter(isCaseId))];
  const now = new Map<string, HeadNow>();
  if (ids.length === 0) return now;
  const rows = await tx
    .select({ caseId: caseEvents.caseId, seq: caseEvents.seq, hash: caseEvents.hash })
    .from(caseEvents)
    .where(and(eq(caseEvents.orgId, orgId), inArray(caseEvents.caseId, ids)));
  const hashAt = new Map(rows.map((r) => [`${r.caseId}:${r.seq}`, r.hash]));
  const verdicts = await verdictsFor(tx, orgId, ids, known);
  for (const h of heads) {
    if (!isCaseId(h.caseId)) continue;
    const v = verdicts.get(h.caseId);
    const intact = !!v && (v.ok ? v.length >= h.seq : (v.brokenAtSeq ?? 0) > h.seq);
    now.set(h.caseId, { found: hashAt.get(`${h.caseId}:${h.seq}`) === h.hash, intact });
  }
  return now;
}

/** What runEvidenceCheck needs: a sign-off passes a draft's three columns; /verify passes the whole VerifyTarget. */
export type EvidenceTarget = Pick<VerifyTarget, "snapshot" | "content" | "manifestHash"> &
  Partial<Pick<VerifyTarget, "id" | "status" | "signedOffAt" | "areaText" | "consultationsText">>;

/**
 * The five checks for a loaded report: check 2 is the frozen verifyCaseChain, once per cited case; check 5 runs
 * only for a signed-off report (`target.status`), with `keys` (default: the keys this server publishes).
 */
export async function runEvidenceCheck(
  tx: Tx,
  orgId: string,
  target: EvidenceTarget,
  opts: { keys?: ReadonlyMap<string, KeyObject> } = {},
): Promise<EvidenceCheck> {
  const stored = readStoredReport(target);
  const chains = await loadChains(tx, orgId, stored.snapshot ? stored.snapshot.cases.map((c) => c.id) : []);
  const verdicts = await verdictsFor(tx, orgId, stored.cited.map((c) => c.id));
  let signed: SignedCheck = NOT_SIGNED_YET;
  if (target.status === "signed_off" && target.id) {
    const signing = readSigning(target.content);
    signed = checkSigned({
      row: {
        id: target.id,
        status: "signed_off",
        signedOffAt: target.signedOffAt ?? null,
        manifestHash: target.manifestHash,
        snapshot: target.snapshot,
        content: target.content,
        areaText: target.areaText,
        consultationsText: target.consultationsText,
      },
      keys: opts.keys ?? verificationKeys(),
      headsNow: signing ? await loadSignedHeads(tx, orgId, signing.heads, verdicts) : new Map(),
      refsById: new Map((stored.snapshot?.cases ?? []).map((c) => [c.id, c.ref])),
      citedIds: stored.cited.map((c) => c.id),
    });
  }
  return checkEvidence(stored, target.manifestHash, chains, verdicts, signed);
}
