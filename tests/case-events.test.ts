// lib/case-events.ts (frozen): the per-case hash chain (docs/domain.md §8), on a real Postgres (PGlite) with the
// real migrations. The test DB has no security SQL, so raw SQL can tamper with events the way a DB owner could
// after disabling the trigger; verifyCaseChain must notice.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { caseEvents, cases } from "@/db/schema";
import {
  GENESIS_HASH,
  appendCaseEvent,
  canonicalJson,
  computeHash,
  verifyCaseChain,
  type NewEvent,
} from "@/lib/case-events";
import { sha256Hex } from "@/lib/crypto";
import { transition, type Actor } from "@/lib/state-machine";
import { insertCase, insertMember, insertOrg, startTestDb, type TestDb } from "./support/pglite-db";

describe("canonicalJson", () => {
  it("is independent of key order, at every depth", () => {
    const a = { b: 1, a: { y: [1, { q: 1, p: 2 }], x: "s" } };
    const b = { a: { x: "s", y: [1, { p: 2, q: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"x":"s","y":[1,{"p":2,"q":1}]},"b":1}');
  });

  it("drops undefined values but keeps null", () => {
    expect(canonicalJson({ a: 1, b: undefined, c: null })).toBe('{"a":1,"c":null}');
    expect(canonicalJson({ a: undefined })).toBe("{}");
  });

  it("keeps array order (arrays are data, not sets)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });

  it("writes Dates as ISO strings and scalars as JSON", () => {
    expect(canonicalJson(new Date("2026-10-19T12:00:00.123Z"))).toBe('"2026-10-19T12:00:00.123Z"');
    expect(canonicalJson({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
    expect(canonicalJson("é \"q\"")).toBe(JSON.stringify("é \"q\""));
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(1.5)).toBe("1.5");
  });

  it("has no whitespace", () => {
    expect(canonicalJson({ "a b": [1, 2], c: { d: "e f" } })).toBe('{"a b":[1,2],"c":{"d":"e f"}}');
  });
});

describe("computeHash", () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const CASE = "22222222-2222-4222-8222-222222222222";
  const e1 = { orgId: ORG, caseId: CASE, seq: 1, type: "submitted", actorKind: "reporter", actorId: null,
    payload: { channel: "web" }, createdAt: new Date("2026-10-19T12:00:00.000Z") };
  const e2 = { ...e1, seq: 2, type: "ack_recorded", payload: { channel: "web_screen" },
    createdAt: new Date("2026-10-19T12:00:00.001Z") };

  it("is sha256(prev + newline + canonical event) and starts from the all-zero genesis hash", () => {
    expect(GENESIS_HASH).toBe("0".repeat(64));
    const expected = sha256Hex(GENESIS_HASH + "\n" + canonicalJson({
      orgId: ORG, caseId: CASE, seq: 1, type: "submitted", actorKind: "reporter", actorId: null,
      payload: { channel: "web" }, createdAt: "2026-10-19T12:00:00.000Z",
    }));
    expect(computeHash(GENESIS_HASH, e1)).toBe(expected);
  });

  it("chains: each hash depends on the one before", () => {
    const h1 = computeHash(GENESIS_HASH, e1);
    const h2 = computeHash(h1, e2);
    expect(h2).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHash("f".repeat(64), e2)).not.toBe(h2);
    expect(computeHash(h1, e2)).toBe(h2); // deterministic
  });

  it("changes when any hashed field changes", () => {
    const h = computeHash(GENESIS_HASH, e1);
    const variants = [
      { ...e1, orgId: "33333333-3333-4333-8333-333333333333" },
      { ...e1, caseId: "33333333-3333-4333-8333-333333333333" },
      { ...e1, seq: 2 },
      { ...e1, type: "note_added" },
      { ...e1, actorKind: "staff" },
      { ...e1, actorId: "someone" },
      { ...e1, payload: { channel: "email" } },
      { ...e1, createdAt: new Date("2026-10-19T12:00:00.001Z") },
    ];
    for (const v of variants) expect(computeHash(GENESIS_HASH, v)).not.toBe(h);
  });

  it("ignores payload key order and undefined fields", () => {
    const a = { ...e1, payload: { a: 1, b: 2, c: undefined } };
    const b = { ...e1, payload: { b: 2, a: 1 } };
    expect(computeHash(GENESIS_HASH, a)).toBe(computeHash(GENESIS_HASH, b));
  });
});

describe("the chain on a real Postgres", () => {
  let t: TestDb;
  let orgId: string;

  beforeAll(async () => {
    t = await startTestDb();
    orgId = (await insertOrg(t)).id;
  }, 60_000);
  afterAll(async () => {
    await t?.close();
  });

  /** Five events like a web intake + review, with fixed times so the test is deterministic. */
  async function caseWithEvents(n = 5) {
    const c = await insertCase(t, orgId);
    const base = Date.parse("2026-10-19T12:00:00.000Z");
    const types: NewEvent["type"][] = ["submitted", "ack_recorded", "ai_structured", "redaction_proposed", "note_added"];
    const rows = await t.tx(async (tx) => {
      const out: Awaited<ReturnType<typeof appendCaseEvent>>[] = [];
      for (let i = 0; i < n; i++) {
        out.push(await appendCaseEvent(tx, {
          orgId, caseId: c.id, type: types[i % types.length], actorKind: i === 0 ? "reporter" : "system", actorId: null,
          payload: { step: i + 1, text: `[PERSON] said step ${i + 1}`, nested: { z: 1, a: [i, "x"] } },
          createdAt: new Date(base + i * 1000),
        }));
      }
      return out;
    });
    return { c, rows };
  }

  const verify = (caseId: string) => t.tx((tx) => verifyCaseChain(tx, orgId, caseId));
  const rawUpdate = (sql: string, params: unknown[]) => t.client.query(sql, params);

  it("appendCaseEvent numbers events 1..n and links each to the one before", async () => {
    const { rows } = await caseWithEvents();
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0].prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < rows.length; i++) expect(rows[i].prevHash).toBe(rows[i - 1].hash);
    expect(new Set(rows.map((r) => r.hash)).size).toBe(5);
  });

  it("verifyCaseChain is ok, with the head hash and the length", async () => {
    const { c, rows } = await caseWithEvents();
    const check = await verify(c.id);
    expect(check).toEqual({ ok: true, headHash: rows[4].hash, length: 5 });
  });

  it("the stored rows hash to the same values after the jsonb and timestamp round trip", async () => {
    const { c, rows } = await caseWithEvents();
    const stored = await t.db.select().from(caseEvents).where(eq(caseEvents.caseId, c.id)).orderBy(asc(caseEvents.seq));
    let prev = GENESIS_HASH;
    for (const [i, r] of stored.entries()) {
      expect(r.createdAt.toISOString()).toBe(rows[i].createdAt.toISOString());
      expect(computeHash(prev, r)).toBe(r.hash);
      prev = r.hash;
    }
  });

  it("an empty chain is ok, with the genesis hash and length 0", async () => {
    const c = await insertCase(t, orgId);
    expect(await verify(c.id)).toEqual({ ok: true, headHash: GENESIS_HASH, length: 0 });
  });

  it("chains are per case: appending to one case never touches another", async () => {
    const a = await caseWithEvents(3);
    const b = await caseWithEvents(2);
    expect(b.rows.map((r) => r.seq)).toEqual([1, 2]);
    expect(b.rows[0].prevHash).toBe(GENESIS_HASH);
    expect((await verify(a.c.id)).length).toBe(3);
    expect((await verify(b.c.id)).length).toBe(2);
  });

  it("only checks the case inside the given org", async () => {
    const { c } = await caseWithEvents(2);
    const otherOrg = (await insertOrg(t, "Another org")).id;
    const check = await t.tx((tx) => verifyCaseChain(tx, otherOrg, c.id));
    expect(check).toEqual({ ok: true, headHash: GENESIS_HASH, length: 0 });
  });

  it("detects an edited payload, at the edited event", async () => {
    const { c, rows } = await caseWithEvents();
    await rawUpdate(
      `update case_events set payload = jsonb_set(payload, '{text}', '"[PERSON] said something else"') where case_id = $1 and seq = 3`,
      [c.id],
    );
    const check = await verify(c.id);
    expect(check.ok).toBe(false);
    expect(check.brokenAtSeq).toBe(3);
    expect(check.length).toBe(2);
    expect(check.headHash).toBe(rows[1].hash); // the last good link
  });

  it("detects an edit to any other hashed column", async () => {
    for (const [column, value] of [
      ["type", "note_added"],
      ["actor_kind", "staff"],
      ["actor_id", "someone"],
      ["created_at", "2020-01-01T00:00:00.000Z"],
    ] as const) {
      const { c } = await caseWithEvents(3);
      await rawUpdate(`update case_events set ${column} = $2 where case_id = $1 and seq = 2`, [c.id, value]);
      const check = await verify(c.id);
      expect(check, column).toMatchObject({ ok: false, brokenAtSeq: 2, length: 1 });
    }
  });

  it("detects an edit even when the attacker recomputes that event's hash: the next link breaks", async () => {
    const { c, rows } = await caseWithEvents();
    const forged = { ...rows[2], payload: { ...rows[2].payload, text: "[PERSON] said it was fixed" } };
    const forgedHash = computeHash(rows[2].prevHash, forged);
    await rawUpdate(`update case_events set payload = $2::jsonb, hash = $3 where case_id = $1 and seq = 3`,
      [c.id, JSON.stringify(forged.payload), forgedHash]);
    const check = await verify(c.id);
    expect(check).toMatchObject({ ok: false, brokenAtSeq: 4, length: 3, headHash: forgedHash });
  });

  it("detects a deleted middle event", async () => {
    const { c, rows } = await caseWithEvents();
    await rawUpdate(`delete from case_events where case_id = $1 and seq = 3`, [c.id]);
    const check = await verify(c.id);
    expect(check).toEqual({ ok: false, headHash: rows[1].hash, length: 2, brokenAtSeq: 4 });
  });

  it("detects a deleted first event", async () => {
    const { c } = await caseWithEvents(3);
    await rawUpdate(`delete from case_events where case_id = $1 and seq = 1`, [c.id]);
    expect(await verify(c.id)).toMatchObject({ ok: false, brokenAtSeq: 2, length: 0, headHash: GENESIS_HASH });
  });

  it("a deleted LAST event is not detectable from the chain alone (reports pin the head hash instead)", async () => {
    // Domain §8 check 3: /verify compares the snapshot's headHash with the chain, which catches this case.
    const { c, rows } = await caseWithEvents();
    await rawUpdate(`delete from case_events where case_id = $1 and seq = 5`, [c.id]);
    const check = await verify(c.id);
    expect(check).toEqual({ ok: true, headHash: rows[3].hash, length: 4 });
    expect(check.headHash).not.toBe(rows[4].hash);
  });

  it("appending after an event keeps the chain valid (seq continues, prevHash = old head)", async () => {
    const { c, rows } = await caseWithEvents(2);
    const next = await t.tx((tx) => appendCaseEvent(tx, {
      orgId, caseId: c.id, type: "note_added", actorKind: "system", actorId: null, payload: { n: 3 },
    }));
    expect(next.seq).toBe(3);
    expect(next.prevHash).toBe(rows[1].hash);
    expect(await verify(c.id)).toEqual({ ok: true, headHash: next.hash, length: 3 });
  });

  describe("transition() writes the projection and the event together", () => {
    it("runs one loop to verified, and every step lands in an intact chain", async () => {
      const lead = await insertMember(t, orgId, "lead", "Test lead");
      const facilities = await insertMember(t, orgId, "owner", "Facilities team");
      const auditor = await insertMember(t, orgId, "auditor", "Internal audit");
      const c = await insertCase(t, orgId, { wantsRetest: true });
      const leadActor: Actor = { kind: "staff", memberId: lead.id, role: "lead" };
      const ownerActor: Actor = { kind: "staff", memberId: facilities.id, role: "owner" };
      const reporter: Actor = { kind: "reporter", via: "receipt_code" };

      await t.tx((tx) => appendCaseEvent(tx, {
        orgId, caseId: c.id, type: "submitted", actorKind: "reporter", actorId: null, payload: { channel: "web" },
      }));

      // The guard reads the event log: no redaction_approved event yet, so triage is refused.
      await expect(t.tx((tx) => transition(tx, orgId, c.id,
        { kind: "triage", priorityArea: "built_environment", publicSummary: "The door button was broken." }, leadActor)))
        .rejects.toThrow(/redaction not approved/);
      await t.tx((tx) => appendCaseEvent(tx, {
        orgId, caseId: c.id, type: "redaction_approved", actorKind: "staff", actorId: lead.id, payload: { spans: [] },
      }));

      const triaged = await t.tx((tx) => transition(tx, orgId, c.id,
        { kind: "triage", priorityArea: "built_environment", publicSummary: "Door button broken. Call 416-555-0142." }, leadActor));
      expect(triaged.case.status).toBe("triaged");
      expect(triaged.case.publicSummary).toBe("Door button broken. Call [PHONE].");
      expect(triaged.event.payload).toMatchObject({ from: "new", to: "triaged", priorityArea: "built_environment" });

      // The assignee's role is looked up in this org: an auditor is refused.
      await expect(t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: auditor.id }, leadActor)))
        .rejects.toThrow(/owner or lead/);
      const assigned = await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: facilities.id }, leadActor));
      expect(assigned.case).toMatchObject({ status: "assigned", assignedTo: facilities.id });

      const fixed = await t.tx((tx) => transition(tx, orgId, c.id, { kind: "log_fix", description: "Replaced the motor." }, ownerActor));
      expect(fixed.case).toMatchObject({ status: "retest_open", retestRound: 1 });
      expect(fixed.requestRetest).toBe(true);

      const verified = await t.tx((tx) => transition(tx, orgId, c.id, { kind: "verdict", verdict: "fixed" }, reporter));
      expect(verified.case.status).toBe("verified");
      expect(verified.case.verifiedAt).toBeInstanceOf(Date);
      expect(verified.event.payload).toMatchObject({ verdict: "fixed", round: 1, via: "receipt_code", from: "retest_open", to: "verified" });

      const events = await t.db.select({ type: caseEvents.type, seq: caseEvents.seq }).from(caseEvents)
        .where(eq(caseEvents.caseId, c.id)).orderBy(asc(caseEvents.seq));
      expect(events.map((e) => e.type)).toEqual([
        "submitted", "redaction_approved", "triaged", "assigned", "fix_logged", "retest_requested", "retest_verdict",
      ]);
      const check = await verify(c.id);
      expect(check).toEqual({ ok: true, headHash: verified.event.hash, length: 7 });

      const [row] = await t.db.select({ status: cases.status }).from(cases).where(eq(cases.id, c.id));
      expect(row.status).toBe("verified");

      // A refused move writes nothing: the transaction rolls back with it.
      await expect(t.tx((tx) => transition(tx, orgId, c.id, { kind: "close", reason: "spam" }, leadActor)))
        .rejects.toThrow(/not closable/);
      expect((await verify(c.id)).length).toBe(7);
    });

    it("cannot find a case through another org", async () => {
      const c = await insertCase(t, orgId);
      const otherOrg = (await insertOrg(t, "Third org")).id;
      await expect(t.tx((tx) => transition(tx, otherOrg, c.id, { kind: "opt_out" }, { kind: "reporter", via: "receipt_code" })))
        .rejects.toThrow(/case not found/);
    });
  });
});
