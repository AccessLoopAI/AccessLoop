// The frozen snapshot of a progress report (docs/domain.md §7.1) and its fingerprint (manifestHash, §8 check 1).
// Every case received in the period, as replayed from its events (the `cases` projection is never trusted), each with
// the hash of its latest event, plus the facts compiled from the same replayed cases. A case closed as not
// accessibility feedback (spam) is in the snapshot only so F_NOT_FEEDBACK can cite it (Phase 7 D6); every other fact
// leaves it out, as before.
// Server-side (node:crypto via the frozen helpers); takes a transaction, never opens one.
import type { Tx } from "@/db/client";
import { canonicalJson, verifyCaseChain } from "@/lib/case-events";
import { sha256Hex } from "@/lib/crypto";
import { receivedCases, type MetricCase, type ReplayedCase } from "@/lib/metrics";
import { loadMetricCasesTx } from "@/lib/metrics/load-tx";
import { compileFacts } from "./facts";
import type { ReportPeriod, ReportSnapshot, SnapshotCase } from "./types";

/** sha256 of the canonical JSON of the snapshot (sorted keys, so the jsonb round trip keeps it). */
export function manifestHash(snapshot: ReportSnapshot): string {
  return sha256Hex(canonicalJson(snapshot));
}

/** A replayed case as the snapshot stores it: ISO strings, never Dates. */
export function toSnapshotCase(r: ReplayedCase): SnapshotCase {
  if (!r.headHash) throw new Error("toSnapshotCase: the case's events carry no hashes");
  return {
    id: r.id,
    ref: r.ref,
    status: r.status,
    priorityArea: r.priorityArea,
    publicSummary: r.publicSummary,
    receivedAt: r.receivedAt.toISOString(),
    verifiedAt: r.verifiedAt ? r.verifiedAt.toISOString() : null,
    headHash: r.headHash,
  };
}

export interface SnapshotParts {
  snapshot: ReportSnapshot;
  /** The period's cases with their chains, in snapshot order: the input the facts were compiled from. */
  cases: MetricCase[];
}

/**
 * Pure: the snapshot of `period` from an org's cases (each with its whole chain, hashes included, in case-seq order).
 * The facts are compiled from exactly the snapshot's cases, in the same order, so /verify recomputes them the same way.
 */
export function snapshotFromCases(all: readonly MetricCase[], period: ReportPeriod, now: Date): SnapshotParts {
  const replayedCases = receivedCases({ cases: all, period, now });
  const ids = new Set(replayedCases.map((r) => r.id));
  const cases = all.filter((c) => ids.has(c.id));
  const asOf = now.toISOString();
  const snapshot: ReportSnapshot = {
    version: 1,
    period: { start: period.start, end: period.end },
    asOf,
    cases: replayedCases.map(toSnapshotCase),
    facts: compileFacts({ cases, period, now: new Date(asOf) }),
  };
  return { snapshot, cases };
}

export interface BuiltSnapshot extends SnapshotParts {
  /** In-period cases whose hash chain does not verify. Non-empty = the caller must refuse to build a report. */
  broken: { caseId: string; ref: string; brokenAtSeq?: number }[];
}

/**
 * Freeze the snapshot inside the caller's withOrg() transaction: load the org's cases and events, keep the cases
 * received in the period (by replay), verify each one's chain with the frozen verifyCaseChain (its head must also be the
 * head we replayed), and compile the facts.
 */
export async function buildSnapshot(tx: Tx, orgId: string, period: ReportPeriod, now: Date): Promise<BuiltSnapshot> {
  const all = await loadMetricCasesTx(tx, orgId);
  const parts = snapshotFromCases(all, period, now);
  const broken: BuiltSnapshot["broken"] = [];
  for (const c of parts.snapshot.cases) {
    const check = await verifyCaseChain(tx, orgId, c.id);
    if (!check.ok || check.headHash !== c.headHash) {
      broken.push({ caseId: c.id, ref: c.ref, ...(check.brokenAtSeq !== undefined ? { brokenAtSeq: check.brokenAtSeq } : {}) });
    }
  }
  return { ...parts, broken };
}
