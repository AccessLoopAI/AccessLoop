// lib/state-machine.ts (frozen): every row of the docs/domain.md §3 transition table through the pure plan(),
// plus the moves the table does not allow, including the Phase 7 rows (D1 close reasons by status, D2 retriage,
// D3 stop_waiting, D4 reopen from verified and closed). transition() on a real database is covered in
// tests/case-events.test.ts and tests/state-machine.db.test.ts.
import { describe, expect, it } from "vitest";
import {
  CLOSE_REASONS_BY_STATUS,
  MAX_RETEST_ROUNDS,
  RETEST_EXPIRY_DAYS,
  STOP_WAITING_DAYS,
  TransitionError,
  closeReasonsFor,
  plan,
  reopenTarget,
  workStartedFrom,
  type Action,
  type Actor,
  type CaseRow,
  type CaseStatus,
  type PlanContext,
} from "@/lib/state-machine";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_OWNER_ID = "44444444-4444-4444-8444-444444444444";
const AUDITOR_ID = "55555555-5555-4555-8555-555555555555";

const lead: Actor = { kind: "staff", memberId: LEAD_ID, role: "lead" };
const owner: Actor = { kind: "staff", memberId: OWNER_ID, role: "owner" };
const otherOwner: Actor = { kind: "staff", memberId: OTHER_OWNER_ID, role: "owner" };
const auditor: Actor = { kind: "staff", memberId: AUDITOR_ID, role: "auditor" };
const reporter: Actor = { kind: "reporter", via: "receipt_code" };
const system: Actor = { kind: "system" };
const ALL_ACTORS: [string, Actor][] = [
  ["lead", lead], ["owner", owner], ["other owner", otherOwner], ["auditor", auditor], ["reporter", reporter], ["system", system],
];

const ALL_STATUSES: CaseStatus[] = ["new", "triaged", "assigned", "retest_open", "verified", "fixed_unverified", "closed"];
const CLOSE_REASONS = ["duplicate", "out_of_scope", "spam", "no_action_possible"] as const;
const DAY = 86_400_000;
const NOW = new Date("2026-10-19T15:00:00.000Z");

function caseRow(overrides: Partial<CaseRow> = {}): CaseRow {
  const at = new Date("2026-09-01T14:00:00.000Z");
  return {
    id: "66666666-6666-4666-8666-666666666666",
    orgId: ORG,
    seq: 17,
    ref: "BAR-0017",
    status: "new",
    intakeChannel: "web",
    locationKind: "place",
    locationDetail: "King Street branch, main entrance",
    isAnonymous: true,
    wantsRetest: true,
    aiOptOut: false,
    needsManualRedaction: false,
    redactedText: "Hi, my name is [PERSON]. The automatic door button is broken. Call me at [PHONE].",
    aiSummary: "The automatic door button at a branch entrance has been broken.",
    summary: "The automatic door button at a branch entrance has been broken.",
    summarySource: "ai_confirmed",
    aiPriorityAreas: [{ area: "built_environment", confidence: 0.93 }],
    priorityArea: null,
    publicSummary: null,
    assignedTo: null,
    dueAt: null,
    retestRound: 0,
    closedReason: null,
    receiptCodeHash: "a".repeat(64),
    receivedAt: at,
    ackAt: at,
    redactionApprovedAt: null,
    verifiedAt: null,
    retentionUntil: "2033-09-01",
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function ctx(overrides: Partial<PlanContext> = {}): PlanContext {
  return { hasApprovedRedaction: true, assigneeRole: null, lastRetestRequestedAt: null, now: NOW, ...overrides };
}

/** A case in `status` with the fields that status implies (assigned to OWNER_ID from "assigned" on). */
function inStatus(status: CaseStatus, overrides: Partial<CaseRow> = {}): CaseRow {
  const triaged = status !== "new";
  const assigned = ["assigned", "retest_open", "verified", "fixed_unverified"].includes(status);
  return caseRow({
    status,
    priorityArea: triaged ? "built_environment" : null,
    publicSummary: triaged ? "The automatic door button at a branch entrance was broken." : null,
    assignedTo: assigned ? OWNER_ID : null,
    retestRound: status === "retest_open" || status === "verified" ? 1 : 0,
    closedReason: status === "closed" ? "duplicate" : null,
    ...overrides,
  });
}

const TRIAGE: Action = { kind: "triage", priorityArea: "built_environment", publicSummary: "The door button was broken." };
const RETRIAGE: Action = { kind: "retriage", priorityArea: "ict", reason: "It was the booking website, not the door." };
const BEFORE_WORK = ["new", "triaged"] as const;
const AFTER_WORK = ["assigned", "fixed_unverified"] as const;

/** Every action shape, for the "who can do what" sweeps. */
const ALL_ACTIONS: Action[] = [
  TRIAGE,
  { kind: "assign", memberId: OWNER_ID },
  { kind: "log_fix", description: "Replaced the motor." },
  { kind: "verdict", verdict: "fixed" },
  { kind: "verdict", verdict: "partly" },
  { kind: "verdict", verdict: "not_fixed" },
  { kind: "verdict", verdict: "cant_check" },
  { kind: "opt_out" },
  { kind: "expire_retest" },
  { kind: "stop_waiting" },
  RETRIAGE,
  { kind: "reopen", reason: "Still broken." },
  ...CLOSE_REASONS.map((reason): Action => ({ kind: "close", reason })),
];

const expectDenied = (c: CaseRow, action: Action, actor: Actor, context: PlanContext = ctx(), why?: RegExp) => {
  expect(() => plan(c, action, actor, context)).toThrow(TransitionError);
  if (why) expect(() => plan(c, action, actor, context)).toThrow(why);
};

describe("constants", () => {
  it("match the domain: 2 re-test rounds, 60-day expiry, stop waiting after 14 days", () => {
    expect(MAX_RETEST_ROUNDS).toBe(2);
    expect(RETEST_EXPIRY_DAYS).toBe(60);
    expect(STOP_WAITING_DAYS).toBe(14);
  });

  it("D1: the close reasons by status", () => {
    expect(CLOSE_REASONS_BY_STATUS).toEqual({
      new: ["duplicate", "out_of_scope", "spam", "no_action_possible"],
      triaged: ["duplicate", "out_of_scope", "spam", "no_action_possible"],
      assigned: ["duplicate", "no_action_possible"],
      fixed_unverified: ["duplicate", "no_action_possible"],
    });
    for (const s of ["retest_open", "verified", "closed"] as CaseStatus[]) expect(closeReasonsFor(s)).toEqual([]);
  });

  it("D4: where reopen goes", () => {
    expect(reopenTarget(inStatus("fixed_unverified"))).toBe("assigned");
    expect(reopenTarget(inStatus("verified"))).toBe("assigned");
    expect(reopenTarget(inStatus("closed"))).toBe("triaged");
    expect(reopenTarget(inStatus("closed", { priorityArea: null, publicSummary: null }))).toBe("new");
    for (const s of ["new", "triaged", "assigned", "retest_open"] as CaseStatus[]) expect(reopenTarget(inStatus(s))).toBeNull();
  });
});

describe("new -> triaged (triage; lead; approved redaction, area and public summary)", () => {
  it("moves to triaged and records the area and public summary in the patch and the event", () => {
    const p = plan(inStatus("new"), TRIAGE, lead, ctx());
    expect(p.to).toBe("triaged");
    expect(p.event).toBe("triaged");
    expect(p.patch).toEqual({ priorityArea: "built_environment", publicSummary: "The door button was broken." });
    expect(p.payload).toEqual({ priorityArea: "built_environment", publicSummary: "The door button was broken." });
    expect(p.alsoRequestRetest).toBeFalsy();
  });

  it("trims the public summary", () => {
    const p = plan(inStatus("new"), { ...TRIAGE, publicSummary: "  The door was broken.  " }, lead, ctx());
    expect(p.patch.publicSummary).toBe("The door was broken.");
  });

  it("needs a redaction_approved event first", () => {
    expectDenied(inStatus("new"), TRIAGE, lead, ctx({ hasApprovedRedaction: false }), /redaction not approved/);
  });

  it("needs a non-empty public summary", () => {
    for (const publicSummary of ["", "   ", "\n\t"]) {
      expectDenied(inStatus("new"), { ...TRIAGE, publicSummary }, lead, ctx(), /publicSummary required/);
    }
  });

  it("is for the lead only", () => {
    for (const actor of [owner, auditor, reporter, system]) expectDenied(inStatus("new"), TRIAGE, actor, ctx(), /lead only/);
  });

  it("only from new", () => {
    for (const s of ALL_STATUSES.filter((x) => x !== "new")) expectDenied(inStatus(s), TRIAGE, lead, ctx(), /must be new/);
  });
});

describe("close (lead; D1: any reason from new or triaged, only duplicate or no action possible after that)", () => {
  for (const from of BEFORE_WORK) {
    for (const reason of CLOSE_REASONS) {
      it(`${from} -> closed (${reason})`, () => {
        const p = plan(inStatus(from), { kind: "close", reason, note: "Same as BAR-0003." }, lead, ctx());
        expect(p.to).toBe("closed");
        expect(p.event).toBe("closed");
        expect(p.patch).toEqual({ closedReason: reason });
        expect(p.payload).toEqual({ reason, note: "Same as BAR-0003." });
      });
    }
  }

  for (const from of AFTER_WORK) {
    for (const reason of ["duplicate", "no_action_possible"] as const) {
      it(`${from} -> closed (${reason})`, () => {
        const p = plan(inStatus(from), { kind: "close", reason, note: "Same as BAR-0003." }, lead, ctx());
        expect(p.to).toBe("closed");
        expect(p.patch).toEqual({ closedReason: reason });
        expect(p.payload).toEqual({ reason, note: "Same as BAR-0003." });
      });
    }
    for (const reason of ["spam", "out_of_scope"] as const) {
      it(`D1: ${from} can't be closed as ${reason} (work has started)`, () => {
        expectDenied(inStatus(from), { kind: "close", reason }, lead, ctx(), new RegExp(`close from ${from}: reason ${reason} only before the case is assigned`));
      });
    }
  }

  it("D1: a fixed case closed as spam or out of scope is refused even with a re-test round used", () => {
    for (const reason of ["spam", "out_of_scope"] as const) {
      expectDenied(inStatus("fixed_unverified", { retestRound: 2 }), { kind: "close", reason }, lead, ctx(), /only before the case is assigned/);
    }
  });

  it("D1: a case that was ever assigned or fixed can't be closed as spam or out of scope, even back in triaged (closed, reopened)", () => {
    // The review's gap: assigned or fixed -> closed (duplicate) -> reopen -> triaged -> closed (spam) would drop a
    // logged fix out of every number (D6). transition() counts the assigned / fix_logged events into workStarted.
    for (const from of BEFORE_WORK) {
      for (const reason of ["spam", "out_of_scope"] as const) {
        expectDenied(inStatus(from), { kind: "close", reason }, lead, ctx({ workStarted: true }), /only before the case is assigned/);
      }
      for (const reason of ["duplicate", "no_action_possible"] as const) {
        expect(plan(inStatus(from), { kind: "close", reason }, lead, ctx({ workStarted: true })).to).toBe("closed");
      }
    }
    expect(closeReasonsFor("triaged", true)).toEqual(["duplicate", "no_action_possible"]);
    expect(closeReasonsFor("new", true)).toEqual(["duplicate", "no_action_possible"]);
    expect(closeReasonsFor("triaged", false)).toEqual(CLOSE_REASONS_BY_STATUS.triaged);
    expect(closeReasonsFor("closed", true)).toEqual([]);
    expect(workStartedFrom([{ type: "submitted" }, { type: "triaged" }, { type: "closed" }, { type: "reopened" }])).toBe(false);
    expect(workStartedFrom([{ type: "triaged" }, { type: "assigned" }])).toBe(true);
    expect(workStartedFrom([{ type: "fix_logged" }])).toBe(true);
  });

  it("leaves the note out of the payload when there is none", () => {
    const p = plan(inStatus("new"), { kind: "close", reason: "spam" }, lead, ctx());
    expect(p.payload.note).toBeUndefined();
  });

  it("cannot close a case that is waiting for the reporter, verified or already closed", () => {
    for (const from of ["retest_open", "verified", "closed"] as CaseStatus[]) {
      for (const reason of CLOSE_REASONS) expectDenied(inStatus(from), { kind: "close", reason }, lead, ctx(), /not closable/);
    }
  });

  it("is for the lead only", () => {
    for (const actor of [owner, auditor, reporter, system]) {
      expectDenied(inStatus("new"), { kind: "close", reason: "spam" }, actor, ctx(), /lead only/);
    }
  });
});

describe("close as a duplicate of another case (Phase 7 T2 item 8: the original, found in the same org, is recorded)", () => {
  const ORIGINAL_ID = "77777777-7777-4777-8777-777777777777";
  const original = (over: Partial<NonNullable<PlanContext["duplicateOriginal"]>> = {}) =>
    ctx({ duplicateOriginal: { id: ORIGINAL_ID, ref: "BAR-0003", status: "assigned", closedReason: null, ...over } });
  const dup = (duplicateOf = ORIGINAL_ID): Action => ({ kind: "close", reason: "duplicate", duplicateOf, note: "Same door." });

  it("records the original's id and ref in the closed event, from every closable status", () => {
    for (const from of [...BEFORE_WORK, ...AFTER_WORK]) {
      const p = plan(inStatus(from), dup(), lead, original());
      expect(p.to, from).toBe("closed");
      expect(p.patch).toEqual({ closedReason: "duplicate" });
      expect(p.payload).toEqual({ reason: "duplicate", note: "Same door.", duplicateOf: { caseId: ORIGINAL_ID, ref: "BAR-0003" } });
    }
  });

  it("the original may be in any status but 'closed as a duplicate' (point to the case it repeats instead: no chains)", () => {
    for (const status of ALL_STATUSES) {
      const c = original({ status, closedReason: status === "closed" ? "no_action_possible" : null });
      expect(plan(inStatus("new"), dup(), lead, c).payload.duplicateOf).toEqual({ caseId: ORIGINAL_ID, ref: "BAR-0003" });
    }
    expectDenied(inStatus("new"), dup(), lead, original({ status: "closed", closedReason: "duplicate" }), /itself closed as a duplicate/);
  });

  it("refuses an original transition() did not find in this org (another org's case, an unknown id, a bad id)", () => {
    expectDenied(inStatus("triaged"), dup(), lead, ctx({ duplicateOriginal: null }), /original not found in this org/);
    expectDenied(inStatus("triaged"), dup(), lead, ctx(), /original not found in this org/);
    expectDenied(inStatus("triaged"), dup("88888888-8888-4888-8888-888888888888"), lead, original(), /original not found in this org/);
  });

  it("refuses the case itself as its original", () => {
    const self = inStatus("triaged");
    expectDenied(self, dup(self.id), lead, original({ id: self.id, ref: self.ref }), /can't be a duplicate of itself/);
  });

  it("names an original only for a duplicate", () => {
    for (const reason of ["out_of_scope", "spam", "no_action_possible"] as const) {
      expectDenied(inStatus("new"), { kind: "close", reason, duplicateOf: ORIGINAL_ID }, lead, original(), /duplicateOf only with reason duplicate/);
    }
  });

  it("a duplicate closed without an original still closes (closes logged before Phase 7 and the seed's): the page requires one", () => {
    expect(plan(inStatus("new"), { kind: "close", reason: "duplicate" }, lead, ctx()).payload).toEqual({ reason: "duplicate", note: undefined });
  });
});

describe("triaged/assigned -> assigned (assign; lead; assignee is an owner or lead of this org)", () => {
  for (const from of ["triaged", "assigned"] as CaseStatus[]) {
    for (const role of ["owner", "lead"] as const) {
      it(`${from} -> assigned to a ${role}`, () => {
        const p = plan(inStatus(from), { kind: "assign", memberId: OTHER_OWNER_ID }, lead, ctx({ assigneeRole: role }));
        expect(p.to).toBe("assigned");
        expect(p.event).toBe("assigned");
        expect(p.patch).toEqual({ assignedTo: OTHER_OWNER_ID });
        expect(p.payload).toEqual({ memberId: OTHER_OWNER_ID });
      });
    }
  }

  it("refuses an auditor as assignee", () => {
    expectDenied(inStatus("triaged"), { kind: "assign", memberId: AUDITOR_ID }, lead, ctx({ assigneeRole: "auditor" }), /owner or lead/);
  });

  it("refuses someone who is not a member of this org (another org's member, or unknown)", () => {
    expectDenied(inStatus("triaged"), { kind: "assign", memberId: OTHER_OWNER_ID }, lead, ctx({ assigneeRole: null }), /owner or lead/);
  });

  it("is for the lead only", () => {
    for (const actor of [owner, auditor, reporter, system]) {
      expectDenied(inStatus("triaged"), { kind: "assign", memberId: OWNER_ID }, actor, ctx({ assigneeRole: "owner" }), /lead only/);
    }
  });

  it("only from triaged or assigned", () => {
    for (const s of ["new", "retest_open", "verified", "fixed_unverified", "closed"] as CaseStatus[]) {
      expectDenied(inStatus(s), { kind: "assign", memberId: OWNER_ID }, lead, ctx({ assigneeRole: "owner" }), /must be triaged or assigned/);
    }
  });
});

describe("assigned -> retest_open | fixed_unverified (log_fix; assignee or lead)", () => {
  const FIX: Action = { kind: "log_fix", description: "Replaced the door operator motor.", evidenceUrl: "https://example.com/photo" };

  it("opens a re-test when the reporter wants one and rounds are left (round 0 -> 1)", () => {
    const p = plan(inStatus("assigned", { wantsRetest: true, retestRound: 0 }), FIX, owner, ctx());
    expect(p.to).toBe("retest_open");
    expect(p.event).toBe("fix_logged");
    expect(p.patch).toEqual({ retestRound: 1 });
    expect(p.alsoRequestRetest).toBe(true);
    expect(p.payload).toMatchObject({ description: "Replaced the door operator motor.", evidenceUrl: "https://example.com/photo", retestRound: 1 });
  });

  it("opens the second and last round (round 1 -> 2)", () => {
    const p = plan(inStatus("assigned", { wantsRetest: true, retestRound: 1 }), FIX, owner, ctx());
    expect(p.to).toBe("retest_open");
    expect(p.patch).toEqual({ retestRound: 2 });
    expect(p.payload.retestRound).toBe(2);
    expect(p.alsoRequestRetest).toBe(true);
  });

  it("is fixed_unverified when the reporter does not want a re-test", () => {
    const p = plan(inStatus("assigned", { wantsRetest: false, retestRound: 0 }), FIX, owner, ctx());
    expect(p.to).toBe("fixed_unverified");
    expect(p.event).toBe("fix_logged");
    expect(p.patch).toEqual({});
    expect(p.payload.retestRound).toBe(0);
    expect(p.alsoRequestRetest).toBe(false);
  });

  it("is fixed_unverified when both re-test rounds are used up", () => {
    const p = plan(inStatus("assigned", { wantsRetest: true, retestRound: MAX_RETEST_ROUNDS }), FIX, owner, ctx());
    expect(p.to).toBe("fixed_unverified");
    expect(p.patch).toEqual({});
    expect(p.payload.retestRound).toBe(MAX_RETEST_ROUNDS);
    expect(p.alsoRequestRetest).toBe(false);
  });

  it("the lead may log a fix on a case assigned to someone else", () => {
    expect(plan(inStatus("assigned"), FIX, lead, ctx()).to).toBe("retest_open");
  });

  it("an owner who is not the assignee may not", () => {
    expectDenied(inStatus("assigned"), FIX, otherOwner, ctx(), /assignee or lead only/);
  });

  it("auditors, reporters and the system may not", () => {
    for (const actor of [auditor, reporter, system]) expectDenied(inStatus("assigned"), FIX, actor, ctx(), /assignee or lead only/);
  });

  it("only from assigned", () => {
    for (const s of ALL_STATUSES.filter((x) => x !== "assigned")) {
      expectDenied(inStatus(s, { assignedTo: OWNER_ID }), FIX, owner, ctx(), /must be assigned/);
    }
  });
});

describe("retest_open -> ... (verdict; reporter with the receipt code)", () => {
  const cases: [string, "fixed" | "partly" | "not_fixed" | "cant_check", CaseStatus][] = [
    ["Yes, it works now", "fixed", "verified"],
    ["Partly", "partly", "assigned"],
    ["No, still a barrier", "not_fixed", "assigned"],
    ["I can't check right now", "cant_check", "fixed_unverified"],
  ];
  for (const [label, verdict, to] of cases) {
    it(`"${label}" (${verdict}) -> ${to}`, () => {
      const p = plan(inStatus("retest_open", { retestRound: 1 }), { kind: "verdict", verdict, comment: "Thanks." }, reporter, ctx());
      expect(p.to).toBe(to);
      expect(p.event).toBe("retest_verdict");
      expect(p.patch).toEqual({}); // verifiedAt is set by transition(), not plan()
      expect(p.payload).toEqual({ verdict, round: 1, via: "receipt_code", comment: "Thanks." });
    });
  }

  it("partly / not fixed keep the round: the next log_fix decides", () => {
    const p = plan(inStatus("retest_open", { retestRound: 2 }), { kind: "verdict", verdict: "partly" }, reporter, ctx());
    expect(p.patch).toEqual({});
    expect(p.payload.round).toBe(2);
  });

  it("staff and the system can never give a verdict", () => {
    for (const actor of [lead, owner, auditor, system]) {
      for (const verdict of ["fixed", "partly", "not_fixed", "cant_check"] as const) {
        expectDenied(inStatus("retest_open"), { kind: "verdict", verdict }, actor, ctx(), /reporter only/);
      }
    }
  });

  it("needs an open re-test", () => {
    for (const s of ALL_STATUSES.filter((x) => x !== "retest_open")) {
      expectDenied(inStatus(s), { kind: "verdict", verdict: "fixed" }, reporter, ctx(), /no open re-test/);
    }
  });
});

describe("opt_out (reporter; any state)", () => {
  it("retest_open -> fixed_unverified and wantsRetest=false", () => {
    const p = plan(inStatus("retest_open"), { kind: "opt_out" }, reporter, ctx());
    expect(p.to).toBe("fixed_unverified");
    expect(p.event).toBe("opted_out");
    expect(p.patch).toEqual({ wantsRetest: false });
  });

  for (const s of ALL_STATUSES.filter((x) => x !== "retest_open")) {
    it(`in ${s} it only records the preference (status unchanged)`, () => {
      const p = plan(inStatus(s), { kind: "opt_out" }, reporter, ctx());
      expect(p.to).toBe(s);
      expect(p.event).toBe("opted_out");
      expect(p.patch).toEqual({ wantsRetest: false });
    });
  }

  it("is for the reporter only", () => {
    for (const actor of [lead, owner, auditor, system]) expectDenied(inStatus("retest_open"), { kind: "opt_out" }, actor, ctx(), /reporter only/);
  });
});

describe("retest_open -> fixed_unverified (expire_retest; system; 60 days after retest_requested)", () => {
  const requested = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

  it("expires 60 days after the latest retest_requested", () => {
    for (const days of [60, 61, 365]) {
      const p = plan(inStatus("retest_open"), { kind: "expire_retest" }, system, ctx({ lastRetestRequestedAt: requested(days) }));
      expect(p.to).toBe("fixed_unverified");
      expect(p.event).toBe("retest_expired");
      expect(p.payload).toEqual({ afterDays: 60 });
    }
  });

  it("not before 60 days", () => {
    for (const lastRetestRequestedAt of [requested(59), requested(0), new Date(NOW.getTime() - 60 * DAY + 1)]) {
      expectDenied(inStatus("retest_open"), { kind: "expire_retest" }, system, ctx({ lastRetestRequestedAt }), /not expired yet/);
    }
  });

  it("not without a retest_requested event", () => {
    expectDenied(inStatus("retest_open"), { kind: "expire_retest" }, system, ctx({ lastRetestRequestedAt: null }), /not expired yet/);
  });

  it("is for the system only", () => {
    for (const actor of [lead, owner, auditor, reporter]) {
      expectDenied(inStatus("retest_open"), { kind: "expire_retest" }, actor, ctx({ lastRetestRequestedAt: requested(90) }), /system only/);
    }
  });

  it("needs an open re-test", () => {
    for (const s of ALL_STATUSES.filter((x) => x !== "retest_open")) {
      expectDenied(inStatus(s), { kind: "expire_retest" }, system, ctx({ lastRetestRequestedAt: requested(90) }), /no open re-test/);
    }
  });
});

describe("reopen (lead; D4: fixed_unverified or verified -> assigned, closed -> triaged; with a reason)", () => {
  it("fixed_unverified -> assigned, for another fix", () => {
    const p = plan(inStatus("fixed_unverified"), { kind: "reopen", reason: "The button broke again." }, lead, ctx());
    expect(p.to).toBe("assigned");
    expect(p.event).toBe("reopened");
    expect(p.patch).toEqual({});
    expect(p.payload).toEqual({ reason: "The button broke again." });
  });

  it("D4: verified -> assigned, and the case is no longer verified (verifiedAt cleared)", () => {
    const c = inStatus("verified", { verifiedAt: new Date("2026-10-01T15:00:00Z") });
    const p = plan(c, { kind: "reopen", reason: "The button broke again a month later." }, lead, ctx());
    expect(p.to).toBe("assigned");
    expect(p.event).toBe("reopened");
    expect(p.patch).toEqual({ verifiedAt: null });
    expect(p.payload).toEqual({ reason: "The button broke again a month later." });
    expect(p.alsoRequestRetest).toBeFalsy();
  });

  it("D4: closed -> triaged, the closing reason, assignee and due date cleared", () => {
    for (const closedReason of CLOSE_REASONS) {
      const c = inStatus("closed", { closedReason, assignedTo: OWNER_ID, dueAt: new Date("2026-11-01T15:00:00Z") });
      const p = plan(c, { kind: "reopen", reason: "Closed by mistake." }, lead, ctx());
      expect(p.to).toBe("triaged");
      expect(p.event).toBe("reopened");
      expect(p.patch).toEqual({ closedReason: null, assignedTo: null, dueAt: null });
      expect(p.payload).toEqual({ reason: "Closed by mistake." });
    }
  });

  it("D4: a case closed before triage (no area, no public summary) goes back to new", () => {
    const c = inStatus("closed", { priorityArea: null, publicSummary: null, closedReason: "spam" });
    const p = plan(c, { kind: "reopen", reason: "It was real feedback after all." }, lead, ctx());
    expect(p.to).toBe("new");
    expect(p.patch).toEqual({ closedReason: null, assignedTo: null, dueAt: null });
  });

  it("needs a reason (D4: required, for every reopen)", () => {
    for (const s of ["fixed_unverified", "verified", "closed"] as CaseStatus[]) {
      for (const reason of ["", "  ", "\n"]) expectDenied(inStatus(s), { kind: "reopen", reason }, lead, ctx(), /reason required/);
    }
  });

  it("is for the lead only", () => {
    for (const s of ["fixed_unverified", "verified", "closed"] as CaseStatus[]) {
      for (const actor of [owner, auditor, reporter, system]) {
        expectDenied(inStatus(s), { kind: "reopen", reason: "x" }, actor, ctx(), /lead only/);
      }
    }
  });

  it("only from fixed_unverified, verified or closed", () => {
    for (const s of ["new", "triaged", "assigned", "retest_open"] as CaseStatus[]) {
      expectDenied(inStatus(s), { kind: "reopen", reason: "x" }, lead, ctx(), /only fixed_unverified, verified or closed/);
    }
  });
});

describe("triaged/assigned -> same status (retriage; lead; D2: a new area and/or public summary, with a reason)", () => {
  for (const from of ["triaged", "assigned"] as CaseStatus[]) {
    it(`${from}: a new area keeps the status and the public summary`, () => {
      const c = inStatus(from);
      const p = plan(c, RETRIAGE, lead, ctx());
      expect(p.to).toBe(from);
      expect(p.event).toBe("triaged");
      expect(p.patch).toEqual({ priorityArea: "ict", publicSummary: c.publicSummary });
      expect(p.payload).toEqual({
        priorityArea: "ict",
        publicSummary: c.publicSummary,
        retriage: true,
        changed: ["priorityArea"],
        reason: "It was the booking website, not the door.",
      });
      expect(p.alsoRequestRetest).toBeFalsy();
    });

    it(`${from}: a new public summary keeps the area`, () => {
      const p = plan(inStatus(from), { kind: "retriage", publicSummary: "  The side door button did not work.  ", reason: "Clearer." }, lead, ctx());
      expect(p.to).toBe(from);
      expect(p.patch).toEqual({ priorityArea: "built_environment", publicSummary: "The side door button did not work." });
      expect(p.payload).toMatchObject({ changed: ["publicSummary"], retriage: true, reason: "Clearer." });
    });

    it(`${from}: both at once`, () => {
      const p = plan(inStatus(from), { kind: "retriage", priorityArea: "ict", publicSummary: "The booking site timed out.", reason: "Wrong case text." }, lead, ctx());
      expect(p.patch).toEqual({ priorityArea: "ict", publicSummary: "The booking site timed out." });
      expect(p.payload.changed).toEqual(["priorityArea", "publicSummary"]);
    });
  }

  it("keeps the assignee (no patch to assignedTo)", () => {
    expect(plan(inStatus("assigned"), RETRIAGE, lead, ctx()).patch).not.toHaveProperty("assignedTo");
  });

  it("needs a reason", () => {
    for (const reason of ["", "   "]) expectDenied(inStatus("triaged"), { ...RETRIAGE, reason }, lead, ctx(), /reason required/);
  });

  it("refuses an empty public summary", () => {
    expectDenied(inStatus("triaged"), { kind: "retriage", publicSummary: "   ", reason: "x" }, lead, ctx(), /publicSummary required/);
  });

  it("refuses a correction that changes nothing", () => {
    const c = inStatus("triaged");
    expectDenied(c, { kind: "retriage", reason: "x" }, lead, ctx(), /nothing to change/);
    expectDenied(c, { kind: "retriage", priorityArea: "built_environment", publicSummary: c.publicSummary!, reason: "x" }, lead, ctx(), /nothing to change/);
  });

  it("is for the lead only", () => {
    for (const actor of [owner, otherOwner, auditor, reporter, system]) expectDenied(inStatus("assigned"), RETRIAGE, actor, ctx(), /lead only/);
  });

  it("only from triaged or assigned", () => {
    for (const s of ["new", "retest_open", "verified", "fixed_unverified", "closed"] as CaseStatus[]) {
      expectDenied(inStatus(s), RETRIAGE, lead, ctx(), /must be triaged or assigned/);
    }
  });
});

describe("retest_open -> fixed_unverified (stop_waiting; lead; D3: 14 days or more after retest_requested)", () => {
  const requested = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);

  it("stops waiting 14 days or more after the latest retest_requested: reporter unreachable", () => {
    for (const days of [14, 20, 59]) {
      const p = plan(inStatus("retest_open", { retestRound: 2 }), { kind: "stop_waiting" }, lead, ctx({ lastRetestRequestedAt: requested(days) }));
      expect(p.to).toBe("fixed_unverified");
      expect(p.event).toBe("retest_expired");
      expect(p.patch).toEqual({});
      expect(p.payload).toEqual({ reason: "reporter_unreachable", afterDays: days, round: 2 });
      expect(p.alsoRequestRetest).toBeFalsy();
    }
  });

  it("not before 14 days", () => {
    for (const lastRetestRequestedAt of [requested(0), requested(13), new Date(NOW.getTime() - 14 * DAY + 1)]) {
      expectDenied(inStatus("retest_open"), { kind: "stop_waiting" }, lead, ctx({ lastRetestRequestedAt }), /too early to stop waiting/);
    }
  });

  it("not without a retest_requested event", () => {
    expectDenied(inStatus("retest_open"), { kind: "stop_waiting" }, lead, ctx({ lastRetestRequestedAt: null }), /too early to stop waiting/);
  });

  it("is for the lead only (the reporter opts out instead; the system expires)", () => {
    for (const actor of [owner, auditor, reporter, system]) {
      expectDenied(inStatus("retest_open"), { kind: "stop_waiting" }, actor, ctx({ lastRetestRequestedAt: requested(30) }), /lead only/);
    }
  });

  it("needs an open re-test", () => {
    for (const s of ALL_STATUSES.filter((x) => x !== "retest_open")) {
      expectDenied(inStatus(s), { kind: "stop_waiting" }, lead, ctx({ lastRetestRequestedAt: requested(30) }), /no open re-test/);
    }
  });
});

describe("illegal moves", () => {
  it("owner triaging", () => expectDenied(inStatus("new"), TRIAGE, owner));
  it("staff giving a verdict", () => expectDenied(inStatus("retest_open"), { kind: "verdict", verdict: "fixed" }, lead));
  it("closing a verified or closed case", () => {
    expectDenied(inStatus("verified"), { kind: "close", reason: "duplicate" }, lead);
    expectDenied(inStatus("closed"), { kind: "close", reason: "duplicate" }, lead);
  });
  it("log_fix by an owner who is not the assignee", () =>
    expectDenied(inStatus("assigned"), { kind: "log_fix", description: "x" }, otherOwner));
  it("a verdict when no re-test is open", () => expectDenied(inStatus("assigned"), { kind: "verdict", verdict: "fixed" }, reporter));

  it("terminal states accept nothing but the reporter's contact preference and the lead's reopen (D4)", () => {
    for (const s of ["verified", "closed"] as CaseStatus[]) {
      for (const action of ALL_ACTIONS) {
        for (const [name, actor] of ALL_ACTORS) {
          const c = inStatus(s);
          const context = ctx({ assigneeRole: "owner", lastRetestRequestedAt: new Date(0) });
          if (action.kind === "opt_out" && actor.kind === "reporter") {
            expect(plan(c, action, actor, context).to).toBe(s);
          } else if (action.kind === "reopen" && name === "lead") {
            expect(plan(c, action, actor, context).to).toBe(s === "verified" ? "assigned" : "triaged");
          } else {
            expect(() => plan(c, action, actor, context), `${action.kind} in ${s}`).toThrow(TransitionError);
          }
        }
      }
    }
  });

  it("every move out of verified is the lead's reopen, to assigned (D4)", () => {
    for (const action of ALL_ACTIONS) {
      for (const [name, actor] of ALL_ACTORS) {
        let to: CaseStatus | null = null;
        try {
          to = plan(inStatus("verified"), action, actor, ctx({ assigneeRole: "owner", lastRetestRequestedAt: new Date(0) })).to;
        } catch (e) {
          expect(e).toBeInstanceOf(TransitionError);
        }
        if (to !== null && to !== "verified") {
          expect([name, action.kind, to]).toEqual(["lead", "reopen", "assigned"]);
        }
      }
    }
  });

  it("only a reporter holding the receipt code can ever produce verified", () => {
    let reached = 0;
    for (const s of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        for (const [name, actor] of ALL_ACTORS) {
          const context = ctx({ assigneeRole: "owner", lastRetestRequestedAt: new Date(0) });
          let to: CaseStatus | null = null;
          try {
            to = plan(inStatus(s), action, actor, context).to;
          } catch (e) {
            expect(e).toBeInstanceOf(TransitionError);
          }
          if (to === "verified" && s !== "verified") {
            reached++;
            expect(name).toBe("reporter");
            expect(s).toBe("retest_open");
            expect(action).toEqual({ kind: "verdict", verdict: "fixed" });
          }
        }
      }
    }
    expect(reached).toBe(1);
  });

  it("TransitionError names the action and the state", () => {
    try {
      plan(inStatus("new"), TRIAGE, owner, ctx());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      expect((e as Error).message).toBe("triage from new: lead only");
    }
  });
});

describe("free text is layer-1 redacted before it enters the log", () => {
  const PHONE = "Call me at 416-555-0142 or email dana@example.com.";
  const SCRUBBED = "Call me at [PHONE] or email [EMAIL].";

  it("triage publicSummary", () => {
    const p = plan(inStatus("new"), { ...TRIAGE, publicSummary: PHONE }, lead, ctx());
    expect(p.payload.publicSummary).toBe(SCRUBBED);
    expect(p.patch.publicSummary).toBe(SCRUBBED);
  });

  it("log_fix description", () => {
    const p = plan(inStatus("assigned"), { kind: "log_fix", description: PHONE }, owner, ctx());
    expect(p.payload.description).toBe(SCRUBBED);
  });

  it("verdict comment", () => {
    const p = plan(inStatus("retest_open"), { kind: "verdict", verdict: "partly", comment: PHONE }, reporter, ctx());
    expect(p.payload.comment).toBe(SCRUBBED);
  });

  it("dictated phone numbers too", () => {
    const p = plan(inStatus("retest_open"), {
      kind: "verdict", verdict: "not_fixed", comment: "Call four one six five five five zero one four two please.",
    }, reporter, ctx());
    expect(p.payload.comment).toBe("Call [PHONE] please.");
  });

  it("close note", () => {
    const p = plan(inStatus("new"), { kind: "close", reason: "duplicate", note: PHONE }, lead, ctx());
    expect(p.payload.note).toBe(SCRUBBED);
  });

  it("reopen reason (every reopen, D4)", () => {
    for (const s of ["fixed_unverified", "verified", "closed"] as CaseStatus[]) {
      const p = plan(inStatus(s), { kind: "reopen", reason: PHONE }, lead, ctx());
      expect(p.payload.reason).toBe(SCRUBBED);
    }
  });

  it("retriage reason and public summary (D2)", () => {
    const p = plan(inStatus("assigned"), { kind: "retriage", publicSummary: PHONE, reason: PHONE }, lead, ctx());
    expect(p.payload.reason).toBe(SCRUBBED);
    expect(p.payload.publicSummary).toBe(SCRUBBED);
    expect(p.patch.publicSummary).toBe(SCRUBBED);
    expect(JSON.stringify(p.payload)).not.toContain("416-555-0142");
  });

  it("no free text in the payload stays raw", () => {
    const p = plan(inStatus("assigned"), { kind: "log_fix", description: "Replaced the motor. Call 416-555-0142." }, owner, ctx());
    expect(JSON.stringify(p.payload)).not.toContain("416-555-0142");
  });
});
