// "Report matches records" (docs/domain.md §8 check 3), the pure part: a case's reportable state is replayed from its
// events ALONE, up to the event the snapshot froze (its headHash), and must give the same status, priorityArea,
// publicSummary, receivedAt and verifiedAt as the snapshot; the facts recomputed from those replayed cases (the same
// lib/metrics functions, the same order) must equal the snapshot's facts. Events after the head are "later updates"
// (check 4, information only). The `cases` projection is never read: only each case's id, ref and event chain.
// Server-side (canonicalJson comes from the frozen lib/case-events).
import { canonicalJson } from "@/lib/case-events";
import { replayCase, type MetricCase } from "@/lib/metrics";
import { compileFacts } from "./facts";
import { toSnapshotCase } from "./snapshot";
import type { ReportSnapshot, SnapshotCase } from "./types";

export const SNAPSHOT_FIELDS = ["status", "priorityArea", "publicSummary", "receivedAt", "verifiedAt"] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/** The case's chain cut at the event whose hash is `headHash` (that event included), or null when no event has it. */
export function cutAtHead(c: MetricCase, headHash: string): { cut: MetricCase; headSeq: number } | null {
  const sorted = [...c.events].sort((a, b) => a.seq - b.seq);
  const head = sorted.find((e) => e.hash === headHash);
  if (!head) return null;
  return { cut: { id: c.id, ref: c.ref, events: sorted.filter((e) => e.seq <= head.seq) }, headSeq: head.seq };
}

export interface CaseReplay {
  caseId: string;
  /** The snapshot's ref (never taken from the projection). */
  ref: string;
  /** The snapshot's headHash is an event of this case's chain. */
  headFound: boolean;
  headSeq: number | null;
  /** Events in the chain now. */
  eventCount: number;
  /** Check 4: events written after the head (0 or more; information, never an error). */
  laterUpdates: number;
  /** The case replayed to its head, as a snapshot row (null when the head is not found). */
  replayed: SnapshotCase | null;
  /** Fields where the replay and the snapshot disagree. */
  differs: SnapshotField[];
  /** A fact citing this case does not recompute to the snapshot's value. */
  factsDiffer: boolean;
  /** headFound, no differing field, no differing fact. */
  ok: boolean;
}

export interface ReplayCheck {
  rows: CaseReplay[];
  /** Facts whose recomputed value differs from the snapshot's (or that appear in only one of them). */
  facts: { ok: boolean; mismatched: string[] };
  ok: boolean;
}

/**
 * Replay every snapshot case from `loaded` (the org's cases with their whole chains, hashes included; extra cases are
 * ignored) and compare. Rows come in snapshot order.
 */
export function replaySnapshot(snapshot: ReportSnapshot, loaded: readonly MetricCase[]): ReplayCheck {
  const byId = new Map(loaded.map((c) => [c.id, c]));
  const cuts: MetricCase[] = [];
  const rows: CaseReplay[] = snapshot.cases.map((sc) => {
    const c = byId.get(sc.id);
    const eventCount = c?.events.length ?? 0;
    const cut = c ? cutAtHead(c, sc.headHash) : null;
    if (!cut) {
      return { caseId: sc.id, ref: sc.ref, headFound: false, headSeq: null, eventCount, laterUpdates: 0, replayed: null, differs: [], factsDiffer: false, ok: false };
    }
    cuts.push(cut.cut);
    const replayed = toSnapshotCase(replayCase(cut.cut));
    const differs = SNAPSHOT_FIELDS.filter((k) => replayed[k] !== sc[k]);
    return {
      caseId: sc.id,
      ref: sc.ref,
      headFound: true,
      headSeq: cut.headSeq,
      eventCount,
      laterUpdates: Math.max(0, eventCount - cut.cut.events.length),
      replayed: { ...replayed, ref: sc.ref },
      differs,
      factsDiffer: false,
      ok: differs.length === 0,
    };
  });

  const recomputed = compileFacts({ cases: cuts, period: snapshot.period, now: new Date(snapshot.asOf) });
  const stored = new Map(snapshot.facts.map((f) => [f.id, f]));
  const fresh = new Map(recomputed.map((f) => [f.id, f]));
  const mismatched: string[] = [];
  const touched = new Set<string>();
  for (const id of new Set([...stored.keys(), ...fresh.keys()])) {
    const a = stored.get(id);
    const b = fresh.get(id);
    if (a && b && canonicalJson(a) === canonicalJson(b)) continue;
    mismatched.push(id);
    for (const caseId of [...(a?.caseIds ?? []), ...(b?.caseIds ?? [])]) touched.add(caseId);
  }
  for (const r of rows) {
    if (touched.has(r.caseId)) {
      r.factsDiffer = true;
      r.ok = false;
    }
  }
  const factsOk = mismatched.length === 0;
  return { rows, facts: { ok: factsOk, mismatched }, ok: factsOk && rows.every((r) => r.ok) };
}
