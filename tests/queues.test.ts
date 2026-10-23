// The staff work queues (Phase 7 T2 items 5 and 6), pure: due dates on assign (decision D8: plan(), the replay, the
// one "overdue" rule and the instant a typed date is stored as, across clock changes), the inbox's new filters
// (assigned to, age) through the same lib/metrics filter as every dashboard link, and the inbox's search, sort and
// pages. The database side (transition(), the owner email) is tests/queues.db.test.ts.
import { describe, expect, it } from "vitest";
import { zonedDate, zonedNoon } from "@/lib/dates";
import {
  DEFAULT_INBOX_SORT,
  INBOX_PAGE_SIZE,
  SEARCH_MAX,
  hiddenFilterFields,
  inboxPage,
  inboxQueryHref,
  matchesSearch,
  pageRows,
  parseInboxQuery,
  selectValueOf,
  sortInboxRows,
} from "@/lib/cases/inbox-query";
import {
  AGE_FILTERS,
  ASSIGNEE_NONE,
  ageInDays,
  ageLabel,
  applyInboxFilter,
  caseAgeDays,
  describeInboxFilter,
  dueAtForDate,
  dueDateOf,
  dueState,
  inAgeRange,
  inboxHref,
  isFilterActive,
  isOverdue,
  parseInboxFilter,
  pastDue,
  replayCase,
  type MetricCase,
  type MetricEvent,
} from "@/lib/metrics";
import { plan, type Actor, type CaseRow, type PlanContext } from "@/lib/state-machine";

const DAY = 86_400_000;
const NOW = zonedNoon("2026-10-19");
const OWNER = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const LEAD = "22222222-2222-4222-8222-222222222222";
const lead: Actor = { kind: "staff", memberId: LEAD, role: "lead" };

/* ------------------------------------------------------------------ plan(): assign with a due date */

function caseRow(overrides: Partial<CaseRow> = {}): CaseRow {
  const at = new Date("2026-09-01T14:00:00.000Z");
  return {
    id: "66666666-6666-4666-8666-666666666666", orgId: "11111111-1111-4111-8111-111111111111", seq: 17, ref: "BAR-0017",
    status: "triaged", intakeChannel: "web", locationKind: "place", locationDetail: null, isAnonymous: true,
    wantsRetest: true, aiOptOut: false, needsManualRedaction: false, redactedText: "The door button is broken.",
    aiSummary: null, summary: null, summarySource: null, aiPriorityAreas: null, priorityArea: "built_environment",
    publicSummary: "A door button was broken.", assignedTo: null, dueAt: null, retestRound: 0, closedReason: null,
    receiptCodeHash: "a".repeat(64), receivedAt: at, ackAt: at, redactionApprovedAt: at, verifiedAt: null,
    retentionUntil: "2033-09-01", createdAt: at, updatedAt: at, ...overrides,
  };
}
const ctx = (o: Partial<PlanContext> = {}): PlanContext => ({
  hasApprovedRedaction: true, assigneeRole: "owner", lastRetestRequestedAt: null, now: NOW, ...o,
});

describe("D8: assign carries the due date (plan)", () => {
  const due = dueAtForDate("2026-11-03");

  it("sets cases.due_at and records it in the assigned event (an ISO instant)", () => {
    const p = plan(caseRow(), { kind: "assign", memberId: OWNER, dueAt: due }, lead, ctx());
    expect(p.to).toBe("assigned");
    expect(p.patch).toEqual({ assignedTo: OWNER, dueAt: due });
    expect(p.payload).toEqual({ memberId: OWNER, dueAt: due.toISOString() });
  });

  it("null clears it, and says so in the log; leaving it out keeps the row's due date and the old payload", () => {
    const assigned = caseRow({ status: "assigned", assignedTo: OWNER, dueAt: due });
    const cleared = plan(assigned, { kind: "assign", memberId: OWNER, dueAt: null }, lead, ctx());
    expect(cleared.patch).toEqual({ assignedTo: OWNER, dueAt: null });
    expect(cleared.payload).toEqual({ memberId: OWNER, dueAt: null });
    const kept = plan(assigned, { kind: "assign", memberId: OTHER }, lead, ctx());
    expect(kept.patch).toEqual({ assignedTo: OTHER });
    expect(kept.payload).toEqual({ memberId: OTHER });
  });

  it("refuses an invalid date, and keeps every other assign rule", () => {
    expect(() => plan(caseRow(), { kind: "assign", memberId: OWNER, dueAt: new Date("nope") }, lead, ctx())).toThrow(/invalid due date/);
    expect(() => plan(caseRow(), { kind: "assign", memberId: OWNER, dueAt: due }, lead, ctx({ assigneeRole: "auditor" }))).toThrow(/owner or lead/);
    expect(() => plan(caseRow({ status: "new" }), { kind: "assign", memberId: OWNER, dueAt: due }, lead, ctx())).toThrow(/must be triaged or assigned/);
    const owner: Actor = { kind: "staff", memberId: OWNER, role: "owner" };
    expect(() => plan(caseRow(), { kind: "assign", memberId: OWNER, dueAt: due }, owner, ctx())).toThrow(/lead only/);
  });
});

/* ------------------------------------------------------------------ due dates and "overdue" */

describe("a due date is stored as the last moment of that day (display time zone)", () => {
  it("maps back to the same calendar date, on ordinary days and on both clock changes", () => {
    for (const d of ["2026-01-15", "2026-03-07", "2026-03-08", "2026-03-09", "2026-06-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-12-31"]) {
      const at = dueAtForDate(d);
      expect(dueDateOf(at), d).toBe(d);
      expect(zonedDate(new Date(at.getTime() + 1)), `${d} + 1 ms is the next day`).not.toBe(d);
    }
    // Toronto is UTC-5 in winter and UTC-4 in summer: the last millisecond of the day.
    expect(dueAtForDate("2026-01-15").toISOString()).toBe("2026-01-16T04:59:59.999Z");
    expect(dueAtForDate("2026-07-15").toISOString()).toBe("2026-07-16T03:59:59.999Z");
    // The day the clocks go back (Nov 1, 2026) ends at 05:00 UTC; the day they go forward (Mar 8) at 04:00 UTC.
    expect(dueAtForDate("2026-11-01").toISOString()).toBe("2026-11-02T04:59:59.999Z");
    expect(dueAtForDate("2026-03-08").toISOString()).toBe("2026-03-09T03:59:59.999Z");
    expect(() => dueAtForDate("2026-02-30")).toThrow();
  });

  it("is overdue only once its day is over, and only while the case is assigned", () => {
    const due = dueAtForDate("2026-10-19");
    expect(pastDue("assigned", due, zonedNoon("2026-10-19"))).toBe(false);
    expect(pastDue("assigned", due, new Date(due.getTime() + 1))).toBe(true);
    expect(pastDue("assigned", due, zonedNoon("2026-10-20"))).toBe(true);
    for (const s of ["new", "triaged", "retest_open", "verified", "fixed_unverified", "closed"] as const) {
      expect(pastDue(s, due, zonedNoon("2026-12-01")), s).toBe(false);
    }
    expect(pastDue("assigned", null, NOW)).toBe(false);
  });

  it("dueState says overdue, today or upcoming, with the days, and nothing for other statuses", () => {
    expect(dueState("assigned", dueAtForDate("2026-10-12"), NOW)).toMatchObject({ kind: "overdue", on: "2026-10-12", days: 7 });
    expect(dueState("assigned", dueAtForDate("2026-10-18"), NOW)).toMatchObject({ kind: "overdue", days: 1 });
    expect(dueState("assigned", dueAtForDate("2026-10-19"), NOW)).toMatchObject({ kind: "today", days: 0 });
    expect(dueState("assigned", dueAtForDate("2026-10-20"), NOW)).toMatchObject({ kind: "upcoming", days: 1 });
    expect(dueState("assigned", dueAtForDate("2026-11-03"), NOW)).toMatchObject({ kind: "upcoming", on: "2026-11-03", days: 15 });
    expect(dueState("retest_open", dueAtForDate("2026-10-12"), NOW)).toEqual({ kind: "none" });
    expect(dueState("assigned", null, NOW)).toEqual({ kind: "none" });
  });
});

/* ------------------------------------------------------------------ the replay knows the assignee and the due date */

function story(received: string) {
  const events: MetricEvent[] = [];
  const t0 = new Date(received).getTime();
  let status = "new";
  const add = (days: number, type: string, payload: Record<string, unknown> = {}) =>
    events.push({ seq: events.length + 1, type, payload, createdAt: new Date(t0 + days * DAY + events.length) });
  const move = (days: number, type: string, to: string, payload: Record<string, unknown> = {}) => {
    add(days, type, { ...payload, from: status, to });
    status = to;
  };
  add(0, "submitted", { channel: "web", isAnonymous: true });
  add(0, "redaction_approved", { spans: [] });
  move(1, "triaged", "triaged", { priorityArea: "ict", publicSummary: "A form did not work with a keyboard." });
  return { events, add, move, case: (id: string, ref: string): MetricCase => ({ id, ref, events }) };
}

describe("replay: assignedTo and dueAt (D8) come from the log alone", () => {
  it("the latest assignment wins; an assignment without dueAt (before D8) keeps the earlier one", () => {
    const s = story("2026-09-01T14:00:00.000Z");
    const due = dueAtForDate("2026-09-20");
    s.move(2, "assigned", "assigned", { memberId: OWNER, dueAt: due.toISOString() });
    let r = replayCase(s.case("a", "BAR-0001"));
    expect(r.assignedTo).toBe(OWNER);
    expect(r.dueAt?.getTime()).toBe(due.getTime());
    s.move(3, "assigned", "assigned", { memberId: OTHER });
    r = replayCase(s.case("a", "BAR-0001"));
    expect(r.assignedTo).toBe(OTHER);
    expect(r.dueAt?.getTime()).toBe(due.getTime());
    s.move(4, "assigned", "assigned", { memberId: OTHER, dueAt: null });
    expect(replayCase(s.case("a", "BAR-0001")).dueAt).toBeNull();
    expect(isOverdue(replayCase(s.case("a", "BAR-0001")), NOW)).toBe(false);
  });

  it("is overdue from the log while assigned; a logged fix ends it; a reopen from closed clears both", () => {
    const s = story("2026-09-01T14:00:00.000Z");
    s.move(2, "assigned", "assigned", { memberId: OWNER, dueAt: dueAtForDate("2026-09-20").toISOString() });
    expect(isOverdue(replayCase(s.case("b", "BAR-0002")), NOW)).toBe(true);
    s.move(30, "fix_logged", "fixed_unverified", { description: "Fixed." });
    expect(isOverdue(replayCase(s.case("b", "BAR-0002")), NOW)).toBe(false);
    s.move(31, "reopened", "assigned", { reason: "It broke again." });
    const back = replayCase(s.case("b", "BAR-0002"));
    expect(back.assignedTo).toBe(OWNER); // the same team gets it back, with its due date
    expect(isOverdue(back, NOW)).toBe(true);
    s.move(32, "closed", "closed", { reason: "no_action_possible" });
    s.move(33, "reopened", "triaged", { reason: "Closed by mistake." });
    const reopened = replayCase(s.case("b", "BAR-0002"));
    expect(reopened.assignedTo).toBeNull();
    expect(reopened.dueAt).toBeNull();
  });
});

/* ------------------------------------------------------------------ age */

describe("age: whole calendar days since the case was received", () => {
  it("counts days in the display time zone, never below 0", () => {
    expect(ageInDays(zonedNoon("2026-10-19"), NOW)).toBe(0);
    expect(ageInDays(new Date("2026-10-19T03:30:00.000Z"), NOW)).toBe(1); // Oct 18, 11:30 p.m. in Toronto
    expect(ageInDays(zonedNoon("2026-09-19"), NOW)).toBe(30);
    expect(ageInDays(zonedNoon("2026-10-25"), NOW)).toBe(0);
    expect([0, 1, 12].map(ageLabel)).toEqual(["Today", "1 day", "12 days"]);
  });

  it("the ranges cover every age once", () => {
    for (let d = 0; d <= 400; d++) expect(AGE_FILTERS.filter((f) => inAgeRange(d, f)), String(d)).toHaveLength(1);
    expect(inAgeRange(6, "under_7")).toBe(true);
    expect(inAgeRange(7, "7_29")).toBe(true);
    expect(inAgeRange(30, "30_89")).toBe(true);
    expect(inAgeRange(90, "90_plus")).toBe(true);
  });
});

/* ------------------------------------------------------------------ the inbox filter: assigned to, age */

describe("inbox filter: assigned to and age, through the same filter as every dashboard link", () => {
  const a = story("2026-10-17T14:00:00.000Z"); // 2 days old, assigned to OWNER
  a.move(1, "assigned", "assigned", { memberId: OWNER, dueAt: null });
  const b = story("2026-08-01T14:00:00.000Z"); // 79 days old, assigned to OTHER
  b.move(2, "assigned", "assigned", { memberId: OTHER });
  const c = story("2026-04-01T14:00:00.000Z"); // 201 days old, nobody's
  const cases = [a.case("a", "BAR-0001"), b.case("b", "BAR-0002"), c.case("c", "BAR-0003")];

  it("parses member ids and none (anything else is dropped), and writes them back in the same place", () => {
    const f = parseInboxFilter(new URLSearchParams(`assignee=${OWNER.toUpperCase()}&assignee=none&assignee=bogus&age=30_89&age=old`));
    expect(f).toEqual({ assignee: [ASSIGNEE_NONE, OWNER], age: "30_89" });
    expect(isFilterActive(f)).toBe(true);
    expect(inboxHref({ status: ["assigned"], assignee: [OWNER], age: "under_7", month: "2026-10" })).toBe(
      `/app/inbox?status=assigned&assignee=${OWNER}&age=under_7&month=2026-10`,
    );
    expect(parseInboxFilter(new URLSearchParams(inboxHref(f).split("?")[1]))).toEqual(f);
  });

  it("selects by the replayed assignee and age", () => {
    expect(applyInboxFilter(cases, { assignee: [OWNER] }, NOW)).toEqual(["a"]);
    expect(applyInboxFilter(cases, { assignee: [ASSIGNEE_NONE] }, NOW)).toEqual(["c"]);
    expect(applyInboxFilter(cases, { assignee: [ASSIGNEE_NONE, OTHER] }, NOW)).toEqual(["b", "c"]);
    expect(applyInboxFilter(cases, { age: "under_7" }, NOW)).toEqual(["a"]);
    expect(applyInboxFilter(cases, { age: "30_89" }, NOW)).toEqual(["b"]);
    expect(applyInboxFilter(cases, { age: "90_plus", assignee: [ASSIGNEE_NONE] }, NOW)).toEqual(["c"]);
    expect(caseAgeDays(replayCase(cases[1]), NOW)).toBe(79);
  });

  it("describes them in words, with the member's name", () => {
    const names = new Map([[OWNER, "Facilities team"]]);
    expect(describeInboxFilter({ assignee: [ASSIGNEE_NONE, OWNER, OTHER], age: "7_29" }, { memberName: (id) => names.get(id) ?? null })).toEqual([
      "Assigned to: no one yet, Facilities team or someone not in this organization",
      "Received 7 to 29 days ago",
    ]);
  });
});

/* ------------------------------------------------------------------ the inbox's search, sort and pages */

describe("inbox query: search, sort, pages", () => {
  it("reads the search, sort and page leniently", () => {
    expect(parseInboxQuery(new URLSearchParams(""))).toEqual({ q: "", sort: DEFAULT_INBOX_SORT, page: 1 });
    expect(parseInboxQuery(new URLSearchParams("q=  ramp   door &sort=age&page=3"))).toEqual({ q: "ramp door", sort: "age", page: 3 });
    expect(parseInboxQuery({ q: "a,b", sort: "loudest", page: "0" })).toEqual({ q: "a,b", sort: "received", page: 1 });
    expect(parseInboxQuery({ page: "2x" }).page).toBe(1);
    expect(parseInboxQuery({ q: "x".repeat(500) }).q).toHaveLength(SEARCH_MAX);
  });

  it("finds a reference by its text or number, and words in the public summary or the summary shown", () => {
    const row = { ref: "BAR-0012", publicSummary: "The ramp at the side entrance was too steep.", shownText: "Écran tactile du guichet ne répond pas." };
    for (const q of ["BAR-0012", "bar-0012", "BAR-12", "bar 12", "#12", "0012", "12", "RAMP", "side   entrance", "ecran tactile", "GUICHET"]) {
      expect(matchesSearch(row, q), q).toBe(true);
    }
    for (const q of ["BAR-0013", "elevator", "BAR-1"]) expect(matchesSearch(row, q), q).toBe(false);
    expect(matchesSearch(row, "")).toBe(true);
    // Words the viewer can't see (an auditor before the redaction review) are never searched.
    expect(matchesSearch({ ref: "BAR-0016", publicSummary: null, shownText: null }, "door")).toBe(false);
  });

  it("sorts newest first, oldest first, or by due date (assigned cases with one first, the most overdue on top)", () => {
    const at = (d: string) => zonedNoon(d);
    const rows = [
      { ref: "A", seq: 1, receivedAt: at("2026-09-01"), status: "assigned" as const, dueAt: dueAtForDate("2026-11-01") },
      { ref: "B", seq: 2, receivedAt: at("2026-09-05"), status: "verified" as const, dueAt: dueAtForDate("2026-09-02") },
      { ref: "C", seq: 3, receivedAt: at("2026-09-05"), status: "assigned" as const, dueAt: dueAtForDate("2026-10-01") },
      { ref: "D", seq: 4, receivedAt: at("2026-10-01"), status: "new" as const, dueAt: null },
      { ref: "E", seq: 5, receivedAt: at("2026-08-01"), status: "assigned" as const, dueAt: null },
    ];
    const refs = (s: "received" | "age" | "due") => sortInboxRows(rows, s).map((r) => r.ref);
    expect(refs("received")).toEqual(["D", "C", "B", "A", "E"]);
    expect(refs("age")).toEqual(["E", "A", "B", "C", "D"]);
    expect(refs("due")).toEqual(["C", "A", "D", "B", "E"]);
    expect(rows.map((r) => r.ref)).toEqual(["A", "B", "C", "D", "E"]); // a new array
  });

  it("shows 50 to a page; a page past the end shows the last one", () => {
    expect(INBOX_PAGE_SIZE).toBe(50);
    expect(inboxPage(0, 3)).toEqual({ page: 1, pages: 1, first: 0, last: 0, total: 0 });
    expect(inboxPage(50, 1)).toEqual({ page: 1, pages: 1, first: 1, last: 50, total: 50 });
    expect(inboxPage(120, 2)).toEqual({ page: 2, pages: 3, first: 51, last: 100, total: 120 });
    expect(inboxPage(120, 9)).toEqual({ page: 3, pages: 3, first: 101, last: 120, total: 120 });
    const all = Array.from({ length: 120 }, (_, i) => i);
    expect(pageRows(all, inboxPage(120, 3))).toEqual(all.slice(100));
    expect(pageRows([], inboxPage(0, 1))).toEqual([]);
  });

  it("links keep the filter, the search and the sort, and leave the defaults out", () => {
    const filter = { from: "2026-01-01", to: "2026-12-31", status: ["verified" as const] };
    expect(inboxQueryHref(filter, { q: "ramp door", sort: "age", page: 2 })).toBe(
      "/app/inbox?from=2026-01-01&to=2026-12-31&status=verified&q=ramp+door&sort=age&page=2",
    );
    expect(inboxQueryHref({}, { q: "", sort: "received", page: 1 })).toBe("/app/inbox");
  });

  it("carries the filters the form has no field for in hidden fields, and shows several values as one choice", () => {
    expect(
      hiddenFilterFields({ from: "2026-01-01", to: "2026-12-31", status: ["new"], attention: ["redaction", "retest"], age: "7_29", stage: "assigned" }),
    ).toEqual([
      { name: "from", value: "2026-01-01" },
      { name: "to", value: "2026-12-31" },
      { name: "attention", value: "redaction" },
      { name: "attention", value: "retest" },
      { name: "stage", value: "assigned" },
    ]);
    expect(selectValueOf(undefined)).toBe("");
    expect(selectValueOf(["new", "triaged"])).toBe("new,triaged");
    // The comma form reads back as the same list (the dashboard's "Open barriers" link has four statuses).
    expect(parseInboxFilter({ status: selectValueOf(["new", "triaged", "assigned", "retest_open"]) }).status).toEqual([
      "new", "triaged", "assigned", "retest_open",
    ]);
  });
});
