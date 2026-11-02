// Retention (lib/retention.ts, scripts/retention.ts; docs/archive/phase7-prompt.md T3 item 13; ACR s.19), on a real Postgres
// (PGlite with the real migrations): past the keep-until date the private copy is wiped (the original replaced by a
// note that still decrypts, the email and contact details removed); 30 days after verified or closed the contact
// details are removed; every change is a system note on the case's log; a dry run writes nothing; a second run finds
// nothing; cases that are not due are never touched.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:9/unused";
});

import { asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { appendCaseEvent, verifyCaseChain } from "@/lib/case-events";
import { createCase } from "@/lib/cases/create";
import { decrypt } from "@/lib/crypto";
import {
  CONTACT_DAYS_AFTER_FINISHED,
  PRIVATE_TOMBSTONE,
  RETENTION_EVENT_KIND,
  retentionCandidates,
  runRetention,
  type RetentionTxRunner,
} from "@/lib/retention";
import { transition, type Actor } from "@/lib/state-machine";
import { insertMember, insertOrg, startTestDb, type TestDb } from "./support/pglite-db";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ORIGINAL = "The automatic door button at 12 King St W is broken. Email me at sam@example.com.";
const ADDRESS = "sam@example.com";

let t: TestDb;
let orgId: string;
let leadId: string;
let ownerId: string;
const saved = { ...process.env };
const inOrgTx: RetentionTxRunner = (_orgId, fn) => t.tx(fn);
const org = () => ({ id: orgId, name: "Retention Test Bank" });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.RECEIPT_PEPPER = "test-pepper";
  t = await startTestDb();
  orgId = (await insertOrg(t, "Retention Test Bank")).id;
  leadId = (await insertMember(t, orgId, "lead", "Alex Test")).id;
  ownerId = (await insertMember(t, orgId, "owner", "Facilities test")).id;
}, 60_000);

afterAll(async () => {
  await t.close();
  process.env = { ...saved };
});



/** A case received `receivedAt`, moved to `until` with the frozen state machine; `finishedDaysAgo` dates the last step. */
async function makeCase(opts: {
  receivedAt: Date;
  email?: boolean;
  contact?: boolean;
  until: "assigned" | "verified" | "closed";
  finishedDaysAgo?: number;
}) {
  const { case: c } = await t.tx((tx) =>
    createCase(tx, {
      orgId,
      intakeChannel: opts.contact ? "phone" : "web",
      locationKind: "place",
      rawText: ORIGINAL,
      redactedText: "The automatic door button at [STREET_ADDRESS] is broken. Email me at [EMAIL].",
      spans: [],
      needsManualRedaction: false,
      isAnonymous: !(opts.email || opts.contact),
      wantsRetest: true,
      aiOptOut: false,
      reporterEmail: opts.email ? ADDRESS : null,
      reporterContact: opts.contact ? "Phone 613-555-0177" : null,
      receivedAt: opts.receivedAt,
      summary: null,
      summarySource: "reporter_words",
      loggedByMemberId: opts.contact ? leadId : null,
    }),
  );
  const lead: Actor = { kind: "staff", memberId: leadId, role: "lead" };
  const finished = ago(opts.finishedDaysAgo ?? 0);
  const step = (n: number) => new Date(Math.min(finished.getTime(), Date.now()) - (10 - n) * 60_000);
  await t.tx((tx) => appendCaseEvent(tx, { orgId, caseId: c.id, type: "redaction_approved", actorKind: "staff", actorId: leadId, payload: { spans: [] }, createdAt: step(1) }));
  if (opts.until === "closed") {
    await t.tx((tx) => transition(tx, orgId, c.id, { kind: "close", reason: "no_action_possible" }, lead, { at: finished }));
    return c;
  }
  await t.tx((tx) => transition(tx, orgId, c.id, { kind: "triage", priorityArea: "built_environment", publicSummary: "A door did not open." }, lead, { at: step(2) }));
  await t.tx((tx) => transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId }, lead, { at: step(3) }));
  if (opts.until === "assigned") return c;
  await t.tx((tx) => transition(tx, orgId, c.id, { kind: "log_fix", description: "Replaced the motor." }, { kind: "staff", memberId: ownerId, role: "owner" }, { at: step(4) }));
  await t.tx((tx) => transition(tx, orgId, c.id, { kind: "verdict", verdict: "fixed" }, { kind: "reporter", via: "receipt_code" }, { at: finished }));
  return c;
}

async function privateOf(caseId: string) {
  const [p] = await t.db.select().from(schema.casePrivate).where(eq(schema.casePrivate.caseId, caseId));
  return p;
}

const notesOf = async (caseId: string) =>
  (await t.db.select().from(schema.caseEvents).where(eq(schema.caseEvents.caseId, caseId)).orderBy(asc(schema.caseEvents.seq))).filter(
    (e) => e.type === "note_added",
  );

describe("retention", () => {
  it("finds exactly the cases due, writes nothing in a dry run, applies each rule once, and keeps every chain intact", async () => {
    const yearsAgo = new Date();
    yearsAgo.setUTCFullYear(yearsAgo.getUTCFullYear() - 7);
    const pastRetention = await makeCase({ receivedAt: new Date(yearsAgo.getTime() - 3 * DAY), email: true, until: "verified", finishedDaysAgo: 0 });
    const verifiedLongAgo = await makeCase({ receivedAt: ago(90), email: true, until: "verified", finishedDaysAgo: CONTACT_DAYS_AFTER_FINISHED + 1 });
    const closedWithContact = await makeCase({ receivedAt: ago(90), contact: true, until: "closed", finishedDaysAgo: CONTACT_DAYS_AFTER_FINISHED + 2 });
    const verifiedRecently = await makeCase({ receivedAt: ago(90), email: true, until: "verified", finishedDaysAgo: CONTACT_DAYS_AFTER_FINISHED - 1 });
    const stillOpen = await makeCase({ receivedAt: ago(400), email: true, until: "assigned" });
    const anonymousOld = await makeCase({ receivedAt: ago(90), until: "verified", finishedDaysAgo: 60 });

    const found = await t.tx((tx) => retentionCandidates(tx, orgId));
    expect(found.map((c) => [c.ref, c.rule, c.removes])).toEqual([
      [pastRetention.ref, "retention_ended", ["original_text", "reporter_email"]],
      [verifiedLongAgo.ref, "contact_after_finished", ["reporter_email"]],
      [closedWithContact.ref, "contact_after_finished", ["reporter_contact"]],
    ]);

    // Dry run: the same list, nothing written.
    const before = await t.db.select().from(schema.casePrivate);
    const eventsBefore = (await t.db.select().from(schema.caseEvents)).length;
    const [dry] = await runRetention({ orgs: [org()], inOrgTx, apply: false });
    expect(dry.candidates).toHaveLength(3);
    expect(dry.applied).toBe(0);
    expect(await t.db.select().from(schema.casePrivate)).toEqual(before);
    expect((await t.db.select().from(schema.caseEvents)).length).toBe(eventsBefore);

    const [applied] = await runRetention({ orgs: [org()], inOrgTx, apply: true });
    expect(applied).toMatchObject({ applied: 3, failed: 0 });

    // 1. Past the keep-until date: the original is a note that still decrypts, the email is gone.
    const wiped = await privateOf(pastRetention.id);
    expect(decrypt(wiped.rawTextEnc)).toBe(PRIVATE_TOMBSTONE);
    expect(wiped.reporterEmailEnc).toBeNull();
    expect(wiped.reporterContactEnc).toBeNull();
    const [purgeNote] = await notesOf(pastRetention.id);
    expect(purgeNote.actorKind).toBe("system");
    expect(purgeNote.actorId).toBeNull();
    expect(purgeNote.payload).toMatchObject({ kind: RETENTION_EVENT_KIND, rule: "retention_ended", removed: ["original_text", "reporter_email"] });
    expect(String(purgeNote.payload.note)).toContain("ACR s.19");

    // 2. Finished 30+ days ago: contact details gone, the original kept.
    for (const c of [verifiedLongAgo, closedWithContact]) {
      const p = await privateOf(c.id);
      expect(decrypt(p.rawTextEnc), c.ref).toBe(ORIGINAL);
      expect(p.reporterEmailEnc, c.ref).toBeNull();
      expect(p.reporterContactEnc, c.ref).toBeNull();
      const notes = await notesOf(c.id);
      expect(notes, c.ref).toHaveLength(1);
      expect(notes[0].payload).toMatchObject({ kind: RETENTION_EVENT_KIND, rule: "contact_after_finished" });
    }

    // Not due: untouched.
    for (const c of [verifiedRecently, stillOpen, anonymousOld]) {
      const p = await privateOf(c.id);
      expect(decrypt(p.rawTextEnc), c.ref).toBe(ORIGINAL);
      expect(await notesOf(c.id), c.ref).toEqual([]);
    }
    expect(decrypt((await privateOf(verifiedRecently.id)).reporterEmailEnc!)).toBe(ADDRESS);

    // Nothing personal went into the log, every chain still verifies, and a second run finds nothing.
    const log = JSON.stringify(await t.db.select().from(schema.caseEvents));
    expect(log).not.toContain(ADDRESS);
    expect(log).not.toContain("613-555-0177");
    for (const c of [pastRetention, verifiedLongAgo, closedWithContact]) {
      expect((await t.tx((tx) => verifyCaseChain(tx, orgId, c.id))).ok, c.ref).toBe(true);
    }
    const [again] = await runRetention({ orgs: [org()], inOrgTx, apply: true });
    expect(again).toMatchObject({ candidates: [], applied: 0 });
  });
});
