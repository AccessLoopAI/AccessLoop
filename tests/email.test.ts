// lib/email (Slice C; Phase 7 T3 item 8): the four templates (plain words, the code only when given, the placeholder
// only for display) and the mailer on a real Postgres (PGlite with the real migrations). An email is recorded as
// "pending" in the caller's transaction, sent only after that transaction committed (5 s limit), and its result
// recorded in a second transaction: FAKE_EMAIL=1 records "skipped_fake" plus a message_sent event and sends nothing;
// FAKE_EMAIL unset with no key is "failed" with an address-free log line; the Resend path stores the provider id; a
// send that times out is "failed"; a rolled-back transaction sends nothing. The re-test request goes once per round
// and the reminder at most once per round, also while one is on its way; the acknowledgement email records
// ack_recorded. No address or code ever reaches a table or a log line.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The frozen createCase() imports db/tenant, whose db/client needs a URL at import time. It is never used here
// (every query runs on the PGlite transaction), and postgres.js does not connect until a query runs.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://unused:unused@127.0.0.1:9/unused";
});

import { and, asc, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { Tx } from "@/db/client";
import { appendCaseEvent } from "@/lib/case-events";
import { createCase } from "@/lib/cases/create";
import { reminderSentAt } from "@/lib/cases/messages";
import { queueAckEmail, queueIntakeEmail, queueRetestReminder, queueRetestRequest, sendIntakeEmail } from "@/lib/email/case-emails";
import {
  EMAIL_SEND_TIMEOUT_MS,
  PENDING_IN_FLIGHT_MS,
  deliverEmail,
  queueEmail,
  sendEmailInTransaction,
  type QueuedEmail,
} from "@/lib/email/send";
import {
  CODE_PLACEHOLDER,
  EMAIL_AUDIENCE,
  EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_LABELS,
  LINK_PLACEHOLDER,
  renderEmail,
  renderForDisplay,
  type EmailData,
} from "@/lib/email/templates";
import { readRetestLink, retestLinkSecret } from "@/lib/retest-link";
import { transition, type Actor } from "@/lib/state-machine";
import { insertMember, insertOrg, startTestDb, type TestDb } from "./support/pglite-db";

const DATA: EmailData = {
  orgName: "Maple Harbour Bank",
  designateTitle: "Director, Accessibility and Inclusion",
  ref: "BAR-0042",
  checkUrl: "https://accessloop.example/check",
  caseUrl: "https://accessloop.example/app/cases/BAR-0042",
};
const LINK = "https://accessloop.example/r/t/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const REPORTER_TEMPLATES = EMAIL_TEMPLATES.filter((t) => EMAIL_AUDIENCE[t] === "reporter");
const OWNER_TEMPLATES = EMAIL_TEMPLATES.filter((t) => EMAIL_AUDIENCE[t] === "owner");
const CODE = "7K3M-9Q2D-XW4H-B8RT";
const CODE_LIKE = /[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;
const FORBIDDEN = [/priority area/i, /barrier classification/i, /complian/i, /certified/i, /guarantee/i, /undefined/, /null/, /\{|\}/, /\[object/];

const all = (e: { subject: string; text: string; html: string }) => `${e.subject}\n${e.text}\n${e.html}`;

describe("email templates", () => {
  it("every reporter template names the org, the designate title, the case ref and the /check link, in plain words", () => {
    expect(REPORTER_TEMPLATES).toEqual(["ack", "receipt_code", "retest_request", "retest_reminder"]);
    for (const template of REPORTER_TEMPLATES) {
      const e = renderEmail(template, { ...DATA, code: template === "receipt_code" ? CODE : null });
      expect(e.subject).toContain(DATA.ref);
      for (const part of [e.text, e.html]) {
        expect(part, template).toContain(DATA.orgName);
        expect(part, template).toContain(DATA.designateTitle);
        expect(part, template).toContain(DATA.ref);
        expect(part, template).toContain(DATA.checkUrl);
      }
      const text = all(e).replace(/<!doctype html>|<\/?(html|body|p|a)[^>]*>/gi, "");
      for (const bad of FORBIDDEN) expect(text, `${template}: ${bad}`).not.toMatch(bad);
      // Short sentences (grade 6-8): no sentence over 35 words.
      for (const sentence of e.text.split(/(?<=[.?!:])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(35);
      expect(EMAIL_TEMPLATE_LABELS[template]).toBeTruthy();
    }
  });

  it("the owner emails (the assignment and the two alerts) name the case and link to its staff page, with no report text, no /check and no code", () => {
    expect(OWNER_TEMPLATES).toEqual(["owner_stalled", "owner_overdue", "owner_assigned"]);
    for (const template of OWNER_TEMPLATES) {
      const e = renderEmail(template, { ...DATA, code: CODE, retestUrl: LINK });
      expect(e.subject).toContain(DATA.ref);
      for (const part of [e.text, e.html]) {
        expect(part, template).toContain(DATA.orgName);
        expect(part, template).toContain(DATA.designateTitle);
        expect(part, template).toContain(DATA.caseUrl);
        expect(part, template).not.toContain(DATA.checkUrl);
        expect(part, template).not.toContain(CODE);
        expect(part, template).not.toContain(LINK);
      }
      expect(e.text).toContain("It never holds report text");
      const text = all(e).replace(/<!doctype html>|<\/?(html|body|p|a)[^>]*>/gi, "");
      for (const bad of FORBIDDEN) expect(text, `${template}: ${bad}`).not.toMatch(bad);
      for (const sentence of e.text.split(/(?<=[.?!:])\s+/)) expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(35);
      expect(EMAIL_TEMPLATE_LABELS[template]).toBeTruthy();
    }
    expect(renderEmail("owner_stalled", DATA).text).toContain("30 or more days ago");
    expect(renderEmail("owner_overdue", DATA).text).toContain("Its due date has passed");
    expect(renderEmail("owner_assigned", DATA).subject).toBe("A barrier was assigned to you: BAR-0042");
  });

  it("re-test emails carry their one-round link when given, besides the /check way; other emails never do", () => {
    for (const template of ["retest_request", "retest_reminder"] as const) {
      const withLink = renderEmail(template, { ...DATA, retestUrl: LINK });
      expect(withLink.text).toContain(`To answer, open this link: ${LINK}`);
      expect(withLink.html).toContain(`<a href="${LINK}">`);
      expect(withLink.text).toContain("The link works for this check only, for 30 days at most.");
      expect(withLink.text).toContain(`You can also go to ${DATA.checkUrl}`);
      const without = renderEmail(template, DATA);
      expect(all(without)).not.toContain("/r/t/");
      expect(without.text).toContain(`Go to ${DATA.checkUrl}`);
    }
    for (const template of ["ack", "receipt_code"] as const) {
      expect(all(renderEmail(template, { ...DATA, code: CODE, retestUrl: LINK }))).not.toContain(LINK);
    }
  });

  it("puts the code in only when it is given, and never puts it in a link", () => {
    const withCode = renderEmail("ack", { ...DATA, code: CODE });
    expect(withCode.text).toContain(`Your receipt code is: ${CODE}`);
    expect(withCode.html).toContain(CODE);
    expect(withCode.html).not.toMatch(new RegExp(`href="[^"]*${CODE}`));
    const without = renderEmail("ack", { ...DATA, code: null });
    expect(all(without)).not.toMatch(CODE_LIKE);
    expect(all(without)).not.toContain("receipt code is");
    for (const template of ["retest_request", "retest_reminder"] as const) {
      // Re-test emails never carry a code, even when one is passed by mistake.
      expect(all(renderEmail(template, { ...DATA, code: CODE }))).not.toContain(CODE);
    }
  });

  it("an email that is sent never holds a placeholder; a display copy never holds a code or a link", () => {
    for (const template of EMAIL_TEMPLATES) {
      const sent = renderEmail(template, { ...DATA, code: template === "receipt_code" || template === "ack" ? CODE : null, retestUrl: LINK });
      expect(all(sent), template).not.toContain(CODE_PLACEHOLDER);
      expect(all(sent), template).not.toContain(LINK_PLACEHOLDER);
      for (const codeIncluded of [true, false]) {
        for (const linkIncluded of [true, false]) {
          const shown = renderForDisplay(template, DATA, codeIncluded, linkIncluded);
          expect(all(shown)).not.toMatch(CODE_LIKE);
          expect(all(shown)).not.toContain("/r/t/");
          const placeholder = template === "receipt_code" || (template === "ack" && codeIncluded);
          expect(shown.text.includes(CODE_PLACEHOLDER), `${template} ${codeIncluded}`).toBe(placeholder);
          const linkShown = linkIncluded && (template === "retest_request" || template === "retest_reminder");
          expect(shown.text.includes(LINK_PLACEHOLDER), `${template} link ${linkIncluded}`).toBe(linkShown);
        }
      }
    }
  });

  it("escapes the org's own words in the HTML", () => {
    const e = renderEmail("ack", { ...DATA, orgName: `Smith & Sons <b>"Bank"</b>` });
    expect(e.html).toContain("Smith &amp; Sons &lt;b&gt;&quot;Bank&quot;&lt;/b&gt;");
    expect(e.html).not.toContain("<b>");
    expect(e.text).toContain(`Smith & Sons <b>"Bank"</b>`);
  });
});

/* ------------------------------------------------------------------ the mailer, on a real Postgres */

let t: TestDb;
let orgId: string;
let leadId: string;
let ownerId: string;
const saved = { ...process.env };
const ADDRESS = "reporter.person@example.com";

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.RECEIPT_PEPPER = "test-pepper";
  process.env.APP_URL = "https://accessloop.example";
  process.env.FAKE_EMAIL = "1";
  // The re-test link's secret is derived from SESSION_SECRET in local mode (lib/env.ts secretFromEnv).
  process.env.AUTH_MODE = "local";
  process.env.SESSION_SECRET = "a-test-session-secret-of-at-least-32-characters";
  delete process.env.VERCEL;
  delete process.env.RETEST_LINK_SECRET;
  t = await startTestDb();
  const org = await insertOrg(t, "Maple Test Bank");
  orgId = org.id;
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
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
});

async function newCase(opts: { email?: string | null; channel?: "web" | "email" | "phone"; wantsRetest?: boolean } = {}) {
  return t.tx((tx) =>
    createCase(tx, {
      orgId,
      intakeChannel: opts.channel ?? "web",
      locationKind: "place",
      rawText: "The automatic door button is broken.",
      redactedText: "The automatic door button is broken.",
      spans: [],
      needsManualRedaction: false,
      isAnonymous: !opts.email,
      wantsRetest: opts.wantsRetest ?? true,
      aiOptOut: false,
      reporterEmail: opts.email ?? null,
      receivedAt: new Date(),
      summary: null,
      summarySource: "reporter_words",
      loggedByMemberId: opts.channel && opts.channel !== "web" ? leadId : null,
    }),
  );
}

async function rowsOf(caseId: string) {
  const messages = await t.db.select().from(schema.outboundMessages).where(eq(schema.outboundMessages.caseId, caseId));
  const events = await t.db
    .select()
    .from(schema.caseEvents)
    .where(eq(schema.caseEvents.caseId, caseId))
    .orderBy(asc(schema.caseEvents.seq));
  return { messages, events };
}

/** Move a case to retest_open with the frozen state machine (approve, triage, assign, log fix). */
async function toRetest(caseId: string) {
  const lead: Actor = { kind: "staff", memberId: leadId, role: "lead" };
  await t.tx((tx) => appendCaseEvent(tx, { orgId, caseId, type: "redaction_approved", actorKind: "staff", actorId: leadId, payload: { spans: [] } }));
  await t.tx((tx) => transition(tx, orgId, caseId, { kind: "triage", priorityArea: "built_environment", publicSummary: "A door did not open." }, lead));
  await t.tx((tx) => transition(tx, orgId, caseId, { kind: "assign", memberId: ownerId }, lead));
  await t.tx((tx) => transition(tx, orgId, caseId, { kind: "log_fix", description: "Replaced the motor." }, { kind: "staff", memberId: ownerId, role: "owner" }));
}

const caseRow = (tx: Tx, caseId: string) =>
  tx.select().from(schema.cases).where(and(eq(schema.cases.orgId, orgId), eq(schema.cases.id, caseId))).then((r) => r[0]);

/** Step 2 with the test database standing in for withOrg (the second short transaction). */
const deliver = (q: QueuedEmail, timeoutMs?: number) => deliverEmail(q, { runTx: t.tx, timeoutMs });

/** Queue one email in its own committed transaction, as the app's callers do. */
const queued = (caseId: string, ref: string) =>
  t.tx((tx) => queueEmail({ tx, orgId, caseId, template: "ack", to: ADDRESS, data: { ...DATA, ref } }));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function useResend() {
  process.env.FAKE_EMAIL = "0";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "AccessLoop <noreply@accessloop.example>";
}

describe("the mailer: recorded in the transaction, sent after it commits", () => {
  it("with FAKE_EMAIL=1: pending in the transaction, then skipped_fake and a message_sent event; no address or code stored", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    const { case: c, receiptCode } = await newCase({ email: ADDRESS });
    const q = await t.tx((tx) => queueIntakeEmail(tx, { orgId, caseId: c.id, ref: c.ref, to: ADDRESS, code: receiptCode }));
    // Committed as pending: nothing sent and nothing on the case yet.
    let rows = await rowsOf(c.id);
    expect(rows.messages).toHaveLength(1);
    expect(rows.messages[0]).toMatchObject({ id: q.messageId, status: "pending", providerId: null });
    expect(rows.events.some((e) => e.type === "message_sent")).toBe(false);

    const sent = await deliver(q);
    expect(sent.status).toBe("skipped_fake");
    expect(fetchSpy).not.toHaveBeenCalled();
    rows = await rowsOf(c.id);
    expect(rows.messages).toHaveLength(1);
    expect(rows.messages[0]).toMatchObject({ id: sent.messageId, orgId, channel: "email", template: "ack", status: "skipped_fake", providerId: null });
    const event = rows.events.find((e) => e.type === "message_sent")!;
    expect(event.actorKind).toBe("system");
    expect(event.createdAt).toEqual(sent.at);
    expect(event.payload).toEqual({ template: "ack", channel: "email", status: "skipped_fake", messageId: sent.messageId, codeIncluded: true });
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(ADDRESS);
    expect(stored).not.toContain("example.com");
    expect(stored).not.toContain(receiptCode);
    for (const spy of logs) for (const call of spy.mock.calls) expect(call.join(" ")).not.toContain(ADDRESS);
  });

  it("a transaction that rolls back takes its pending email with it: nothing is ever sent", async () => {
    useResend();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { case: c } = await newCase({ email: ADDRESS });
    await expect(
      t.tx(async (tx) => {
        await queueEmail({ tx, orgId, caseId: c.id, template: "ack", to: ADDRESS, data: { ...DATA, ref: c.ref } });
        throw new Error("the step failed after the email was queued");
      }),
    ).rejects.toThrow("the step failed");
    expect((await rowsOf(c.id)).messages).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with no RESEND_API_KEY it is 'failed', never silently faked, and the log line names no address", async () => {
    delete process.env.FAKE_EMAIL;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { case: c } = await newCase({ email: ADDRESS });
    const sent = await deliver(await queued(c.id, c.ref));
    expect(sent.status).toBe("failed");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    const line = errors.mock.calls[0].join(" ");
    expect(line).toContain("[email] ack email not sent");
    expect(line).toContain("RESEND_API_KEY");
    expect(line).not.toContain(ADDRESS);
    const { messages, events } = await rowsOf(c.id);
    expect(messages[0].status).toBe("failed");
    expect(events.find((e) => e.type === "message_sent")!.payload.status).toBe("failed");
  });

  it("with a key it calls Resend only after the commit, with a time limit and the row id as idempotency key", async () => {
    useResend();
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production"; // as under `next start`: the SDK prints nothing itself
    const logs = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "log"), vi.spyOn(console, "warn")];
    const { case: c } = await newCase({ email: ADDRESS });
    const seenAtSend: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      // Read from OUTSIDE any transaction: the queued row is already committed when the send starts.
      const rows = await t.db
        .select({ status: schema.outboundMessages.status })
        .from(schema.outboundMessages)
        .where(eq(schema.outboundMessages.caseId, c.id));
      seenAtSend.push(rows.map((r) => r.status).sort().join(","));
      return seenAtSend.length === 1
        ? jsonResponse({ id: "re_message_1" })
        : jsonResponse({ name: "validation_error", statusCode: 422, message: `Invalid \`to\` field: ${ADDRESS}` }, 422);
    });
    try {
      const q = await queued(c.id, c.ref);
      const ok = await deliver(q);
      expect(ok.status).toBe("sent");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(seenAtSend[0]).toBe("pending");
      const init = fetchSpy.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init.headers).get("idempotency-key")).toBe(q.messageId);
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ to: ADDRESS, subject: `We received your feedback (${c.ref})` });

      const refused = await deliver(await queued(c.id, c.ref));
      expect(refused.status).toBe("failed");
      expect(seenAtSend[1]).toBe("pending,sent");
      const { messages } = await rowsOf(c.id);
      expect(messages.map((m) => [m.status, m.providerId]).sort()).toEqual([["failed", null], ["sent", "re_message_1"]]);
      for (const spy of logs) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(ADDRESS);
      expect(logs[0].mock.calls.map((x) => x.join(" "))).toEqual(["[email] ack email failed (Resend validation_error 422)"]);
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
    }
  });

  it("a send that gets no answer in time is aborted and recorded as failed", async () => {
    expect(EMAIL_SEND_TIMEOUT_MS).toBe(5_000);
    useResend();
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit).signal!;
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    try {
      const { case: c } = await newCase({ email: ADDRESS });
      const started = Date.now();
      const sent = await deliver(await queued(c.id, c.ref), 50);
      expect(Date.now() - started).toBeLessThan(4_000);
      expect(sent.status).toBe("failed");
      expect((await rowsOf(c.id)).messages[0].status).toBe("failed");
      expect(errors.mock.calls.map((x) => x.join(" "))).toEqual(["[email] ack email failed (no answer from Resend within 0.05 s)"]);
    } finally {
      env.NODE_ENV = saved.NODE_ENV;
    }
  });

  it("staff intake's receipt code (the one in-transaction send): recorded in that transaction, so a rollback undoes it all", async () => {
    const { case: c, receiptCode } = await newCase({ email: ADDRESS, channel: "email" });
    const sent = await t.tx((tx) =>
      sendIntakeEmail(tx, { orgId, caseId: c.id, ref: c.ref, template: "receipt_code", to: ADDRESS, code: receiptCode }),
    );
    expect(sent.status).toBe("skipped_fake");
    const { messages, events } = await rowsOf(c.id);
    expect(messages[0]).toMatchObject({ id: sent.messageId, template: "receipt_code", status: "skipped_fake" });
    expect(events.find((e) => e.type === "message_sent")!.payload).toMatchObject({ template: "receipt_code", codeIncluded: true });

    delete process.env.FAKE_EMAIL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const other = await newCase({ email: ADDRESS, channel: "email" });
    await expect(
      t.tx(async (tx) => {
        const r = await sendEmailInTransaction({
          tx,
          orgId,
          caseId: other.case.id,
          template: "receipt_code",
          to: ADDRESS,
          data: { ...DATA, ref: other.case.ref, code: other.receiptCode },
        });
        if (r.status === "failed") throw new Error("not emailed");
      }),
    ).rejects.toThrow("not emailed");
    const after = await rowsOf(other.case.id);
    expect(after.messages).toHaveLength(0);
    expect(after.events.some((e) => e.type === "message_sent")).toBe(false);
  });
});

describe("case emails", () => {
  it("the re-test request goes once per round, only to a reporter with an email, and not twice while one is on its way", async () => {
    const { case: c } = await newCase({ email: ADDRESS, wantsRetest: true });
    await toRetest(c.id);
    const first = await t.tx(async (tx) => queueRetestRequest(tx, await caseRow(tx, c.id)));
    if (!first.ok) throw new Error("the re-test request should be queued");
    // Queued and committed, not delivered yet: a second request for the round is refused.
    expect(await t.tx(async (tx) => queueRetestRequest(tx, await caseRow(tx, c.id)))).toEqual({ ok: false, reason: "already_sent" });
    expect((await deliver(first.queued)).status).toBe("skipped_fake");
    const again = await t.tx(async (tx) => queueRetestRequest(tx, await caseRow(tx, c.id)));
    expect(again).toEqual({ ok: false, reason: "already_sent" });
    const { messages, events } = await rowsOf(c.id);
    expect(messages.filter((m) => m.template === "retest_request")).toHaveLength(1);
    expect(events.find((e) => e.type === "message_sent")!.payload).toMatchObject({ template: "retest_request", round: 1, codeIncluded: false, linkIncluded: true });

    // The email carries a one-round link for THIS case and round, ending 30 days after it was sent; it is never stored.
    const url = /https:\/\/accessloop\.example\/r\/t\/([A-Za-z0-9_-]+)/.exec(first.queued.email.text);
    expect(url, "a /r/t/ link in the email").not.toBeNull();
    const claims = readRetestLink(url![1], retestLinkSecret());
    expect(claims).toMatchObject({ orgId, caseId: c.id, round: 1 });
    const days = (claims!.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
    expect(JSON.stringify(await rowsOf(c.id))).not.toContain(url![1]);

    const anonymous = await newCase({ email: null, wantsRetest: true });
    await toRetest(anonymous.case.id);
    expect(await t.tx(async (tx) => queueRetestRequest(tx, await caseRow(tx, anonymous.case.id)))).toEqual({ ok: false, reason: "no_email" });
  });

  it("at most one reminder per round, and only while the reporter has the question", async () => {
    const { case: c } = await newCase({ email: ADDRESS, wantsRetest: true });
    const lead = { kind: "staff" as const, memberId: leadId };
    expect(await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead))).toEqual({ ok: false, reason: "not_applicable" });
    await toRetest(c.id);
    const first = await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead));
    if (!first.ok) throw new Error("the first reminder should be queued");
    expect(await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead))).toEqual({ ok: false, reason: "already_sent" });
    expect((await deliver(first.queued)).status).toBe("skipped_fake");
    const second = await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead));
    expect(second).toEqual({ ok: false, reason: "already_sent" });
    const { messages, events } = await rowsOf(c.id);
    expect(messages.filter((m) => m.template === "retest_reminder")).toHaveLength(1);
    const reminder = events.find((e) => e.type === "message_sent" && e.payload.template === "retest_reminder")!;
    expect(reminder.actorKind).toBe("staff");
    expect(reminder.actorId).toBe(leadId);
    expect(reminder.payload.round).toBe(1);
    expect(reminderSentAt(events, 1)).toEqual(reminder.createdAt);
    expect(reminderSentAt(events, 2)).toBeNull();
  });

  it("a failed reminder does not use up the round's one reminder", async () => {
    const { case: c } = await newCase({ email: ADDRESS, wantsRetest: true });
    await toRetest(c.id);
    delete process.env.FAKE_EMAIL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const lead = { kind: "staff" as const, memberId: leadId };
    const failed = await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead));
    if (!failed.ok) throw new Error("the reminder should be queued");
    expect((await deliver(failed.queued)).status).toBe("failed");
    process.env.FAKE_EMAIL = "1";
    const retry = await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead));
    if (!retry.ok) throw new Error("a failed reminder must not use up the round");
    expect((await deliver(retry.queued)).status).toBe("skipped_fake");
    expect(await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead))).toEqual({ ok: false, reason: "already_sent" });
  });

  it("a pending row whose send stopped long ago does not block the round's reminder", async () => {
    const { case: c } = await newCase({ email: ADDRESS, wantsRetest: true });
    await toRetest(c.id);
    await t.db.insert(schema.outboundMessages).values({
      orgId,
      caseId: c.id,
      channel: "email",
      template: "retest_reminder",
      status: "pending",
      createdAt: new Date(Date.now() - PENDING_IN_FLIGHT_MS - 60_000),
    });
    const lead = { kind: "staff" as const, memberId: leadId };
    expect((await t.tx(async (tx) => queueRetestReminder(tx, await caseRow(tx, c.id), lead))).ok).toBe(true);
  });

  it("the acknowledgement email records ack_recorded { channel: email } and ackAt with its result, once", async () => {
    const { case: c } = await newCase({ email: ADDRESS, channel: "email" });
    const lead = { kind: "staff" as const, memberId: leadId };
    const r = await t.tx(async (tx) => queueAckEmail(tx, await caseRow(tx, c.id), lead));
    if (!r.ok) throw new Error("the ack email should be queued");
    // Not acknowledged until the email's result is recorded, and not queued twice meanwhile.
    expect((await t.tx((tx) => caseRow(tx, c.id))).ackAt).toBeNull();
    expect(await t.tx(async (tx) => queueAckEmail(tx, await caseRow(tx, c.id), lead))).toEqual({ ok: false, reason: "already_sent" });
    const sent = await deliver(r.queued);
    expect(sent.status).toBe("skipped_fake");
    const { messages, events } = await rowsOf(c.id);
    const ack = events.find((e) => e.type === "ack_recorded")!;
    expect(ack.payload).toEqual({ channel: "email", messageId: messages[0].id });
    expect(ack.actorId).toBe(leadId);
    const after = await t.tx((tx) => caseRow(tx, c.id));
    expect(after.ackAt).toEqual(sent.at);
    expect(await t.tx(async (tx) => queueAckEmail(tx, await caseRow(tx, c.id), lead))).toEqual({ ok: false, reason: "not_applicable" });

    // A failed send records the attempt, never an acknowledgement.
    const other = await newCase({ email: ADDRESS, channel: "email" });
    delete process.env.FAKE_EMAIL;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const q = await t.tx(async (tx) => queueAckEmail(tx, await caseRow(tx, other.case.id), lead));
    if (!q.ok) throw new Error("the ack email should be queued");
    expect((await deliver(q.queued)).status).toBe("failed");
    expect((await rowsOf(other.case.id)).events.map((e) => e.type)).not.toContain("ack_recorded");
    expect((await t.tx((tx) => caseRow(tx, other.case.id))).ackAt).toBeNull();
  });
});
