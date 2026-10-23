// Due dates on assign and the owner email (Phase 7 T2 items 6 and 7) on a real Postgres (PGlite, the real
// migrations): transition() writes cases.due_at and the `assigned` event's dueAt, and the events alone replay to the
// same assignee and due date (domain §8); "A barrier was assigned to you" is recorded in the Outbox with FAKE_EMAIL=1
// (no address is known for staff before Clerk), is not sent with real email and no address, and never carries report
// text, a /check link or a code. The pure rules are tests/queues.test.ts.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// lib/cases/after-assign.ts imports db/tenant, whose db/client needs a URL at import time. It is never used here
// (every query runs on the PGlite transaction), and postgres.js does not connect until a query runs.
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:9/unused";
});

import { and, asc, eq } from "drizzle-orm";
import { caseEvents, cases, outboundMessages } from "@/db/schema";
import { appendCaseEvent, verifyCaseChain } from "@/lib/case-events";
import { ownerToldSentence, tellAssignee, type OwnerTold } from "@/lib/cases/after-assign";
import { describeEvent } from "@/lib/cases/history";
import { EMAIL_AUDIENCE, EMAIL_TEMPLATE_LABELS, renderEmail, renderForDisplay } from "@/lib/email/templates";
import { dueAtForDate, replayCase, type MetricCase } from "@/lib/metrics";
import { transition, type Actor } from "@/lib/state-machine";
import { insertCase, insertMember, insertOrg, startTestDb, type TestDb } from "./support/pglite-db";

const T0 = new Date("2026-10-01T14:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number) => ({ at: new Date(T0.getTime() + days * DAY) });

let t: TestDb;
let orgId: string;
let lead: Actor & { kind: "staff" };
let ownerId: string;
let otherId: string;
const saved = { ...process.env };

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://accessloop.example";
  t = await startTestDb();
  orgId = (await insertOrg(t, "Queue test org")).id;
  const l = await insertMember(t, orgId, "lead", "Test lead");
  ownerId = (await insertMember(t, orgId, "owner", "Facilities team")).id;
  otherId = (await insertMember(t, orgId, "owner", "Web team")).id;
  lead = { kind: "staff", memberId: l.id, role: "lead" };
}, 60_000);

afterAll(async () => {
  await t?.close();
  process.env = { ...saved };
});

afterEach(() => {
  process.env.FAKE_EMAIL = "1";
});

/** A web case, redaction approved and triaged at T0. */
async function triagedCase() {
  const c = await insertCase(t, orgId, { receivedAt: T0 });
  await t.tx(async (tx) => {
    await appendCaseEvent(tx, { orgId, caseId: c.id, type: "submitted", actorKind: "reporter", actorId: null,
      payload: { channel: "web", isAnonymous: true }, createdAt: T0 });
    await appendCaseEvent(tx, { orgId, caseId: c.id, type: "redaction_approved", actorKind: "staff", actorId: lead.memberId,
      payload: { spans: [] }, createdAt: T0 });
    await transition(tx, orgId, c.id, { kind: "triage", priorityArea: "built_environment", publicSummary: "A door did not open." }, lead, at(0));
  });
  return c;
}

async function row(id: string) {
  const [r] = await t.db.select().from(cases).where(eq(cases.id, id));
  return r;
}

async function chain(id: string, ref: string): Promise<MetricCase> {
  const events = await t.db.select().from(caseEvents).where(eq(caseEvents.caseId, id)).orderBy(asc(caseEvents.seq));
  return { id, ref, events: events.map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, createdAt: e.createdAt, hash: e.hash })) };
}

/** The log alone gives the projection's assignee and due date. */
async function expectReplayMatches(id: string, ref: string) {
  const r = await row(id);
  const s = replayCase(await chain(id, ref));
  expect({ status: s.status, assignedTo: s.assignedTo, dueAt: s.dueAt?.getTime() ?? null })
    .toEqual({ status: r.status, assignedTo: r.assignedTo, dueAt: r.dueAt?.getTime() ?? null });
  expect((await t.tx((tx) => verifyCaseChain(tx, orgId, id))).ok).toBe(true);
}

describe("D8: the due date set on assign, through transition()", () => {
  it("is written to cases.due_at and the assigned event, kept, changed and cleared, and replays from the log", async () => {
    const c = await triagedCase();
    const due = dueAtForDate("2026-10-20");
    const r = await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId, dueAt: due }, lead, at(1)));
    expect(r.case.dueAt?.getTime()).toBe(due.getTime());
    expect(r.event.payload).toMatchObject({ memberId: ownerId, dueAt: due.toISOString(), from: "triaged", to: "assigned" });
    await expectReplayMatches(c.id, c.ref);

    // Reassigned by code that says nothing about a due date (the seed, fixtures): the date stays.
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: otherId }, lead, at(2)));
    expect((await row(c.id)).dueAt?.getTime()).toBe(due.getTime());
    await expectReplayMatches(c.id, c.ref);

    // The form always says: a new date, or none.
    const later = dueAtForDate("2026-11-30");
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: otherId, dueAt: later }, lead, at(3)));
    expect((await row(c.id)).dueAt?.getTime()).toBe(later.getTime());
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: otherId, dueAt: null }, lead, at(4)));
    expect((await row(c.id)).dueAt).toBeNull();
    await expectReplayMatches(c.id, c.ref);
  });

  it("a reopen from closed clears the assignee and the due date, in the row and in the replay", async () => {
    const c = await triagedCase();
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId, dueAt: dueAtForDate("2026-10-10") }, lead, at(1)));
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "close", reason: "duplicate" }, lead, at(2)));
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "reopen", reason: "Not a duplicate after all." }, lead, at(3)));
    const r = await row(c.id);
    expect(r.status).toBe("triaged");
    expect(r.assignedTo).toBeNull();
    expect(r.dueAt).toBeNull();
    await expectReplayMatches(c.id, c.ref);
  });

  it("the History shows the due date with the assignment", async () => {
    const c = await triagedCase();
    const r = await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId, dueAt: dueAtForDate("2026-11-03") }, lead, at(1)));
    const line = describeEvent(
      { seq: r.event.seq, type: r.event.type, actorKind: "staff", actorId: lead.memberId, payload: r.event.payload },
      { isLead: true, memberName: (id) => (id === ownerId ? "Facilities team" : id === lead.memberId ? "Test lead" : null) },
    );
    expect(line.title).toBe("Assigned to Facilities team");
    expect(line.bodyLabel).toBe("Due date");
    expect(line.body).toBe("November 3, 2026");
  });
});

/* ------------------------------------------------------------------ "A barrier was assigned to you" */

const DATA = {
  orgName: "Maple Harbour Bank",
  designateTitle: "Director, Accessibility and Inclusion",
  ref: "BAR-0042",
  checkUrl: "https://accessloop.example/check",
  caseUrl: "https://accessloop.example/app/cases/BAR-0042",
};
const CODE = "7K3M-9Q2D-XW4H-B8RT";
const FORBIDDEN = [/priority area/i, /barrier classification/i, /complian/i, /certified/i, /guarantee/i, /undefined/, /null/, /\{|\}/, /\[object/];

describe("the owner_assigned email", () => {
  it("names the case and links to its staff page, with no report text, no /check link and no code", () => {
    expect(EMAIL_AUDIENCE.owner_assigned).toBe("owner");
    expect(EMAIL_TEMPLATE_LABELS.owner_assigned).toBe("Assignment email to the owner");
    const e = renderEmail("owner_assigned", { ...DATA, code: CODE, retestUrl: "https://accessloop.example/r/t/abc" });
    expect(e.subject).toBe("A barrier was assigned to you: BAR-0042");
    for (const part of [e.text, e.html]) {
      expect(part).toContain(DATA.orgName);
      expect(part).toContain(DATA.designateTitle);
      expect(part).toContain(DATA.caseUrl);
      expect(part).not.toContain(DATA.checkUrl);
      expect(part).not.toContain(CODE);
      expect(part).not.toContain("/r/t/");
    }
    expect(e.html).toContain(`<a href="${DATA.caseUrl}">`);
    expect(e.text).toContain("It never holds report text");
    const text = `${e.subject}\n${e.text}`;
    for (const bad of FORBIDDEN) expect(text, String(bad)).not.toMatch(bad);
    for (const sentence of e.text.split(/(?<=[.?!:])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(35);
    // The Outbox shows it again exactly, with the same link.
    expect(renderForDisplay("owner_assigned", DATA, false).text).toBe(renderEmail("owner_assigned", DATA).text);
  });
});

describe("tellAssignee: the email after an assignment", () => {
  async function assigned(memberId = ownerId) {
    const c = await triagedCase();
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId, dueAt: null }, lead, at(1)));
    return c;
  }
  const outbox = (caseId: string) =>
    t.db.select().from(outboundMessages).where(and(eq(outboundMessages.orgId, orgId), eq(outboundMessages.caseId, caseId)));

  it("with FAKE_EMAIL=1 it is logged to the Outbox and recorded on the case, by the lead, without any address", async () => {
    process.env.FAKE_EMAIL = "1";
    const c = await assigned();
    const told = await tellAssignee({ orgId, caseId: c.id, ref: c.ref, memberId: ownerId, assignedBy: lead.memberId }, t.tx);
    expect(told).toEqual({ kind: "logged" });
    const rows = await outbox(c.id);
    expect(rows.map((r) => [r.template, r.status, r.channel])).toEqual([["owner_assigned", "skipped_fake", "email"]]);
    const events = await t.db.select().from(caseEvents).where(eq(caseEvents.caseId, c.id)).orderBy(asc(caseEvents.seq));
    const sent = events.filter((e) => e.type === "message_sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].actorKind).toBe("staff");
    expect(sent[0].actorId).toBe(lead.memberId);
    expect(sent[0].payload).toEqual({ template: "owner_assigned", channel: "email", status: "skipped_fake", messageId: rows[0].id, codeIncluded: false });
    const history = describeEvent(
      { seq: sent[0].seq, type: sent[0].type, actorKind: "staff", actorId: lead.memberId, payload: sent[0].payload },
      { isLead: true, memberName: () => "Test lead" },
    );
    expect(history.title).toBe("Email logged, not sent (simulated): assignment email to the owner");
  });

  it("with real email and no address known for staff (before Clerk), nothing is sent or recorded", async () => {
    delete process.env.FAKE_EMAIL;
    const c = await assigned();
    const told = await tellAssignee({ orgId, caseId: c.id, ref: c.ref, memberId: ownerId, assignedBy: lead.memberId }, t.tx);
    expect(told).toEqual({ kind: "no_address" });
    expect(await outbox(c.id)).toEqual([]);
  });

  it("says nothing when the case moved on in between (assigned to someone else, or no longer assigned)", async () => {
    const c = await assigned(otherId);
    expect(await tellAssignee({ orgId, caseId: c.id, ref: c.ref, memberId: ownerId, assignedBy: lead.memberId }, t.tx)).toBeNull();
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "close", reason: "duplicate" }, lead, at(2)));
    expect(await tellAssignee({ orgId, caseId: c.id, ref: c.ref, memberId: otherId, assignedBy: lead.memberId }, t.tx)).toBeNull();
    expect(await outbox(c.id)).toEqual([]);
  });

  it("the Assign answer says what happened, never that they were told when nobody was", () => {
    const cases: [OwnerTold, string][] = [
      [{ kind: "emailed" }, "Facilities team was emailed that it is theirs."],
      [{ kind: "logged" }, "The email telling Facilities team was logged, not sent (email is simulated in this prototype; the Outbox shows it)."],
      [{ kind: "failed" }, "The email telling Facilities team could not be sent, so tell them another way."],
      [{ kind: "not_sent" }, "No email went to Facilities team, so tell them another way."],
      [{ kind: "no_address" }, "No email address is on file for Facilities team, so no email was sent: tell them another way."],
    ];
    for (const [told, words] of cases) expect(ownerToldSentence(told, "Facilities team")).toBe(words);
  });
});
