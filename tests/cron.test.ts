// The daily job (app/api/cron/daily, lib/cron; docs/phase7-prompt.md T3 item 12; docs/domain.md §3, §10):
// - only `Authorization: Bearer ${CRON_SECRET}` runs it (constant-time, exact);
// - the plan per case: the round's one reminder a week after the request, only to a reporter who gave an email and
//   had no reminder this round; expire_retest at 60 days, only with CRON_EXPIRE_RETEST=1; one owner alert per
//   stretch in "assigned" (past due, else no fix for 30+ days, the dashboard's own rule);
// - the run on a real Postgres (PGlite with the real migrations): what it writes (through the frozen state machine
//   and the mailer), that a second run writes nothing, that a dry run writes nothing, and that with real email and no
//   staff address it sends nothing.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:9/unused";
});

import { and, asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { appendCaseEvent } from "@/lib/case-events";
import { createCase } from "@/lib/cases/create";
import { bearerMatches } from "@/lib/cron/auth";
import { RETEST_REMINDER_AFTER_DAYS, planDailyCase, roundRequestedAt, type DailyCaseInput } from "@/lib/cron/daily";
import { runDailyJob, type OrgTxRunner } from "@/lib/cron/run";
import type { MetricEvent } from "@/lib/metrics/replay";
import { readRetestLink, retestLinkSecret } from "@/lib/retest-link";
import { transition, type Actor } from "@/lib/state-machine";
import { insertMember, insertOrg, startTestDb, type TestDb } from "./support/pglite-db";

const DAY = 86_400_000;
const NOW = new Date("2026-10-20T15:00:00.000Z");
const ago = (days: number, from = NOW) => new Date(from.getTime() - days * DAY);

/* ------------------------------------------------------------------ who may run it */

describe("bearerMatches", () => {
  const SECRET = "a-cron-secret-of-at-least-32-characters-long";
  it("accepts exactly `Bearer <secret>` and nothing else", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET} `, SECRET)).toBe(true);
    for (const header of [null, undefined, "", SECRET, `Basic ${SECRET}`, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(1)}`, `Bearer  `, `Bearer ${SECRET} extra`]) {
      expect(bearerMatches(header, SECRET), String(header)).toBe(false);
    }
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches(`Bearer ${SECRET}`, "")).toBe(false);
  });
});

/* ------------------------------------------------------------------ the plan (pure) */

let seq = 0;
const ev = (type: string, at: Date, payload: Record<string, unknown> = {}): MetricEvent => ({ seq: ++seq, type, payload, createdAt: at });

/** A case's events up to an open re-test round requested at `requestedAt`. */
function retestOpen(requestedAt: Date, opts: { email?: boolean; round?: number } = {}): MetricEvent[] {
  const round = opts.round ?? 1;
  const received = ago(40, requestedAt);
  return [
    ev("submitted", received, { channel: "web", isAnonymous: !opts.email, hasEmail: opts.email ?? false }),
    ev("triaged", ago(30, requestedAt), { from: "new", to: "triaged" }),
    ev("assigned", ago(20, requestedAt), { from: "triaged", to: "assigned", memberId: "m" }),
    ev("fix_logged", requestedAt, { from: "assigned", to: "retest_open", retestRound: round }),
    ev("retest_requested", new Date(requestedAt.getTime() + 1), { round }),
  ];
}

const caseOf = (events: MetricEvent[], over: Partial<DailyCaseInput> = {}): DailyCaseInput => ({
  id: "c1",
  ref: "BAR-0001",
  status: "retest_open",
  retestRound: 1,
  assignedTo: "m",
  events,
  ...over,
});

describe("planDailyCase: the re-test round", () => {
  const off = { expireRetest: false };
  const on = { expireRetest: true };

  it("reminds once a week after the request, only a reporter who gave an email", () => {
    expect(RETEST_REMINDER_AFTER_DAYS).toBe(7);
    // The request event is 1 ms after the fix, so "7 days after the request" is 7 days and 1 ms after the fix.
    expect(planDailyCase(caseOf(retestOpen(new Date(ago(7).getTime() - 1), { email: true })), NOW, off)).toEqual({ expire: false, remind: true, ownerAlert: null });
    expect(planDailyCase(caseOf(retestOpen(ago(7), { email: true })), NOW, off).remind).toBe(false);
    expect(planDailyCase(caseOf(retestOpen(ago(6.9), { email: true })), NOW, off).remind).toBe(false);
    expect(planDailyCase(caseOf(retestOpen(ago(20), { email: false })), NOW, off).remind).toBe(false);
  });

  it("does not remind again after this round's reminder (sent or simulated), but does after a failed one", () => {
    const events = retestOpen(ago(10), { email: true });
    const sent = [...events, ev("message_sent", ago(1), { template: "retest_reminder", status: "skipped_fake", round: 1 })];
    expect(planDailyCase(caseOf(sent), NOW, off).remind).toBe(false);
    const failed = [...events, ev("message_sent", ago(1), { template: "retest_reminder", status: "failed", round: 1 })];
    expect(planDailyCase(caseOf(failed), NOW, off).remind).toBe(true);
    // A reminder of round 1 does not count for round 2.
    const round2 = [...sent, ...retestOpen(ago(8), { email: true, round: 2 }).slice(3)];
    expect(roundRequestedAt(round2, 2)?.getTime()).toBe(ago(8).getTime() + 1);
    expect(planDailyCase(caseOf(round2, { retestRound: 2 }), NOW, off).remind).toBe(true);
  });

  it("expires a round open 60 days only when CRON_EXPIRE_RETEST=1, and then does not also remind", () => {
    const old = caseOf(retestOpen(new Date(ago(60).getTime() - 1), { email: true }));
    expect(planDailyCase(old, NOW, on)).toEqual({ expire: true, remind: false, ownerAlert: null });
    expect(planDailyCase(old, NOW, off)).toEqual({ expire: false, remind: true, ownerAlert: null });
    expect(planDailyCase(caseOf(retestOpen(ago(59), { email: true })), NOW, on).expire).toBe(false);
  });

  it("does nothing for a round with no request event, or for other statuses", () => {
    expect(planDailyCase(caseOf(retestOpen(ago(70), { email: true }).slice(0, 4)), NOW, on)).toEqual({ expire: false, remind: false, ownerAlert: null });
    for (const status of ["new", "triaged", "verified", "fixed_unverified", "closed"] as const) {
      expect(planDailyCase(caseOf(retestOpen(ago(70), { email: true }), { status }), NOW, on), status).toEqual({ expire: false, remind: false, ownerAlert: null });
    }
  });
});

describe("planDailyCase: owner alerts", () => {
  const off = { expireRetest: false };
  const assigned = (since: Date) => [
    ev("submitted", ago(10, since), { channel: "web", isAnonymous: true }),
    ev("triaged", ago(5, since), { from: "new", to: "triaged" }),
    ev("assigned", since, { from: "triaged", to: "assigned", memberId: "m" }),
  ];
  const at = (events: MetricEvent[], over: Partial<DailyCaseInput> = {}) => caseOf(events, { status: "assigned", ...over });

  it("alerts the owner once when no fix is logged for 30+ days (the dashboard's stalled rule)", () => {
    expect(planDailyCase(at(assigned(ago(30))), NOW, off).ownerAlert).toBe("stalled");
    expect(planDailyCase(at(assigned(ago(28))), NOW, off).ownerAlert).toBeNull();
    const told = [...assigned(ago(31)), ev("message_sent", ago(1), { template: "owner_stalled", status: "skipped_fake" })];
    expect(planDailyCase(at(told), NOW, off).ownerAlert).toBeNull();
    // Nobody is assigned: nobody to tell.
    expect(planDailyCase(at(assigned(ago(40)), { assignedTo: null }), NOW, off).ownerAlert).toBeNull();
  });

  it("past its due date: the overdue alert first, once; then no stalled alert in the same stretch", () => {
    const events = assigned(ago(40));
    expect(planDailyCase(at(events, { dueAt: ago(1) }), NOW, off).ownerAlert).toBe("overdue");
    expect(planDailyCase(at(events, { dueAt: new Date(NOW.getTime() + DAY) }), NOW, off).ownerAlert).toBe("stalled");
    const told = [...events, ev("message_sent", ago(1), { template: "owner_overdue", status: "sent" })];
    expect(planDailyCase(at(told, { dueAt: ago(2) }), NOW, off).ownerAlert).toBeNull();
    expect(planDailyCase(at(told, { dueAt: null }), NOW, off).ownerAlert).toBeNull();
  });

  it("a new stretch in assigned (the re-test said it only partly works) may alert again", () => {
    const first = [...assigned(ago(100)), ev("message_sent", ago(69), { template: "owner_stalled", status: "skipped_fake" })];
    const later = [
      ...first,
      ev("fix_logged", ago(65), { from: "assigned", to: "retest_open", retestRound: 1 }),
      ev("retest_requested", ago(65), { round: 1 }),
      ev("retest_verdict", ago(35), { from: "retest_open", to: "assigned", verdict: "partly", round: 1 }),
    ];
    expect(planDailyCase(at(later, { retestRound: 1 }), NOW, off).ownerAlert).toBe("stalled");
  });
});

/* ------------------------------------------------------------------ the run, on a real Postgres */

let t: TestDb;
let orgId: string;
let leadId: string;
let ownerId: string;
const saved = { ...process.env };
const ADDRESS = "reporter.person@example.com";
const inOrg: OrgTxRunner = (_ctx, fn) => t.tx(fn);
const run = (options: { dryRun?: boolean; expireRetest?: boolean } = {}) =>
  runDailyJob({ orgIds: async () => [orgId], inOrg, expireRetest: false, ...options });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.RECEIPT_PEPPER = "test-pepper";
  process.env.APP_URL = "https://accessloop.example";
  process.env.FAKE_EMAIL = "1";
  process.env.AUTH_MODE = "local";
  process.env.SESSION_SECRET = "a-test-session-secret-of-at-least-32-characters";
  delete process.env.VERCEL;
  delete process.env.RETEST_LINK_SECRET;
  t = await startTestDb();
  orgId = (await insertOrg(t, "Cron Test Bank")).id;
  leadId = (await insertMember(t, orgId, "lead", "Alex Test")).id;
  ownerId = (await insertMember(t, orgId, "owner", "Facilities test")).id;
}, 60_000);

afterAll(async () => {
  await t.close();
  process.env = { ...saved };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.FAKE_EMAIL = "1";
});



/** A web case received `receivedDaysAgo`, moved with the frozen state machine at past times. */
async function makeCase(opts: {
  email?: boolean;
  receivedDaysAgo: number;
  until: "assigned" | "retest_open";
  assignedDaysAgo?: number;
  fixDaysAgo?: number;
  /** D8: the due date the lead sets with the assignment (cases.due_at), this many days before now. */
  dueDaysAgo?: number;
}) {
  const { case: c } = await t.tx((tx) =>
    createCase(tx, {
      orgId,
      intakeChannel: "web",
      locationKind: "place",
      rawText: "The automatic door button is broken.",
      redactedText: "The automatic door button is broken.",
      spans: [],
      needsManualRedaction: false,
      isAnonymous: !opts.email,
      wantsRetest: true,
      aiOptOut: false,
      reporterEmail: opts.email ? ADDRESS : null,
      receivedAt: ago(opts.receivedDaysAgo, new Date()),
      summary: null,
      summarySource: "reporter_words",
      loggedByMemberId: null,
    }),
  );
  const asLead: Actor = { kind: "staff", memberId: leadId, role: "lead" };
  const now = new Date();
  const assignedAt = ago(opts.assignedDaysAgo ?? opts.receivedDaysAgo - 1, now);
  await t.tx((tx) =>
    appendCaseEvent(tx, { orgId, caseId: c.id, type: "redaction_approved", actorKind: "staff", actorId: leadId, payload: { spans: [] }, createdAt: new Date(assignedAt.getTime() - 2000) }),
  );
  await t.tx((tx) =>
    transition(tx, orgId, c.id, { kind: "triage", priorityArea: "built_environment", publicSummary: "A door did not open." }, asLead, { at: new Date(assignedAt.getTime() - 1000) }),
  );
  const dueAt = opts.dueDaysAgo === undefined ? undefined : ago(opts.dueDaysAgo, now);
  await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId, dueAt }, asLead, { at: assignedAt }));
  if (opts.until === "retest_open") {
    await t.tx((tx) =>
      transition(tx, orgId, c.id, { kind: "log_fix", description: "Replaced the motor." }, { kind: "staff", memberId: ownerId, role: "owner" }, { at: ago(opts.fixDaysAgo ?? 0, now) }),
    );
  }
  return c;
}

async function rowsOf(caseId: string) {
  const [c] = await t.db.select().from(schema.cases).where(eq(schema.cases.id, caseId));
  const messages = await t.db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.caseId, caseId));
  const events = await t.db.select().from(schema.caseEvents).where(eq(schema.caseEvents.caseId, caseId)).orderBy(asc(schema.caseEvents.seq));
  return { status: c.status, messages, events };
}

const allOutbound = () => t.db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.orgId, orgId));
const allEvents = () => t.db.select().from(schema.caseEvents).where(eq(schema.caseEvents.orgId, orgId));

describe("runDailyJob", () => {
  it("a dry run counts what is due and writes nothing; a run does it once; a second run does nothing", async () => {
    const remindMe = await makeCase({ email: true, receivedDaysAgo: 30, until: "retest_open", fixDaysAgo: 8 });
    const anonymous = await makeCase({ email: false, receivedDaysAgo: 30, until: "retest_open", fixDaysAgo: 8 });
    const tooSoon = await makeCase({ email: true, receivedDaysAgo: 30, until: "retest_open", fixDaysAgo: 3 });
    const stalled = await makeCase({ receivedDaysAgo: 45, until: "assigned", assignedDaysAgo: 31 });
    const fresh = await makeCase({ receivedDaysAgo: 6, until: "assigned", assignedDaysAgo: 5 });

    const outboundBefore = (await allOutbound()).length;
    const eventsBefore = (await allEvents()).length;
    const dry = await run({ dryRun: true });
    expect(dry).toMatchObject({ ok: true, dryRun: true, orgs: 1 });
    expect(dry.reminders).toMatchObject({ due: 1, done: 0 });
    expect(dry.ownerAlerts).toMatchObject({ due: 1, done: 0 });
    expect(dry.expiry).toMatchObject({ enabled: false, due: 0 });
    expect((await allOutbound()).length).toBe(outboundBefore);
    expect((await allEvents()).length).toBe(eventsBefore);

    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    const first = await run();
    expect(first).toMatchObject({ ok: true, dryRun: false });
    expect(first.reminders).toMatchObject({ due: 1, done: 1, failed: 0, skipped: 0, errors: 0, noEmail: 0 });
    expect(first.ownerAlerts).toMatchObject({ due: 1, done: 1, failed: 0, skipped: 0, errors: 0, noAddress: 0 });

    // The reminder: one, from the system, with this round's link (never stored), and still waiting for the reporter.
    const r = await rowsOf(remindMe.id);
    expect(r.status).toBe("retest_open");
    expect(r.messages.map((m) => [m.template, m.status])).toEqual([["retest_reminder", "skipped_fake"]]);
    const reminder = r.events.find((e) => e.type === "message_sent")!;
    expect(reminder.actorKind).toBe("system");
    expect(reminder.payload).toMatchObject({ template: "retest_reminder", status: "skipped_fake", round: 1, linkIncluded: true, codeIncluded: false });
    expect(JSON.stringify(r)).not.toContain(ADDRESS);
    // The owner alert: one, on the stalled case, from the system.
    const s = await rowsOf(stalled.id);
    expect(s.messages.map((m) => [m.template, m.status])).toEqual([["owner_stalled", "skipped_fake"]]);
    expect(s.events.find((e) => e.type === "message_sent")!.payload).toMatchObject({ template: "owner_stalled", status: "skipped_fake" });
    for (const other of [anonymous, tooSoon, fresh]) expect((await rowsOf(other.id)).messages, other.ref).toEqual([]);
    for (const spy of logs) for (const call of spy.mock.calls) expect(call.join(" ")).not.toMatch(/example\.com|BAR-/);

    const second = await run();
    expect(second.reminders.due).toBe(0);
    expect(second.ownerAlerts.due).toBe(0);
    expect((await rowsOf(remindMe.id)).messages).toHaveLength(1);
    expect((await rowsOf(stalled.id)).messages).toHaveLength(1);
  });

  it("reads cases.due_at: a case past its due date (not stalled yet) gets one owner_overdue alert, and a second run sends none", async () => {
    // Before the integration fix lib/cron/run.ts never passed dueAt, so no case was ever overdue (docs/decisions.md).
    const overdue = await makeCase({ receivedDaysAgo: 8, until: "assigned", assignedDaysAgo: 5, dueDaysAgo: 1 });
    const notYet = await makeCase({ receivedDaysAgo: 8, until: "assigned", assignedDaysAgo: 5, dueDaysAgo: -3 });
    const first = await run();
    expect(first.ownerAlerts).toMatchObject({ due: 1, done: 1, failed: 0, errors: 0, noAddress: 0 });
    const o = await rowsOf(overdue.id);
    expect(o.status).toBe("assigned");
    expect(o.messages.map((m) => [m.template, m.status])).toEqual([["owner_overdue", "skipped_fake"]]);
    const sent = o.events.find((e) => e.type === "message_sent")!;
    expect(sent.actorKind).toBe("system");
    expect(sent.payload).toMatchObject({ template: "owner_overdue", status: "skipped_fake" });
    expect((await rowsOf(notYet.id)).messages).toEqual([]);

    const second = await run();
    expect(second.ownerAlerts.due).toBe(0);
    expect((await rowsOf(overdue.id)).messages).toHaveLength(1);
  });

  it("expires a round open 60 days through the state machine only with CRON_EXPIRE_RETEST=1", async () => {
    const old = await makeCase({ receivedDaysAgo: 80, until: "retest_open", fixDaysAgo: 61 });
    const off = await run({ expireRetest: false });
    expect(off.expiry).toMatchObject({ enabled: false, due: 0, done: 0 });
    expect((await rowsOf(old.id)).status).toBe("retest_open");

    const on = await run({ expireRetest: true });
    expect(on.expiry).toMatchObject({ enabled: true, due: 1, done: 1, errors: 0 });
    const after = await rowsOf(old.id);
    expect(after.status).toBe("fixed_unverified");
    const expired = after.events.find((e) => e.type === "retest_expired")!;
    expect(expired.actorKind).toBe("system");
    expect(expired.payload).toMatchObject({ from: "retest_open", to: "fixed_unverified", afterDays: 60 });
    expect((await run({ expireRetest: true })).expiry.due).toBe(0);
  });

  it("with real email and no staff address on file, an owner alert is not sent and is counted as no address", async () => {
    const stalled = await makeCase({ receivedDaysAgo: 50, until: "assigned", assignedDaysAgo: 35 });
    process.env.FAKE_EMAIL = "0";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const summary = await run();
    expect(summary.ownerAlerts).toMatchObject({ due: 1, done: 0, noAddress: 1 });
    expect((await rowsOf(stalled.id)).messages).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the reminder's link opens exactly that case's round", async () => {
    const c = await makeCase({ email: true, receivedDaysAgo: 20, until: "retest_open", fixDaysAgo: 9 });
    const sendSpy = vi.spyOn(await import("@/lib/email/send"), "deliverEmail");
    await run();
    const queued = sendSpy.mock.calls.map((call) => call[0]).find((q) => q.caseId === c.id && q.template === "retest_reminder");
    expect(queued).toBeDefined();
    const token = /\/r\/t\/([A-Za-z0-9_-]+)/.exec(queued!.email.text)?.[1];
    expect(readRetestLink(token ?? "", retestLinkSecret())).toMatchObject({ orgId, caseId: c.id, round: 1 });
    const [row] = await t.db.select().from(schema.cases).where(and(eq(schema.cases.orgId, orgId), eq(schema.cases.id, c.id)));
    expect(row.status).toBe("retest_open");
  });
});
