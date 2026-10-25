// The report's facts (docs/domain.md §7.2), each a THIN wrapper around a lib/metrics function: the dashboard and the
// report can never disagree, and no number is computed here (lib/metrics/README.md "Report facts as thin wrappers").
// Facts never depend on org settings (F_AREA is emitted for all 7 areas, zeros included) or on `now`, so /verify can
// recompute them from replayed events alone (§8 check 3). Pure and deterministic.
import { PRIORITY_AREAS, AREA_HEADINGS, type PriorityArea } from "./headings";
import {
  acknowledgementCompliance,
  anonymousReceived,
  fixedCases,
  medianDaysToVerifiedFix,
  notFeedback,
  outcomes,
  periodCases,
  priorityAreas,
  retestResponseRate,
  totalReceived,
  INTAKE_CHANNELS,
  type MetricInput,
} from "@/lib/metrics";
import type { Fact, FactKind } from "./types";

export const FACT = {
  total: "F_TOTAL",
  anon: "F_ANON",
  notFeedback: "F_NOT_FEEDBACK",
  area: (a: PriorityArea) => `F_AREA:${a}`,
  outcome: "F_OUTCOME",
  verifyTime: "F_VERIFY_TIME",
  ack: "F_ACK",
  retest: "F_RETEST",
  case: (ref: string) => `F_CASE:${ref}`,
} as const;

/** The kind of a fact id ("F_AREA:ict" -> "F_AREA"), or null for an id that is not one of ours. */
export function factKindOf(id: string): FactKind | null {
  const kind = id.split(":")[0];
  switch (kind) {
    case "F_TOTAL":
    case "F_ANON":
    case "F_NOT_FEEDBACK":
    case "F_OUTCOME":
    case "F_VERIFY_TIME":
    case "F_ACK":
    case "F_RETEST":
      return id === kind ? kind : null;
    case "F_AREA":
    case "F_CASE":
      return id.length > kind.length + 1 ? kind : null;
    default:
      return null;
  }
}

/**
 * Every fact for the period, in a fixed order: F_TOTAL, F_ANON, F_NOT_FEEDBACK (only when a submission received in
 * the period was closed as not accessibility feedback), F_AREA:<each area, ACA order>, F_OUTCOME, F_VERIFY_TIME (only
 * when at least one case is verified), F_ACK, F_RETEST, then F_CASE:<ref> per verified or fixed case in input order
 * (case seq). caseIds keep the input order. Keys whose metric is "no data" are left out (so a snapshot frozen before
 * F_NOT_FEEDBACK existed, which holds no spam, recomputes to the same facts).
 */
export function compileFacts(input: MetricInput): Fact[] {
  const facts: Fact[] = [];
  const order = periodCases(input).map((c) => c.id);
  const inOrder = (...lists: string[][]) => {
    const hit = new Set(lists.flat());
    return order.filter((id) => hit.has(id));
  };

  const t = totalReceived(input);
  const byChannel = Object.fromEntries(INTAKE_CHANNELS.map((ch) => [ch, t.byChannel[ch].count]));
  facts.push({ id: FACT.total, kind: "F_TOTAL", values: { total: t.total.count, ...byChannel }, caseIds: t.total.caseIds });

  const anon = anonymousReceived(input);
  facts.push({ id: FACT.anon, kind: "F_ANON", values: { anonymous: anon.count, total: t.total.count }, caseIds: anon.caseIds });

  const nf = notFeedback(input);
  if (nf.count > 0) {
    facts.push({ id: FACT.notFeedback, kind: "F_NOT_FEEDBACK", values: { notFeedback: nf.count }, caseIds: nf.caseIds });
  }

  const areas = priorityAreas(input);
  for (const a of PRIORITY_AREAS) {
    const s = areas.byArea[a];
    facts.push({ id: FACT.area(a), kind: "F_AREA", values: { count: s.count, area: AREA_HEADINGS[a].canonical }, caseIds: s.caseIds });
  }

  const o = outcomes(input);
  facts.push({
    id: FACT.outcome,
    kind: "F_OUTCOME",
    values: {
      verified: o.verified.count,
      verifiedViaStaffCode: o.verifiedStaffRelayed.count,
      unverified: o.fixedUnverified.count,
      open: o.inProgress.count,
      closed: o.closed.count,
    },
    caseIds: inOrder(o.verified.caseIds, o.verifiedStaffRelayed.caseIds, o.fixedUnverified.caseIds, o.inProgress.caseIds, o.closed.caseIds),
  });

  const vt = medianDaysToVerifiedFix(input);
  if (vt.days !== null) {
    facts.push({ id: FACT.verifyTime, kind: "F_VERIFY_TIME", values: { medianDays: vt.days, verified: vt.cases.count }, caseIds: vt.cases.caseIds });
  }

  const ack = acknowledgementCompliance(input);
  facts.push({
    id: FACT.ack,
    kind: "F_ACK",
    values: {
      nonAnonymous: ack.required.count,
      acked: ack.acknowledged.count,
      ...(ack.medianHours !== null ? { medianHours: ack.medianHours } : {}),
    },
    caseIds: ack.required.caseIds,
  });

  const r = retestResponseRate(input);
  facts.push({
    id: FACT.retest,
    kind: "F_RETEST",
    values: { requested: r.requested.rounds, answered: r.answered.rounds, partlyOrNotFixed: r.sentBack.rounds },
    caseIds: r.requested.caseIds,
  });

  for (const f of fixedCases(input)) {
    facts.push({
      id: FACT.case(f.ref),
      kind: "F_CASE",
      values: {
        ...(f.publicSummary ? { publicSummary: f.publicSummary } : {}),
        outcome: f.status,
        viaStaffCode: f.codeRelayedByStaff ? "yes" : "no",
      },
      caseIds: [f.caseId],
    });
  }
  return facts;
}
