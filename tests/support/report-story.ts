// Test-only: builds a case's event chain the way createCase()/transition() write it (from/to on status events,
// retest_requested after a fix with a re-test), with a stand-in hash on every event, so the pure report code
// (facts, snapshot, claims, replay) can be tested without a database. The seeded-PGlite tests use real chains.
import type { MetricCase, MetricEvent } from "@/lib/metrics";

const DAY = 86_400_000;

export class Story {
  readonly events: MetricEvent[] = [];
  private status = "new";
  private readonly t0: number;
  constructor(
    readonly id: string,
    readonly ref: string,
    received: string, // ISO instant
    sub: { channel?: string; anonymous?: boolean; relayed?: boolean } = {},
  ) {
    this.t0 = new Date(received).getTime();
    const channel = sub.channel ?? "web";
    const anonymous = sub.anonymous ?? true;
    this.add(0, "submitted", { channel, isAnonymous: anonymous, codeRelayedByStaff: !!sub.relayed });
    if (channel === "web") this.add(0, "ack_recorded", { channel: "web_screen", anonymous });
  }
  get case(): MetricCase {
    return { id: this.id, ref: this.ref, events: this.events.map((e) => ({ ...e })) };
  }
  add(days: number, type: string, payload: Record<string, unknown> = {}) {
    const seq = this.events.length + 1;
    this.events.push({ seq, type, payload, createdAt: new Date(this.t0 + days * DAY + seq), hash: `${this.id}-h${seq}`.padEnd(64, "0") });
    return this;
  }
  move(days: number, type: string, to: string, payload: Record<string, unknown> = {}) {
    this.add(days, type, { ...payload, from: this.status, to });
    this.status = to;
    return this;
  }
  ack(days: number, channel: string) {
    return this.add(days, "ack_recorded", { channel, manual: true });
  }
  triage(days = 0, area = "ict", publicSummary = "A barrier was reported.") {
    this.add(days, "redaction_approved", { spans: [] });
    return this.move(days, "triaged", "triaged", { priorityArea: area, publicSummary });
  }
  assign(days = 1) {
    return this.move(days, "assigned", "assigned", { memberId: "m1" });
  }
  fixWithRetest(days: number, round = 1) {
    this.move(days, "fix_logged", "retest_open", { retestRound: round });
    return this.add(days, "retest_requested", { round });
  }
  fixNoRetest(days: number) {
    return this.move(days, "fix_logged", "fixed_unverified", { retestRound: 0 });
  }
  verdict(days: number, verdict: "fixed" | "partly" | "not_fixed" | "cant_check", round = 1) {
    const to = verdict === "fixed" ? "verified" : verdict === "cant_check" ? "fixed_unverified" : "assigned";
    return this.move(days, "retest_verdict", to, { verdict, round, via: "receipt_code" });
  }
  close(days: number, reason: string) {
    return this.move(days, "closed", "closed", { reason });
  }
}

export const caseId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ref = (n: number) => `BAR-${String(n).padStart(4, "0")}`;
