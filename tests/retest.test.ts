// lib/retest.ts: the five answers (domain §3), what each asks the state machine to do, the sentences shown and
// announced after an answer, and how long a receipt code keeps working (domain §4).
import { describe, expect, it } from "vitest";
import {
  RETEST_ANSWERS,
  RETEST_COMMENT_ECHO_MAX,
  RETEST_COMMENT_MAX,
  RETEST_RESULT_MESSAGES,
  canStopContact,
  receiptExpired,
  retestAction,
  retestFieldError,
  retestOutcome,
} from "@/lib/retest";
import { plan, type CaseRow } from "@/lib/state-machine";
import { CASE_STATUSES } from "@/lib/status";

const DAY = 86_400_000;
const NOW = new Date("2026-10-19T12:00:00.000Z");

describe("the re-test answers", () => {
  it("are exactly the five of domain §3, in order", () => {
    expect(RETEST_ANSWERS.map((a) => a.label)).toEqual([
      "Yes, it works now",
      "Partly",
      "No, still a barrier",
      "I can't check right now",
      "Don't contact me about this again",
    ]);
  });

  it("map onto the frozen state machine: verdicts, and the opt-out", () => {
    expect(retestAction("fixed", "It works")).toEqual({ kind: "verdict", verdict: "fixed", comment: "It works" });
    expect(retestAction("partly")).toEqual({ kind: "verdict", verdict: "partly", comment: undefined });
    expect(retestAction("not_fixed", "")).toEqual({ kind: "verdict", verdict: "not_fixed", comment: undefined });
    expect(retestAction("cant_check")).toMatchObject({ kind: "verdict", verdict: "cant_check" });
    expect(retestAction("opt_out", "please stop")).toEqual({ kind: "opt_out" });
  });

  it("lead to the statuses of domain §3 when a re-test is open", () => {
    const c = { status: "retest_open", retestRound: 1, wantsRetest: true, assignedTo: null } as unknown as CaseRow;
    const ctx = { hasApprovedRedaction: true, assigneeRole: null, lastRetestRequestedAt: null, now: NOW };
    const to = (a: (typeof RETEST_ANSWERS)[number]["value"]) =>
      plan(c, retestAction(a), { kind: "reporter", via: "receipt_code" }, ctx).to;
    expect(to("fixed")).toBe("verified");
    expect(to("partly")).toBe("assigned");
    expect(to("not_fixed")).toBe("assigned");
    expect(to("cant_check")).toBe("fixed_unverified");
    expect(to("opt_out")).toBe("fixed_unverified");
  });
});

describe("the sentence after an answer", () => {
  it("says the domain §3 confirmation sentence verbatim for 'fixed'", () => {
    expect(RETEST_RESULT_MESSAGES.fixed).toBe("Thank you. It's now marked as fixed and confirmed by you.");
    expect(retestOutcome({ kind: "answered", answer: "fixed", at: 1 })).toEqual({
      title: "Your answer is saved",
      message: "Thank you. It's now marked as fixed and confirmed by you.",
      tone: "success",
    });
  });

  it("has a plain sentence for every other answer", () => {
    expect(RETEST_RESULT_MESSAGES.not_fixed).toContain("We'll tell the team it still needs work.");
    expect(RETEST_RESULT_MESSAGES.cant_check).toBe("That's fine. We've marked it as fixed but not checked by you.");
    expect(RETEST_RESULT_MESSAGES.opt_out).toBe("We won't contact you about this report again.");
    expect(RETEST_RESULT_MESSAGES.partly).toMatch(/partly works/);
    for (const a of RETEST_ANSWERS) {
      const o = retestOutcome({ kind: "answered", answer: a.value, at: 1 });
      expect(o?.message).toBe(RETEST_RESULT_MESSAGES[a.value]);
      // Only the reporter's "yes" may say "confirmed by you".
      if (a.value !== "fixed") expect(o?.message).not.toMatch(/confirmed by you/);
    }
  });

  it("is calm for every problem, and 'choose' is a field error instead", () => {
    const at = 1;
    expect(retestOutcome({ kind: "problem", problem: "already_answered", at })?.message).toMatch(/^This question is already answered/);
    expect(retestOutcome({ kind: "problem", problem: "rate_limited", at })?.message).toBe(
      "Too many tries from this connection. Please wait a few minutes and try again.",
    );
    expect(retestOutcome({ kind: "problem", problem: "failed", at })?.tone).toBe("danger");
    expect(retestOutcome({ kind: "problem", problem: "not_found", at })).not.toBeNull();
    expect(retestOutcome({ kind: "problem", problem: "choose", at })).toBeNull();
    expect(retestOutcome({ kind: "problem", problem: "comment_too_long", at })).toBeNull();
    expect(retestOutcome({ kind: "idle" })).toBeNull();
  });

  it("puts 'choose' on the question and a too-long comment on the comment field, never silently cut", () => {
    const at = 1;
    expect(retestFieldError({ kind: "problem", problem: "choose", at })).toEqual({ field: "answer", message: "Choose one answer." });
    expect(retestFieldError({ kind: "problem", problem: "comment_too_long", at })).toEqual({
      field: "comment",
      message: "Keep your comment under 1,000 characters.",
    });
    for (const problem of ["rate_limited", "already_answered", "not_found", "failed"] as const) {
      expect(retestFieldError({ kind: "problem", problem, at })).toBeNull();
    }
    expect(retestFieldError({ kind: "answered", answer: "fixed", at })).toBeNull();
    expect(retestFieldError({ kind: "idle" })).toBeNull();
    // A too-long comment comes back to the form whole enough to shorten it in place.
    expect(RETEST_COMMENT_ECHO_MAX).toBeGreaterThanOrEqual(RETEST_COMMENT_MAX * 10);
  });
});

describe("receipt code lifetime (domain §4: terminal plus 30 days)", () => {
  it("works until 30 days after the case is verified or closed", () => {
    expect(receiptExpired("verified", new Date(NOW.getTime() - 29 * DAY), NOW)).toBe(false);
    expect(receiptExpired("verified", new Date(NOW.getTime() - 30 * DAY), NOW)).toBe(false);
    expect(receiptExpired("verified", new Date(NOW.getTime() - 31 * DAY), NOW)).toBe(true);
    expect(receiptExpired("closed", new Date(NOW.getTime() - 40 * DAY), NOW)).toBe(true);
  });

  it("never expires while the case is open, however old", () => {
    for (const s of CASE_STATUSES.filter((x) => x !== "verified" && x !== "closed")) {
      expect(receiptExpired(s, new Date(NOW.getTime() - 400 * DAY), NOW)).toBe(false);
    }
    expect(receiptExpired("closed", null, NOW)).toBe(false);
  });
});

describe("Stop contact", () => {
  it("is offered only when the reporter can still be asked, outside an open question", () => {
    expect(canStopContact("new", true)).toBe(true);
    expect(canStopContact("assigned", true)).toBe(true);
    expect(canStopContact("fixed_unverified", true)).toBe(true);
    expect(canStopContact("retest_open", true)).toBe(false); // the question has its own "Don't contact me"
    expect(canStopContact("verified", true)).toBe(false);
    expect(canStopContact("closed", true)).toBe(false);
    expect(canStopContact("assigned", false)).toBe(false);
  });
});
