// lib/metrics, pure: the rules the seed does not exercise (staff-relayed codes, real-AI corrections, opt-outs and
// expiry, spam, the display time zone at period edges, reassignment, acknowledgement channels), the inbox filter
// parser, and the period helpers. The seed's exact table is in tests/metrics.seed.test.ts.
import { describe, expect, it } from "vitest";
import { zonedNoon } from "@/lib/dates";
import {
  acknowledgementCompliance,
  applyInboxFilter,
  computeDashboardMetrics,
  customPeriod,
  daysBetween,
  describeInboxFilter,
  inboxHref,
  isFilterActive,
  last90Days,
  medianDaysToVerifiedFix,
  monthLabel,
  needsAttention,
  notFeedback,
  parseInboxFilter,
  periodLabel,
  periodMonths,
  replayCase,
  reporterCorrectionRate,
  retestResponseRate,
  thisYear,
  totalReceived,
  verifiedFixRate,
  type MetricCase,
  type MetricEvent,
} from "@/lib/metrics";

const DAY = 86_400_000;
const NOW = zonedNoon("2026-10-19");
const YEAR = thisYear(NOW);

/** Builds a case's event chain the way createCase()/transition() would write it. */
class Story {
  readonly events: MetricEvent[] = [];
  private status = "new";
  private readonly t0: number;
  constructor(
    readonly id: string,
    readonly ref: string,
    received: string, // ISO instant
    sub: { channel?: string; anonymous?: boolean; relayed?: boolean; ai?: { backend: string; summarySource: string } } = {},
  ) {
    this.t0 = new Date(received).getTime();
    const channel = sub.channel ?? "web";
    const anonymous = sub.anonymous ?? true;
    this.add(0, "submitted", { channel, isAnonymous: anonymous, codeRelayedByStaff: !!sub.relayed });
    this.add(0, "redaction_proposed", { spans: [] });
    if (sub.ai) this.add(0, "ai_structured", { backend: sub.ai.backend, confirmedValue: { summarySource: sub.ai.summarySource } });
    if (channel === "web") this.add(0, "ack_recorded", { channel: "web_screen", anonymous });
  }
  get case(): MetricCase {
    return { id: this.id, ref: this.ref, events: this.events };
  }
  add(days: number, type: string, payload: Record<string, unknown> = {}) {
    this.events.push({ seq: this.events.length + 1, type, payload, createdAt: new Date(this.t0 + days * DAY + this.events.length) });
    return this;
  }
  move(days: number, type: string, to: string, payload: Record<string, unknown> = {}) {
    this.add(days, type, { ...payload, from: this.status, to });
    this.status = to;
    return this;
  }
  approve(days = 0) {
    return this.add(days, "redaction_approved", { spans: [] });
  }
  triage(days = 0, area = "ict") {
    return this.approve(days).move(days, "triaged", "triaged", { priorityArea: area, publicSummary: "A barrier." });
  }
  assign(days = 1) {
    return this.move(days, "assigned", "assigned", { memberId: "m1" });
  }
  fixWithRetest(days: number, round = 1) {
    this.move(days, "fix_logged", "retest_open", { retestRound: round });
    return this.add(days, "retest_requested", { round });
  }
  verdict(days: number, verdict: "fixed" | "partly" | "not_fixed" | "cant_check", round = 1) {
    const to = verdict === "fixed" ? "verified" : verdict === "cant_check" ? "fixed_unverified" : "assigned";
    return this.move(days, "retest_verdict", to, { verdict, round, via: "receipt_code" });
  }
}

const ids = (s: { caseIds: string[] }) => [...s.caseIds].sort();

describe("replayCase", () => {
  it("derives status, area, summary and times from the events alone", () => {
    const s = new Story("a", "BAR-0001", "2026-03-02T15:00:00Z").triage(0, "employment").assign(1).fixWithRetest(5).verdict(9, "fixed");
    const r = replayCase(s.case);
    expect(r.status).toBe("verified");
    expect(r.priorityArea).toBe("employment");
    expect(r.publicSummary).toBe("A barrier.");
    expect(r.receivedOn).toBe("2026-03-02");
    expect(r.verifiedAt).not.toBeNull();
    expect(r.retestRounds.map((x) => x.outcome)).toEqual(["fixed"]);
    expect(r.ackInIntakeChannelAt).not.toBeNull();
  });

  it("sorts events by seq and falls back safely when there is no submitted event", () => {
    const s = new Story("a", "BAR-0001", "2026-03-02T15:00:00Z").triage();
    const shuffled = { ...s.case, events: [...s.events].reverse() };
    expect(replayCase(shuffled).status).toBe("triaged");
    const broken = replayCase({ id: "b", ref: "BAR-0002", events: [] });
    expect(broken.status).toBe("new");
    expect(broken.channel).toBe("other");
  });

  it("keeps the assigned clock through a reassignment, and restarts it when a fix is sent back", () => {
    const s = new Story("a", "BAR-0001", "2026-08-01T15:00:00Z").triage().assign(1).move(20, "assigned", "assigned", { memberId: "m2" });
    expect(replayCase(s.case).assignedSince?.getTime()).toBe(s.events.find((e) => e.type === "assigned")!.createdAt.getTime());
    s.fixWithRetest(30).verdict(31, "partly");
    const r = replayCase(s.case);
    expect(r.status).toBe("assigned");
    expect(r.assignedSince?.getTime()).toBe(s.events[s.events.length - 1].createdAt.getTime());
  });
});

describe("staff-relayed codes (domain §3)", () => {
  it("are shown apart: in the rate's denominator, never its numerator", () => {
    const direct = new Story("d", "BAR-0001", "2026-02-01T15:00:00Z").triage().assign().fixWithRetest(3).verdict(5, "fixed");
    const relayed = new Story("r", "BAR-0002", "2026-02-01T15:00:00Z", { channel: "phone", relayed: true })
      .triage().assign().fixWithRetest(3).verdict(5, "fixed");
    const input = { cases: [direct.case, relayed.case], period: YEAR, now: NOW };
    const v = verifiedFixRate(input);
    expect(ids(v.verified)).toEqual(["d"]);
    expect(ids(v.verifiedStaffRelayed)).toEqual(["r"]);
    expect(ids(v.fixLogged)).toEqual(["d", "r"]);
    expect(v.notVerified.count).toBe(0);
    expect(v.rate).toBe(0.5);
    // the time to fix does not depend on who held the code
    expect(ids(medianDaysToVerifiedFix(input).cases)).toEqual(["d", "r"]);
    expect(applyInboxFilter(input.cases, v.verifiedStaffRelayed.filter, NOW)).toEqual(["r"]);
  });

  it("D6: a fixed case without a re-test offer is in the verified-fix rate, as not verified", () => {
    const noRetest = new Story("n", "BAR-0001", "2026-02-01T15:00:00Z").triage().assign().move(4, "fix_logged", "fixed_unverified");
    const v = verifiedFixRate({ cases: [noRetest.case], period: YEAR, now: NOW });
    expect(v.fixLogged.count).toBe(1);
    expect(ids(v.fixedUnverified)).toEqual(["n"]);
    expect(v.rate).toBe(0);
  });

  it("no fix logged: no rate (null, never 0%)", () => {
    const open = new Story("o", "BAR-0001", "2026-02-01T15:00:00Z").triage().assign();
    const v = verifiedFixRate({ cases: [open.case], period: YEAR, now: NOW });
    expect(v.fixLogged.count).toBe(0);
    expect(v.rate).toBeNull();
  });
});

describe("D6: the verified-fix rate's denominator is every case with a logged fix, whatever happened next", () => {
  const verified = new Story("v", "BAR-0001", "2026-03-01T15:00:00Z").triage().assign().fixWithRetest(2).verdict(4, "fixed");
  const waiting = new Story("w", "BAR-0002", "2026-03-01T15:00:00Z").triage().assign().fixWithRetest(2);
  const sentBack = new Story("b", "BAR-0003", "2026-03-01T15:00:00Z").triage().assign().fixWithRetest(2).verdict(3, "not_fixed");
  const reopened = new Story("r", "BAR-0004", "2026-03-01T15:00:00Z").triage().assign().fixWithRetest(2).verdict(3, "fixed")
    .move(9, "reopened", "assigned", { reason: "It broke again." });
  const closedAfterFix = new Story("c", "BAR-0005", "2026-03-01T15:00:00Z").triage().assign().move(2, "fix_logged", "fixed_unverified")
    .move(3, "closed", "closed", { reason: "no_action_possible" });
  const stopped = new Story("s", "BAR-0006", "2026-03-01T15:00:00Z").triage().assign().fixWithRetest(2)
    .move(20, "retest_expired", "fixed_unverified", { reason: "reporter_unreachable", afterDays: 18, round: 1 });
  const cantCheck = new Story("k", "BAR-0007", "2026-03-01T15:00:00Z").triage().assign().fixWithRetest(2).verdict(3, "cant_check");
  const noFix = new Story("n", "BAR-0008", "2026-03-01T15:00:00Z").triage().assign();
  const closedBeforeFix = new Story("x", "BAR-0009", "2026-03-01T15:00:00Z").triage().move(1, "closed", "closed", { reason: "duplicate" });
  const cases = [verified, waiting, sentBack, reopened, closedAfterFix, stopped, cantCheck, noFix, closedBeforeFix].map((s) => s.case);
  const input = { cases, period: YEAR, now: NOW };

  it("counts 1 verified of 7 logged fixes; closing or stopping the wait after a fix never raises the rate", () => {
    const v = verifiedFixRate(input);
    expect(ids(v.fixLogged)).toEqual(["b", "c", "k", "r", "s", "v", "w"]);
    expect(ids(v.verified)).toEqual(["v"]);
    expect(ids(v.notVerified)).toEqual(["b", "c", "k", "r", "s", "w"]);
    expect(ids(v.waiting)).toEqual(["w"]);
    expect(ids(v.fixedUnverified)).toEqual(["k", "s"]);
    expect(ids(v.backInProgress)).toEqual(["b", "r"]); // sent back, and reopened after it was verified (D4)
    expect(ids(v.closedAfterFix)).toEqual(["c"]);
    expect(v.rate).toBeCloseTo(1 / 7);
    // the parts add up to the denominator
    expect(v.verified.count + v.verifiedStaffRelayed.count + v.notVerified.count).toBe(v.fixLogged.count);
    expect(v.waiting.count + v.fixedUnverified.count + v.backInProgress.count + v.closedAfterFix.count).toBe(v.notVerified.count);
  });

  it("is the funnel's \"Fix logged\" stage, and every part's inbox filter selects exactly its cases", () => {
    const m = computeDashboardMetrics(input);
    expect(ids(m.verifiedFixRate.fixLogged)).toEqual(ids(m.funnel.fixLogged));
    expect(m.verifiedFixRate.fixLogged.filter).toEqual(m.funnel.fixLogged.filter);
    const v = m.verifiedFixRate;
    for (const set of [v.verified, v.verifiedStaffRelayed, v.notVerified, v.waiting, v.fixedUnverified, v.backInProgress, v.closedAfterFix, v.fixLogged]) {
      expect(applyInboxFilter(cases, set.filter, NOW).sort()).toEqual(ids(set));
      expect(applyInboxFilter(cases, parseInboxFilter(new URLSearchParams(inboxHref(set.filter).split("?")[1] ?? "")), NOW).sort()).toEqual(ids(set));
    }
  });

  it("a reopened verified case leaves the numerator from the reopen on (D4), and its verified date with it", () => {
    const r = replayCase(reopened.case);
    expect(r.status).toBe("assigned");
    expect(r.verifiedAt).toBeNull();
    const cut = { ...reopened.case, events: reopened.events.slice(0, -1) }; // a report frozen before the reopen
    expect(replayCase(cut).status).toBe("verified");
    expect(ids(verifiedFixRate({ cases: [cut], period: YEAR, now: NOW }).verified)).toEqual(["r"]);
    expect(medianDaysToVerifiedFix(input).cases.caseIds).toEqual(["v"]);
  });
});

describe("D6: submissions closed as not accessibility feedback", () => {
  const spam = new Story("s", "BAR-0001", "2026-06-01T15:00:00Z").move(1, "closed", "closed", { reason: "spam" });
  const spamTriaged = new Story("t", "BAR-0002", "2026-06-02T15:00:00Z").triage().move(1, "closed", "closed", { reason: "spam" });
  const oldSpam = new Story("o", "BAR-0003", "2025-06-01T15:00:00Z").move(1, "closed", "closed", { reason: "spam" });
  const outOfScope = new Story("x", "BAR-0004", "2026-06-01T15:00:00Z").move(1, "closed", "closed", { reason: "out_of_scope" });
  const reopenedSpam = new Story("r", "BAR-0005", "2026-06-01T15:00:00Z").move(1, "closed", "closed", { reason: "spam" })
    .move(2, "reopened", "new", { reason: "Real feedback after all." });
  const cases = [spam, spamTriaged, oldSpam, outOfScope, reopenedSpam].map((s) => s.case);
  const input = { cases, period: YEAR, now: NOW };

  it("counts the period's spam closes with their cases; out of scope is feedback; a reopened one is feedback again", () => {
    const n = notFeedback(input);
    expect(ids(n)).toEqual(["s", "t"]);
    expect(n.filter).toEqual({ from: "2026-01-01", to: "2026-12-31", notFeedback: "yes" });
    expect(ids(totalReceived(input).total)).toEqual(["r", "x"]);
    expect(replayCase(reopenedSpam.case).closedReason).toBeNull();
  });

  it("the inbox filter selects exactly them (the period alone never does), and survives the URL", () => {
    const n = notFeedback(input);
    expect(applyInboxFilter(cases, n.filter, NOW).sort()).toEqual(["s", "t"]);
    expect(applyInboxFilter(cases, { from: "2026-01-01", to: "2026-12-31" }, NOW).sort()).toEqual(["r", "x"]);
    expect(applyInboxFilter(cases, { notFeedback: "yes" }, NOW).sort()).toEqual(["o", "s", "t"]); // no period: every year
    expect(inboxHref(n.filter)).toBe("/app/inbox?from=2026-01-01&to=2026-12-31&notFeedback=yes");
    expect(parseInboxFilter(new URLSearchParams("from=2026-01-01&to=2026-12-31&notFeedback=yes"))).toEqual(n.filter);
    expect(parseInboxFilter(new URLSearchParams("notFeedback=no"))).toEqual({});
    expect(describeInboxFilter(n.filter)).toEqual([
      "Received Jan 1, 2026 to Dec 31, 2026",
      "Closed as not accessibility feedback (not counted as feedback received)",
    ]);
    expect(computeDashboardMetrics(input).notFeedback.caseIds).toEqual(n.caseIds);
  });
});

describe("D2: a retriage replays like a triage", () => {
  it("the latest triaged event sets the area and summary; the first one stays the triage time", () => {
    const s = new Story("a", "BAR-0001", "2026-04-01T15:00:00Z").triage(0, "built_environment").assign(1)
      .move(3, "triaged", "assigned", { priorityArea: "ict", publicSummary: "The booking site timed out.", retriage: true, changed: ["priorityArea", "publicSummary"] });
    const r = replayCase(s.case);
    expect(r.status).toBe("assigned");
    expect(r.priorityArea).toBe("ict");
    expect(r.publicSummary).toBe("The booking site timed out.");
    expect(r.triagedAt?.getTime()).toBe(s.events.find((e) => e.type === "triaged")!.createdAt.getTime());
    expect(r.assignedSince?.getTime()).toBe(s.events.find((e) => e.type === "assigned")!.createdAt.getTime());
  });
});

describe("reporter-correction rate (domain §10)", () => {
  it("counts only claude-cli and api summaries the reporter reviewed; edits and own words are corrections", () => {
    const mk = (id: string, backend: string, summarySource: string) =>
      new Story(id, `BAR-000${id}`, "2026-05-01T15:00:00Z", { ai: { backend, summarySource } }).case;
    const cases = [
      mk("1", "claude-cli", "ai_confirmed"),
      mk("2", "api", "ai_edited"),
      mk("3", "api", "reporter_words"),
      mk("4", "api", "staff"), // staff-logged: nobody who reported it saw the summary
      mk("5", "fake", "ai_edited"),
      mk("6", "seed", "ai_confirmed"),
    ];
    const r = reporterCorrectionRate({ cases, period: YEAR, now: NOW });
    expect(r.kind).toBe("measured");
    expect(ids(r.reviewed)).toEqual(["1", "2", "3"]);
    expect(ids(r.corrected)).toEqual(["2", "3"]);
    expect(r.rate).toBeCloseTo(2 / 3);
    expect(applyInboxFilter(cases, r.corrected.filter, NOW).sort()).toEqual(["2", "3"]);
  });

  it("with only fake or seed summaries it says \"No real-AI summaries yet\" with a count of 0", () => {
    const c = new Story("1", "BAR-0001", "2026-05-01T15:00:00Z", { ai: { backend: "fake", summarySource: "ai_edited" } }).case;
    const r = reporterCorrectionRate({ cases: [c], period: YEAR, now: NOW });
    expect(r).toMatchObject({ kind: "no_real_ai_yet", count: 0, rate: null, label: "No real-AI summaries yet" });
  });
});

describe("re-test response rate", () => {
  it("counts rounds: opt-out during a re-test is an answer, expiry is not; an opt-out with no open re-test adds nothing", () => {
    const optOut = new Story("o", "BAR-0001", "2026-04-01T15:00:00Z").triage().assign().fixWithRetest(2).move(3, "opted_out", "fixed_unverified");
    const expired = new Story("e", "BAR-0002", "2026-04-01T15:00:00Z").triage().assign().fixWithRetest(2)
      .move(70, "retest_expired", "fixed_unverified", { afterDays: 60 });
    const twoRounds = new Story("t", "BAR-0003", "2026-04-01T15:00:00Z").triage().assign().fixWithRetest(2).verdict(3, "not_fixed")
      .fixWithRetest(9, 2).verdict(10, "fixed", 2);
    const quiet = new Story("q", "BAR-0004", "2026-04-01T15:00:00Z").triage().move(2, "opted_out", "triaged");
    const cases = [optOut.case, expired.case, twoRounds.case, quiet.case];
    const r = retestResponseRate({ cases, period: YEAR, now: NOW });
    expect([r.answered.rounds, r.requested.rounds]).toEqual([3, 4]);
    expect(ids(r.unanswered)).toEqual(["e"]);
    expect([r.sentBack.rounds, ...ids(r.sentBack)]).toEqual([1, "t"]);
    expect(applyInboxFilter(cases, r.requested.filter, NOW).sort()).toEqual(["e", "o", "t"]);
  });
});

describe("the period: received dates in the display time zone, spam not counted", () => {
  it("a case received Dec 31 evening in Toronto (Jan 1 UTC) belongs to the old year", () => {
    const edge = new Story("x", "BAR-0001", "2026-01-01T03:00:00Z");
    const inside = new Story("y", "BAR-0002", "2026-01-01T06:00:00Z");
    const t = totalReceived({ cases: [edge.case, inside.case], period: YEAR, now: NOW });
    expect(ids(t.total)).toEqual(["y"]);
  });

  it("spam is not feedback received: left out of every period number and of the period filter, but still in the plain inbox", () => {
    const spam = new Story("s", "BAR-0001", "2026-06-01T15:00:00Z", { channel: "email", anonymous: false })
      .move(1, "closed", "closed", { reason: "spam" });
    const dup = new Story("d", "BAR-0002", "2026-06-01T15:00:00Z").approve().move(1, "closed", "closed", { reason: "duplicate" });
    const cases = [spam.case, dup.case];
    const m = computeDashboardMetrics({ cases, period: YEAR, now: NOW });
    expect(ids(m.total.total)).toEqual(["d"]);
    expect(ids(m.statuses.closed)).toEqual(["d"]);
    expect(m.acknowledgement.required.count).toBe(0);
    expect(m.needsAttention.items).toEqual([]); // spam never needs attention, even unacknowledged
    expect(applyInboxFilter(cases, m.statuses.closed.filter, NOW)).toEqual(["d"]);
    expect(applyInboxFilter(cases, { status: ["closed"] }, NOW).sort()).toEqual(["d", "s"]);
  });

  it("per-month rows run from the period's first month to today at the latest", () => {
    expect(periodMonths(YEAR, NOW)).toHaveLength(10);
    expect(periodMonths({ start: "2025-11-15", end: "2026-02-10" }, NOW)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(periodMonths({ start: "2027-01-01", end: "2027-12-31" }, NOW)).toEqual([]);
  });
});

describe("acknowledgement (ACR s.9(4))", () => {
  it("counts only an acknowledgement in the same means; a staff-recorded day counts from that day", () => {
    const phone = new Story("p", "BAR-0001", "2026-03-02T15:00:00Z", { channel: "phone", anonymous: false })
      .add(3, "ack_recorded", { channel: "phone", manual: true, on: "2026-03-03" });
    const wrong = new Story("w", "BAR-0002", "2026-03-02T15:00:00Z", { channel: "mail", anonymous: false })
      .add(1, "ack_recorded", { channel: "email", manual: true });
    const anon = new Story("a", "BAR-0003", "2026-03-02T15:00:00Z", { channel: "in_person", anonymous: true });
    const webNamed = new Story("n", "BAR-0004", "2026-03-02T15:00:00Z", { channel: "web", anonymous: false });
    const cases = [phone.case, wrong.case, anon.case, webNamed.case];
    const a = acknowledgementCompliance({ cases, period: YEAR, now: NOW });
    expect(ids(a.required)).toEqual(["n", "p", "w"]);
    expect(ids(a.acknowledged)).toEqual(["n", "p"]);
    expect(ids(a.missing)).toEqual(["w"]);
    // phone: received Mar 2 10:00 Toronto, acknowledged at noon Mar 3 = 26 h; web: on screen at once = 0 h
    expect(a.medianHours).toBe(13);
    const n = needsAttention({ cases, now: NOW });
    expect(n.items.map((i) => [i.ref, i.reason])).toEqual([
      ["BAR-0001", "redaction"], ["BAR-0002", "redaction"], ["BAR-0003", "redaction"], ["BAR-0004", "redaction"],
      ["BAR-0002", "unacknowledged"],
    ]);
  });

  it("Phase 7 honesty: counts the acknowledgements recorded more than 7 days after the date they give (they still count as acknowledged)", () => {
    // Received Mar 2. The day typed vs the day the record was written (Story days from Mar 2 10:00 Toronto).
    const ackOn = (id: string, on: string, writtenAfter: number, sub: { anonymous?: boolean; channel?: string } = {}) =>
      new Story(id, `BAR-${id}`, "2026-03-02T15:00:00Z", { channel: sub.channel ?? "phone", anonymous: sub.anonymous ?? false })
        .add(writtenAfter, "ack_recorded", { channel: sub.channel ?? "phone", manual: true, on });
    const prompt = ackOn("p1", "2026-03-02", 0); // the same day
    const seven = ackOn("p7", "2026-03-02", 7); // written 7 days later: not late
    const eight = ackOn("p8", "2026-03-02", 8); // 8 days later: late
    const lateAnon = ackOn("pa", "2026-03-02", 20, { anonymous: true }); // anonymous: needs no acknowledgement
    const emailed = new Story("em", "BAR-em", "2026-03-02T15:00:00Z", { channel: "email", anonymous: false })
      .add(30, "ack_recorded", { channel: "email", messageId: "m1" }); // AccessLoop's own email: no typed date
    const web = new Story("wb", "BAR-wb", "2026-03-02T15:00:00Z", { channel: "web", anonymous: false });
    const cases = [prompt, seven, eight, lateAnon, emailed, web].map((s) => s.case);
    const a = acknowledgementCompliance({ cases, period: YEAR, now: NOW });
    expect(ids(a.acknowledged)).toEqual(["em", "p1", "p7", "p8", "wb"]);
    expect(ids(a.recordedLate)).toEqual(["p8"]);
    expect(a.recordedLate.filter).toEqual({ from: "2026-01-01", to: "2026-12-31", anonymous: "no", ack: "late" });
    expect(applyInboxFilter(cases, a.recordedLate.filter, NOW)).toEqual(["p8"]);
    expect(applyInboxFilter(cases, { ack: "late" }, NOW).sort()).toEqual(["p8", "pa"]); // no anonymous key: every case
    expect(inboxHref(a.recordedLate.filter)).toBe("/app/inbox?from=2026-01-01&to=2026-12-31&anonymous=no&ack=late");
    expect(parseInboxFilter(new URLSearchParams("ack=late"))).toEqual({ ack: "late" });
    expect(parseInboxFilter(new URLSearchParams("ack=later"))).toEqual({});
    expect(describeInboxFilter({ ack: "late" })).toEqual(["Acknowledgement recorded more than 7 days after the date it gives"]);
    // The typed day still dates the acknowledgement (F_ACK hours): the record's lateness is said, not hidden.
    expect(replayCase(eight.case).ackInIntakeChannelAt?.toISOString()).toBe(zonedNoon("2026-03-02").toISOString());
    expect(computeDashboardMetrics({ cases, period: YEAR, now: NOW }).acknowledgement.recordedLate.count).toBe(1);
  });
});

describe("needs attention thresholds", () => {
  it("re-test open more than 14 days; assigned 30 days or more with no fix", () => {
    const at = (days: number) => new Date(NOW.getTime() - days * DAY);
    const retest = (id: string, ago: number): MetricCase => {
      const s = new Story(id, `BAR-${id}`, "2026-08-01T15:00:00Z").triage().assign();
      s.events.push(
        { seq: s.events.length + 1, type: "fix_logged", payload: { from: "assigned", to: "retest_open" }, createdAt: at(ago) },
        { seq: s.events.length + 2, type: "retest_requested", payload: { round: 1 }, createdAt: at(ago) },
      );
      return s.case;
    };
    const assigned = (id: string, ago: number): MetricCase => {
      const s = new Story(id, `BAR-${id}`, "2026-08-01T15:00:00Z").triage();
      s.events.push({ seq: s.events.length + 1, type: "assigned", payload: { from: "triaged", to: "assigned" }, createdAt: at(ago) });
      return s.case;
    };
    const n = needsAttention({ cases: [retest("1", 14), retest("2", 15), assigned("3", 29), assigned("4", 30)], now: NOW });
    expect(n.items.map((i) => [i.ref, i.reason, i.days])).toEqual([["BAR-2", "retest", 15], ["BAR-4", "stalled", 30]]);
  });
});

describe("median days", () => {
  it("averages the two middle values for an even count", () => {
    const v = (id: string, d: number) => new Story(id, `BAR-${id}`, "2026-02-01T15:00:00Z").triage().assign().fixWithRetest(1).verdict(d, "fixed").case;
    expect(medianDaysToVerifiedFix({ cases: [v("1", 4), v("2", 9)], period: YEAR, now: NOW }).days).toBe(6.5);
  });
});

describe("parseInboxFilter (zod; unknown values ignored)", () => {
  it("keeps valid values in a fixed order, drops the rest, and reads repeated or comma-separated values", () => {
    const f = parseInboxFilter(new URLSearchParams(
      "status=verified&status=nope&status=new,triaged&area=ict&area=mars&channel=email&month=2026-13&verifiedMonth=2026-03" +
      "&attention=retest&stage=assigned&anonymous=maybe&ack=no&retest=answered&code=staff&ai=corrected&org=other&from=2026-01-01",
    ));
    expect(f).toEqual({
      status: ["new", "triaged", "verified"],
      area: ["ict"],
      channel: ["email"],
      verifiedMonth: "2026-03",
      attention: ["retest"],
      stage: "assigned",
      ack: "no",
      retest: "answered",
      code: "staff",
      ai: "corrected",
    });
  });

  it("takes the period only when both dates are real and in order", () => {
    expect(parseInboxFilter({ from: "2026-01-01", to: "2026-12-31" })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(parseInboxFilter({ from: "2026-12-31", to: "2026-01-01" })).toEqual({});
    expect(parseInboxFilter({ from: "2026-02-30", to: "2026-03-01" })).toEqual({});
    expect(parseInboxFilter({ to: "2026-03-01" })).toEqual({});
    expect(parseInboxFilter({ status: ["closed", "closed"], area: undefined })).toEqual({ status: ["closed"] });
  });

  it("an empty or all-invalid query is no filter", () => {
    expect(isFilterActive(parseInboxFilter(new URLSearchParams("")))).toBe(false);
    expect(isFilterActive(parseInboxFilter({ status: "x", month: "may" }))).toBe(false);
    expect(inboxHref({})).toBe("/app/inbox");
  });

  it("writes keys in a fixed order with repeated list values", () => {
    expect(inboxHref({ status: ["new", "triaged"], from: "2026-01-01", to: "2026-12-31", area: ["none"] })).toBe(
      "/app/inbox?from=2026-01-01&to=2026-12-31&status=new&status=triaged&area=none",
    );
  });

  it("describes every active filter in plain words", () => {
    expect(describeInboxFilter({ from: "2026-01-01", to: "2026-12-31", status: ["new", "triaged", "retest_open"], area: ["none"],
      channel: ["in_person"], month: "2026-03", attention: ["stalled"] })).toEqual([
      "Received Jan 1, 2026 to Dec 31, 2026 (spam not counted)",
      "Received in March 2026",
      "Status: New, Triaged or Waiting for the reporter to check",
      "Area: Not classified yet",
      "Came in by: In person",
      "Needs attention: assigned for 30 days or more with no fix logged",
    ]);
  });
});

describe("periods", () => {
  it("this year, the last 90 days (today included) and custom ranges", () => {
    expect(YEAR).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    const l90 = last90Days(NOW);
    expect(l90).toEqual({ start: "2026-07-22", end: "2026-10-19" });
    expect(daysBetween(l90.start, l90.end)).toBe(89);
    expect(customPeriod("2026-03-01", "2026-02-01")).toBeNull();
    expect(customPeriod("2026-02-01", "2026-03-01")).toEqual({ start: "2026-02-01", end: "2026-03-01" });
    expect(periodLabel(YEAR)).toBe("Jan 1, 2026 to Dec 31, 2026");
    expect(monthLabel("2026-08")).toBe("August 2026");
  });
});
