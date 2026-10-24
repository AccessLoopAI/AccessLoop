// /verify/[reportId] (docs/domain.md §8), the pure part: the five checks over what the database holds NOW.
//   1. Report unchanged: manifestHash recomputed from the stored snapshot equals reports.manifest_hash, and every
//      stored sentence still checks against that snapshot (reports.content is outside the manifest; decisions.md).
//   2. Records intact: the frozen verifyCaseChain for every cited case (the caller runs it and passes the verdicts).
//   3. Report matches records: each snapshot case's headHash is an event of its chain, replaying the chain up to it
//      gives the same status, priorityArea, publicSummary, receivedAt and verifiedAt, and the facts recomputed from
//      the replayed cases equal the snapshot's (replaySnapshot, the same lib/metrics functions).
//   4. Later updates (information, never an error): events written after the head.
//   5. Signed by AccessLoop at sign-off (lib/report/signed-check.ts; the caller passes it in): the root recomputed
//      from the row as stored equals the signed root, the signature checks with a published key, and every case
//      history the signature sealed still holds its signed record. A draft is "not signed yet" (never an error).
// Input comes from the reports row (snapshot and content read as stored, so a tampered value is checked as it is)
// and from case_events (the `cases` projection is never read). The chain drawing (signature moment 3) is derived
// from check 2's verdict, so it can never disagree with it. Words only, never payloads or actor ids: the public sees
// this page for published reports.
import { z } from "zod";
import { canonicalJson, type ChainCheck } from "@/lib/case-events";
import { sha256Hex } from "@/lib/crypto";
import type { MetricEvent } from "@/lib/metrics";
import { citedCaseIds } from "./compose";
import { replaySnapshot, type CaseReplay, type SnapshotField } from "./replay";
import { NOT_SIGNED_YET, rowSigned, signedClause, type RowSigned, type SignedCheck } from "./signed-check";
import type { ReportContent, ReportSnapshot, SnapshotCase } from "./types";
import { revalidateContent } from "./validate";

/** One stored event, as /verify reads it (no actor, never shown). */
export interface ChainEvent extends MetricEvent {
  hash: string;
  prevHash: string;
}

/** The plain word for each kind of record. Anything staff-internal says only "Internal record". */
export const EVENT_WORDS: Readonly<Record<string, string>> = {
  submitted: "Received",
  ack_recorded: "Acknowledged",
  ai_structured: "Summarized",
  triaged: "Triaged",
  assigned: "Assigned",
  fix_logged: "Fix logged",
  retest_requested: "Check requested",
  retest_verdict: "Reporter answered",
  retest_expired: "Check expired",
  opted_out: "Contact stopped",
  reopened: "Reopened",
  closed: "Closed",
  message_sent: "Email logged",
};

export function eventWord(type: string): string {
  return EVENT_WORDS[type] ?? "Internal record";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCaseId = (id: string): boolean => UUID.test(id);

// Shape guards only: the stored values are checked AS STORED (never the parsed copy, which would drop extra keys).
const SnapshotShape = z.object({
  version: z.literal(1),
  period: z.object({ start: z.string(), end: z.string() }),
  asOf: z.string(),
  cases: z.array(
    z.object({
      id: z.string(),
      ref: z.string(),
      status: z.string(),
      priorityArea: z.string().nullable(),
      publicSummary: z.string().nullable(),
      receivedAt: z.string(),
      verifiedAt: z.string().nullable(),
      headHash: z.string(),
    }),
  ),
  facts: z.array(z.object({ id: z.string(), kind: z.string(), values: z.record(z.string(), z.union([z.number(), z.string()])), caseIds: z.array(z.string()) })),
});

const ContentShape = z.object({
  settings: z.object({ planAreas: z.array(z.string()) }),
  sections: z.array(z.object({ key: z.string(), heading: z.string(), blocks: z.array(z.object({ kind: z.string() })) })),
});

export interface StoredReport {
  /** The stored snapshot exactly as read, for the fingerprint. */
  raw: unknown;
  /** The snapshot when it has the expected shape, else null (it was changed beyond reading). */
  snapshot: ReportSnapshot | null;
  content: ReportContent | null;
  /** The cases the report's sentences cite (the Records rows), in snapshot order. */
  cited: SnapshotCase[];
}

/** Read a reports row's snapshot and content for checking. Never throws. */
export function readStoredReport(row: { snapshot: unknown; content: unknown }): StoredReport {
  const snapshot = SnapshotShape.safeParse(row.snapshot).success ? (row.snapshot as ReportSnapshot) : null;
  const content = ContentShape.safeParse(row.content).success ? (row.content as ReportContent) : null;
  let cited: SnapshotCase[] = [];
  if (snapshot) {
    let ids: Set<string> | null = null;
    if (content) {
      try {
        ids = new Set(citedCaseIds(content, snapshot));
      } catch {
        ids = null;
      }
    }
    // Content that can't be read cites nothing we can trust: show every snapshot case (check 1 is already red).
    cited = ids ? snapshot.cases.filter((c) => ids.has(c.id)) : snapshot.cases;
  }
  return { raw: row.snapshot, snapshot, content, cited };
}

export type LinkState = "ok" | "broken" | "unchecked";

/** One record of a case's chain, for the drawing (decorative; the table's text carries the facts). */
export interface ChainLinkView {
  seq: number;
  word: string;
  hash: string;
  /** ISO time the record was written. */
  at: string;
  /** ok: joins the chain; broken: the first record that does not; unchecked: after a break (can't be trusted). */
  state: LinkState;
  /** The last record this report saw (the snapshot's headHash). */
  head: boolean;
  /** Written after the report was built. */
  after: boolean;
}

export interface EvidenceRow {
  caseId: string;
  ref: string;
  publicSummary: string | null;
  /** The case's status in the snapshot (a closed case with no public summary was never reviewed). */
  status: string;
  /** Check 1 is about the whole report; it is repeated in every row (one column per check, domain §8). */
  unchanged: boolean;
  intact: { ok: boolean; length: number; brokenAtSeq: number | null; broken: { word: string; at: string } | null };
  matches: { ok: boolean; headFound: boolean; differs: SnapshotField[]; factsDiffer: boolean };
  laterUpdates: number;
  /** Check 5 for this case (the signature, and this case's signed record). */
  signed: RowSigned;
  chain: ChainLinkView[];
}

export interface EvidenceCheck {
  /** The snapshot could be read at all (when false there are no rows and every check fails). */
  readable: boolean;
  fingerprint: { saved: string; now: string; ok: boolean };
  /** The stored sentences still check against the stored snapshot. */
  sentences: { ok: boolean; failed: string[] };
  /** Check 1. */
  unchanged: boolean;
  /** Check 2 over the cited cases. */
  intact: { ok: boolean; cases: number; records: number; broken: string[] };
  /** Check 3: refs whose head or fields differ; facts that do not recompute. */
  matches: { ok: boolean; differ: string[]; facts: { ok: boolean; mismatched: string[] } };
  /** Check 4. */
  later: { updates: number; refs: string[] };
  /** Check 5 (a draft: state "draft", not signed yet). */
  signed: SignedCheck;
  rows: EvidenceRow[];
  /** Checks 1-3 all pass, and check 5 too once the report is signed off. */
  allOk: boolean;
  /** The status line: "All records match" only when allOk, else "Problems found: ..." in plain words. */
  line: string;
}

/**
 * The five checks. `chains`: each snapshot case's events as stored now (by case id, seq order). `verdicts`: the
 * frozen verifyCaseChain for each cited case (a case without one has no history to check). `signed`: check 5 as
 * lib/report/signed-check.ts computed it (default: a draft, not signed yet).
 */
export function checkEvidence(
  stored: StoredReport,
  savedHash: string,
  chains: ReadonlyMap<string, readonly ChainEvent[]>,
  verdicts: ReadonlyMap<string, ChainCheck>,
  signed: SignedCheck = NOT_SIGNED_YET,
): EvidenceCheck {
  const now = sha256Hex(canonicalJson(stored.raw ?? null));
  const fingerprint = { saved: savedHash, now, ok: now === savedHash };

  let sentences: { ok: boolean; failed: string[] } = { ok: false, failed: [] };
  if (stored.snapshot && stored.content) {
    try {
      sentences = revalidateContent(stored.content, stored.snapshot);
    } catch {
      sentences = { ok: false, failed: [] };
    }
  }
  const unchanged = fingerprint.ok && sentences.ok;

  const snapshot = stored.snapshot;
  let replay: { rows: Map<string, CaseReplay>; facts: { ok: boolean; mismatched: string[] } } | null = null;
  if (snapshot) {
    try {
      const loaded = snapshot.cases.map((c) => ({ id: c.id, ref: c.ref, events: [...(chains.get(c.id) ?? [])] }));
      const r = replaySnapshot(snapshot, loaded);
      replay = { rows: new Map(r.rows.map((x) => [x.caseId, x])), facts: r.facts };
    } catch {
      replay = null;
    }
  }
  const facts = replay?.facts ?? { ok: false, mismatched: [] };

  const rows: EvidenceRow[] = stored.cited.map((c) => {
    const events = [...(chains.get(c.id) ?? [])].sort((a, b) => a.seq - b.seq);
    const verdict = verdicts.get(c.id);
    const length = verdict?.length ?? 0;
    const intactOk = !!verdict && verdict.ok && verdict.length > 0;
    const brokenAtSeq = verdict && !verdict.ok ? (verdict.brokenAtSeq ?? null) : null;
    const brokenEvent = brokenAtSeq !== null ? events.find((e) => e.seq === brokenAtSeq) : undefined;
    const r = replay?.rows.get(c.id);
    const headSeq = r?.headSeq ?? null;
    const chain: ChainLinkView[] = events.map((e) => ({
      seq: e.seq,
      word: eventWord(e.type),
      hash: e.hash,
      at: e.createdAt.toISOString(),
      state: intactOk || brokenAtSeq === null ? (verdict ? "ok" : "unchecked") : e.seq < brokenAtSeq ? "ok" : e.seq === brokenAtSeq ? "broken" : "unchecked",
      head: e.hash === c.headHash,
      after: headSeq !== null && e.seq > headSeq,
    }));
    return {
      caseId: c.id,
      ref: c.ref,
      publicSummary: c.publicSummary,
      status: c.status,
      unchanged,
      intact: {
        ok: intactOk,
        // verifyCaseChain counts the records it checked before a break; the drawing shows every stored record.
        length: verdict?.ok ? length : events.length,
        brokenAtSeq,
        broken: brokenEvent ? { word: eventWord(brokenEvent.type), at: brokenEvent.createdAt.toISOString() } : null,
      },
      matches: r
        ? { ok: r.ok, headFound: r.headFound, differs: r.differs, factsDiffer: r.factsDiffer }
        : { ok: false, headFound: false, differs: [], factsDiffer: !facts.ok },
      laterUpdates: r?.laterUpdates ?? 0,
      signed: rowSigned(signed, c.id),
      chain,
    };
  });

  const intact = {
    ok: !!snapshot && rows.every((r) => r.intact.ok),
    cases: rows.length,
    records: rows.reduce((n, r) => n + r.chain.length, 0),
    broken: rows.filter((r) => !r.intact.ok).map((r) => r.ref),
  };
  const matches = {
    ok: !!snapshot && !!replay && facts.ok && rows.every((r) => r.matches.ok),
    differ: rows.filter((r) => !r.matches.headFound || r.matches.differs.length > 0).map((r) => r.ref),
    facts,
  };
  const laterRows = rows.filter((r) => r.laterUpdates > 0);
  const later = { updates: laterRows.reduce((n, r) => n + r.laterUpdates, 0), refs: laterRows.map((r) => r.ref) };
  const signedOk = signed.state === "draft" || signed.ok;
  const allOk = !!snapshot && unchanged && intact.ok && matches.ok && signedOk;
  const check: Omit<EvidenceCheck, "line"> = { readable: !!snapshot, fingerprint, sentences, unchanged, intact, matches, later, signed, rows, allOk };
  return { ...check, line: evidenceLine(check) };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "BAR-0003", "BAR-0003 and BAR-0007", "BAR-0001, BAR-0002, BAR-0003 and 4 more". */
export function refList(refs: readonly string[], max = 3): string {
  if (refs.length <= 1) return refs[0] ?? "";
  if (refs.length <= max) return `${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}`;
  return `${refs.slice(0, max).join(", ")} and ${refs.length - max} more`;
}

export function updatesPhrase(n: number): string {
  return `${n} ${plural(n, "update", "updates")} since this report`;
}

/**
 * The status line (domain §8): "All records match" only when checks 1-3 pass (and check 5 once signed off);
 * otherwise what failed, in plain words.
 */
export function evidenceLine(c: Omit<EvidenceCheck, "line">): string {
  if (c.allOk) return c.later.updates > 0 ? `All records match (${updatesPhrase(c.later.updates)}).` : "All records match.";
  const problems: string[] = [];
  if (!c.fingerprint.ok) problems.push("the report was changed after it was generated (its fingerprint no longer matches)");
  else if (!c.sentences.ok) problems.push("the report's sentences were changed after it was generated");
  if (!c.readable) problems.push("its frozen records can't be read");
  if (c.intact.broken.length > 0) {
    const n = c.intact.broken.length;
    problems.push(`${n} case ${plural(n, "history has", "histories have")} a broken link (${refList(c.intact.broken)})`);
  }
  if (c.matches.differ.length > 0) problems.push(`the report doesn't match the records for ${refList(c.matches.differ)}`);
  if (c.readable && !c.matches.facts.ok) {
    const n = c.matches.facts.mismatched.length;
    problems.push(
      n > 0
        ? `${n} of the report's ${plural(n, "counts doesn't", "counts don't")} match a recount of the records`
        : "the report's counts can't be recounted from the records",
    );
  }
  const sealed = signedClause(c.signed);
  if (sealed) problems.push(sealed);
  if (problems.length === 0) problems.push("the report doesn't match the records");
  return `Problems found: ${problems.join("; ")}.`;
}

/** Field names in words (the "Report matches records" column). */
export const FIELD_WORDS: Readonly<Record<SnapshotField, string>> = {
  status: "status",
  priorityArea: "area",
  publicSummary: "public summary",
  receivedAt: "date received",
  verifiedAt: "date confirmed",
};
