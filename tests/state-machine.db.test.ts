// lib/state-machine.ts transition() for the Phase 7 rows (D1-D4) on a real Postgres (PGlite, the real migrations):
// stop_waiting reads the latest retest_requested from the log, reopen and retriage write the projection, and the
// events alone replay to the same state as the `cases` row (domain §8; lib/metrics replayCase), so the dashboard,
// the report and /verify see what the case page shows.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { caseEvents, cases } from "@/db/schema";
import { appendCaseEvent, verifyCaseChain } from "@/lib/case-events";
import { replayCase, verifiedFixRate, type MetricCase } from "@/lib/metrics";
import { caseByRef, duplicateOriginalOf, duplicatesOf } from "@/lib/cases/duplicates";
import { transition, type Actor } from "@/lib/state-machine";
import { insertCase, insertMember, insertOrg, startTestDb, type TestDb } from "./support/pglite-db";

const DAY = 86_400_000;
const T0 = new Date("2026-08-03T14:00:00.000Z");
const at = (days: number) => ({ at: new Date(T0.getTime() + days * DAY) });

let t: TestDb;
let orgId: string;
let lead: Actor;
let owner: Actor;
let ownerId: string;
const reporter: Actor = { kind: "reporter", via: "receipt_code" };

beforeAll(async () => {
  t = await startTestDb();
  orgId = (await insertOrg(t, "State machine org")).id;
  const l = await insertMember(t, orgId, "lead", "Test lead");
  const o = await insertMember(t, orgId, "owner", "Facilities team");
  ownerId = o.id;
  lead = { kind: "staff", memberId: l.id, role: "lead" };
  owner = { kind: "staff", memberId: o.id, role: "owner" };
}, 60_000);

afterAll(async () => {
  await t?.close();
});

/** A web case, approved, triaged and assigned to the owner (wantsRetest as given), every step at T0 + days. */
async function assignedCase(wantsRetest = true) {
  const c = await insertCase(t, orgId, { wantsRetest, receivedAt: T0 });
  await t.tx(async (tx) => {
    await appendCaseEvent(tx, { orgId, caseId: c.id, type: "submitted", actorKind: "reporter", actorId: null,
      payload: { channel: "web", isAnonymous: true }, createdAt: T0 });
    await appendCaseEvent(tx, { orgId, caseId: c.id, type: "redaction_approved", actorKind: "staff",
      actorId: lead.kind === "staff" ? lead.memberId : null, payload: { spans: [] }, createdAt: T0 });
    await transition(tx, orgId, c.id, { kind: "triage", priorityArea: "built_environment", publicSummary: "A door did not open." }, lead, at(0));
    await transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId }, lead, at(1));
  });
  return c.id;
}

async function row(id: string) {
  const [r] = await t.db.select().from(cases).where(eq(cases.id, id));
  return r;
}

async function chain(id: string): Promise<MetricCase> {
  const events = await t.db.select().from(caseEvents).where(eq(caseEvents.caseId, id)).orderBy(asc(caseEvents.seq));
  return { id, ref: "BAR-TEST", events: events.map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, createdAt: e.createdAt, hash: e.hash })) };
}

/** The events replay to exactly the projection's reportable state, and the chain is intact. */
async function expectReplayMatches(id: string) {
  const r = await row(id);
  const s = replayCase(await chain(id));
  expect({ status: s.status, area: s.priorityArea, summary: s.publicSummary, closed: s.closedReason, verifiedAt: s.verifiedAt?.getTime() ?? null })
    .toEqual({ status: r.status, area: r.priorityArea, summary: r.publicSummary, closed: r.closedReason, verifiedAt: r.verifiedAt?.getTime() ?? null });
  expect((await t.tx((tx) => verifyCaseChain(tx, orgId, id))).ok).toBe(true);
}

describe("D3 stop_waiting through transition()", () => {
  it("is refused 13 days after the latest retest_requested (written 1 ms after the fix) and allowed at 14; the round ends unanswered", async () => {
    const id = await assignedCase();
    await t.tx((tx) => transition(tx, orgId, id, { kind: "log_fix", description: "Replaced the motor." }, owner, at(2)));
    await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "stop_waiting" }, lead, at(15)))).rejects.toThrow(/too early to stop waiting/);
    await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "stop_waiting" }, owner, at(30)))).rejects.toThrow(/lead only/);
    const r = await t.tx((tx) => transition(tx, orgId, id, { kind: "stop_waiting" }, lead, at(16.01)));
    expect(r.case.status).toBe("fixed_unverified");
    expect(r.event.type).toBe("retest_expired");
    expect(r.event.actorKind).toBe("staff");
    expect(r.event.payload).toEqual({ reason: "reporter_unreachable", afterDays: 14, round: 1, from: "retest_open", to: "fixed_unverified" });
    const s = replayCase(await chain(id));
    expect(s.retestRounds.map((x) => x.outcome)).toEqual(["expired"]);
    // D6: a logged fix whose wait was stopped counts as not verified.
    const v = verifiedFixRate({ cases: [await chain(id)], period: { start: "2026-01-01", end: "2026-12-31" }, now: at(20).at });
    expect([v.verified.count, v.fixLogged.count, v.fixedUnverified.count]).toEqual([0, 1, 1]);
    // The reporter can no longer answer this round.
    await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "verdict", verdict: "fixed" }, reporter, at(17)))).rejects.toThrow(/no open re-test/);
    await expectReplayMatches(id);
  });

  it("counts from the LATEST request: round 2 restarts the 14 days", async () => {
    const id = await assignedCase();
    await t.tx((tx) => transition(tx, orgId, id, { kind: "log_fix", description: "Fix 1." }, owner, at(2)));
    await t.tx((tx) => transition(tx, orgId, id, { kind: "verdict", verdict: "partly" }, reporter, at(5)));
    await t.tx((tx) => transition(tx, orgId, id, { kind: "log_fix", description: "Fix 2." }, owner, at(10)));
    await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "stop_waiting" }, lead, at(20)))).rejects.toThrow(/too early/);
    const r = await t.tx((tx) => transition(tx, orgId, id, { kind: "stop_waiting" }, lead, at(24.01)));
    expect(r.event.payload).toMatchObject({ afterDays: 14, round: 2 });
  });
});

describe("D4 reopen through transition()", () => {
  it("verified -> assigned clears verifiedAt; the replay agrees and the case leaves the verified numerator", async () => {
    const id = await assignedCase();
    await t.tx((tx) => transition(tx, orgId, id, { kind: "log_fix", description: "Replaced the motor." }, owner, at(2)));
    await t.tx((tx) => transition(tx, orgId, id, { kind: "verdict", verdict: "fixed" }, reporter, at(4)));
    expect((await row(id)).verifiedAt).toBeInstanceOf(Date);
    const year = { start: "2026-01-01", end: "2026-12-31" };
    const before = verifiedFixRate({ cases: [await chain(id)], period: year, now: at(5).at });
    expect([before.verified.count, before.fixLogged.count]).toEqual([1, 1]);

    await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "reopen", reason: " " }, lead, at(6)))).rejects.toThrow(/reason required/);
    const r = await t.tx((tx) => transition(tx, orgId, id, { kind: "reopen", reason: "It broke again." }, lead, at(6)));
    expect(r.case).toMatchObject({ status: "assigned", verifiedAt: null, assignedTo: ownerId });
    await expectReplayMatches(id);
    const after = verifiedFixRate({ cases: [await chain(id)], period: year, now: at(7).at });
    expect([after.verified.count, after.fixLogged.count, after.backInProgress.count]).toEqual([0, 1, 1]);

    // Round 2 can still be asked and verified again.
    const fixed = await t.tx((tx) => transition(tx, orgId, id, { kind: "log_fix", description: "New motor." }, owner, at(8)));
    expect(fixed.case).toMatchObject({ status: "retest_open", retestRound: 2 });
    await t.tx((tx) => transition(tx, orgId, id, { kind: "verdict", verdict: "fixed" }, reporter, at(9)));
    await expectReplayMatches(id);
  });

  it("closed (after triage) -> triaged clears the reason and the assignee; closed before triage -> new", async () => {
    const id = await assignedCase(false);
    await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "close", reason: "spam" }, lead, at(3)))).rejects.toThrow(/only before the case is assigned/);
    await t.tx((tx) => transition(tx, orgId, id, { kind: "close", reason: "duplicate" }, lead, at(3)));
    const r = await t.tx((tx) => transition(tx, orgId, id, { kind: "reopen", reason: "Not a duplicate after all." }, lead, at(4)));
    expect(r.case).toMatchObject({ status: "triaged", closedReason: null, assignedTo: null, priorityArea: "built_environment" });
    await expectReplayMatches(id);

    // D1: once it was assigned, it can't leave the numbers as spam or out of scope after the reopen either.
    for (const reason of ["spam", "out_of_scope"] as const) {
      await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "close", reason }, lead, at(5)))).rejects.toThrow(/only before the case is assigned/);
    }
    expect((await row(id)).status).toBe("triaged");

    const fresh = await insertCase(t, orgId, { receivedAt: T0 });
    await t.tx(async (tx) => {
      await appendCaseEvent(tx, { orgId, caseId: fresh.id, type: "submitted", actorKind: "reporter", actorId: null,
        payload: { channel: "web", isAnonymous: true }, createdAt: T0 });
      await transition(tx, orgId, fresh.id, { kind: "close", reason: "spam" }, lead, at(1));
    });
    const back = await t.tx((tx) => transition(tx, orgId, fresh.id, { kind: "reopen", reason: "Real feedback." }, lead, at(2)));
    expect(back.case).toMatchObject({ status: "new", closedReason: null });
    await expectReplayMatches(fresh.id);
  });
});

describe("D1 through transition(): a fixed case can't be closed out of the numbers", () => {
  it("fixed -> closed (duplicate) -> reopen -> triaged -> closed (spam) is refused, so the fix stays in the verified-fix denominator", async () => {
    const id = await assignedCase(false);
    const fixed = await t.tx((tx) => transition(tx, orgId, id, { kind: "log_fix", description: "Replaced the motor." }, owner, at(2)));
    expect(fixed.case.status).toBe("fixed_unverified");
    await t.tx((tx) => transition(tx, orgId, id, { kind: "close", reason: "no_action_possible" }, lead, at(3)));
    await t.tx((tx) => transition(tx, orgId, id, { kind: "reopen", reason: "Closed by mistake." }, lead, at(4)));
    expect((await row(id)).status).toBe("triaged");
    for (const reason of ["spam", "out_of_scope"] as const) {
      await expect(t.tx((tx) => transition(tx, orgId, id, { kind: "close", reason }, lead, at(5)))).rejects.toThrow(/only before the case is assigned/);
    }
    await t.tx((tx) => transition(tx, orgId, id, { kind: "close", reason: "no_action_possible" }, lead, at(5)));
    await expectReplayMatches(id);
    const rate = verifiedFixRate({ cases: [await chain(id)], period: { start: "2026-01-01", end: "2026-12-31" }, now: at(6).at });
    expect([rate.verified.count, rate.fixLogged.count]).toEqual([0, 1]);
  });
});

describe("D2 retriage through transition()", () => {
  it("replaces the area and public summary, keeps the status and assignee, and the replay follows", async () => {
    const id = await assignedCase();
    const r = await t.tx((tx) =>
      transition(tx, orgId, id, { kind: "retriage", priorityArea: "ict", publicSummary: "The booking page timed out. Call 416-555-0142.", reason: "Wrong area." }, lead, at(2)),
    );
    expect(r.case).toMatchObject({ status: "assigned", assignedTo: ownerId, priorityArea: "ict", publicSummary: "The booking page timed out. Call [PHONE]." });
    expect(r.event.type).toBe("triaged");
    expect(r.event.payload).toMatchObject({ retriage: true, changed: ["priorityArea", "publicSummary"], from: "assigned", to: "assigned" });
    await expectReplayMatches(id);
    // The first triage time stays the funnel's "triaged" time; the assigned clock does not restart.
    const s = replayCase(await chain(id));
    expect(s.triagedAt?.getTime()).toBe(at(0).at.getTime());
    expect(s.assignedSince?.getTime()).toBe(at(1).at.getTime());
  });
});

describe("close as a duplicate through transition() (Phase 7 T2 item 8), and the links both ways (lib/cases/duplicates.ts)", () => {
  it("finds the original in the same org only, records it, and lists the duplicate on the original until it is reopened", async () => {
    const originalId = await assignedCase(false);
    const dupId = await assignedCase(false);
    const original = await row(originalId);

    // Another org's case is never found, even by its exact id (transition() looks inside this org).
    const otherOrg = (await insertOrg(t, "Other org")).id;
    const foreign = await insertCase(t, otherOrg, { receivedAt: T0 });
    await expect(t.tx((tx) => transition(tx, orgId, dupId, { kind: "close", reason: "duplicate", duplicateOf: foreign.id }, lead, at(3))))
      .rejects.toThrow(/original not found in this org/);
    await expect(t.tx((tx) => transition(tx, orgId, dupId, { kind: "close", reason: "duplicate", duplicateOf: "not-a-uuid" }, lead, at(3))))
      .rejects.toThrow(/original not found in this org/);
    expect(await t.tx((tx) => caseByRef(tx, orgId, foreign.ref))).toBeNull();
    expect((await t.tx((tx) => caseByRef(tx, otherOrg, foreign.ref)))?.id).toBe(foreign.id);

    const r = await t.tx((tx) => transition(tx, orgId, dupId, { kind: "close", reason: "duplicate", duplicateOf: originalId }, lead, at(3)));
    expect(r.case).toMatchObject({ status: "closed", closedReason: "duplicate" });
    expect(r.event.payload).toMatchObject({ reason: "duplicate", duplicateOf: { caseId: originalId, ref: original.ref } });
    await expectReplayMatches(dupId);

    expect((await t.tx((tx) => duplicateOriginalOf(tx, orgId, dupId)))?.ref).toBe(original.ref);
    expect((await t.tx((tx) => duplicatesOf(tx, orgId, originalId))).map((d) => d.id)).toEqual([dupId]);
    expect(await t.tx((tx) => duplicatesOf(tx, otherOrg, originalId))).toEqual([]);
    expect(await t.tx((tx) => duplicateOriginalOf(tx, orgId, originalId))).toBeNull();

    // A duplicate of a duplicate is refused: point to the case it repeats.
    const third = await assignedCase(false);
    await expect(t.tx((tx) => transition(tx, orgId, third, { kind: "close", reason: "duplicate", duplicateOf: dupId }, lead, at(4))))
      .rejects.toThrow(/itself closed as a duplicate/);

    // Reopened, it is no longer a duplicate of anything: the original stops listing it.
    await t.tx((tx) => transition(tx, orgId, dupId, { kind: "reopen", reason: "Another door after all." }, lead, at(5)));
    expect(await t.tx((tx) => duplicatesOf(tx, orgId, originalId))).toEqual([]);
    expect(await t.tx((tx) => duplicateOriginalOf(tx, orgId, dupId))).toBeNull();
  });
});
