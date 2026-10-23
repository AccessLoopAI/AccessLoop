// The emails a case sends (docs/domain.md §1.3 s.9(4), §3 re-test ethics, §4 intake). Server-only. Each queue*
// function runs inside a withOrg() transaction the caller owns and only RECORDS the email (lib/email/send.ts: an
// outbound_messages row, status "pending"); the caller sends it with deliverEmail() once that transaction has
// committed, so no network call ever holds a transaction open. They can be tested on a real Postgres
// (tests/email.test.ts).
//
// Recipient addresses: an address typed in the request being handled (web intake, staff intake) is used from
// memory. Every later email decrypts it from case_private, which RLS shows only to app.role = 'lead': a lead's own
// action, or a system send that opens its own lead transaction (the re-test request after an owner logs a fix,
// lib/cases/after-fix.ts). Nothing else ever reads it. It stays in memory between the two steps, never in a table.
//
// Re-test emails carry a one-round link (/r/t/{token}, lib/retest-link.ts) besides the /check instructions. The token
// is made when the email is queued, held in memory with the rendered email, and never stored or logged.
import { and, asc, eq, gt } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { caseEvents, casePrivate, cases, outboundMessages } from "@/db/schema";
import { appendCaseEvent } from "@/lib/case-events";
import { decrypt } from "@/lib/crypto";
import { messagesSent, reminderSentAt, type EventLike } from "@/lib/cases/messages";
import { retestLinkUrl } from "@/lib/retest-link";
import {
  PENDING_IN_FLIGHT_MS,
  PENDING_STATUS,
  emailData,
  queueEmail,
  sendEmailInTransaction,
  type EmailActor,
  type QueuedEmail,
  type SentEmail,
} from "./send";
import type { EmailTemplate } from "./templates";

type CaseRow = typeof cases.$inferSelect;

export type CaseEmailRefusal = { ok: false; reason: "no_email" | "not_applicable" | "already_sent" };

/** What a queue* function gives back: the email to deliver after commit, or why there is none. */
export type CaseEmailQueued = { ok: true; queued: QueuedEmail } | CaseEmailRefusal;

/** The outcome once delivered (lib/cases/after-fix.ts returns it). */
export type CaseEmailResult = { ok: true; sent: SentEmail } | CaseEmailRefusal;

/** The reporter's email address, or null. Only a lead transaction can read it (case_private RLS). */
export async function reporterEmailOf(tx: Tx, orgId: string, caseId: string): Promise<string | null> {
  const [p] = await tx
    .select({ enc: casePrivate.reporterEmailEnc })
    .from(casePrivate)
    .where(and(eq(casePrivate.orgId, orgId), eq(casePrivate.caseId, caseId)))
    .limit(1);
  return p?.enc ? decrypt(p.enc) : null;
}

/** When the case's current re-test round was requested (its retest_requested event): a link ends 60 days after it. */
function roundRequestedAt(events: readonly EventLike[], round: number): Date {
  const requests = events.filter((e) => e.type === "retest_requested");
  const ofRound = requests.filter((e) => e.payload.round === round);
  return (ofRound.length ? ofRound : requests).at(-1)?.createdAt ?? new Date();
}

/** The template data of a re-test email: the usual parts plus this round's link. */
async function retestEmailData(tx: Tx, c: CaseRow, events: readonly EventLike[]) {
  const data = await emailData(tx, c.orgId, c.ref);
  const requestedAt = roundRequestedAt(events, c.retestRound);
  return { ...data, retestUrl: retestLinkUrl({ orgId: c.orgId, caseId: c.id, round: c.retestRound, requestedAt }) };
}

async function eventsOf(tx: Tx, c: CaseRow) {
  return tx
    .select({ type: caseEvents.type, payload: caseEvents.payload, createdAt: caseEvents.createdAt })
    .from(caseEvents)
    .where(and(eq(caseEvents.orgId, c.orgId), eq(caseEvents.caseId, c.id)))
    .orderBy(asc(caseEvents.seq));
}

/**
 * An email of this template for this case is on its way right now (queued in a committed transaction, its result not
 * recorded yet). The callers lock the case row (FOR UPDATE), so a second click waits for the first transaction and
 * then sees its pending row: the one-per-round rules hold while a send is in flight.
 */
export async function inFlight(tx: Tx, c: Pick<CaseRow, "orgId" | "id">, template: EmailTemplate): Promise<boolean> {
  const [row] = await tx
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.orgId, c.orgId),
        eq(outboundMessages.caseId, c.id),
        eq(outboundMessages.template, template),
        eq(outboundMessages.status, PENDING_STATUS),
        gt(outboundMessages.createdAt, new Date(Date.now() - PENDING_IN_FLIGHT_MS)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The "ack" email of a web report, to the address typed in this request. It may carry the receipt code, because it
 * is queued while the code is still known (it is held in memory until delivered, never stored). Deliver it after
 * the transaction commits.
 */
export async function queueIntakeEmail(
  tx: Tx,
  input: { orgId: string; caseId: string; ref: string; to: string; code: string },
): Promise<QueuedEmail> {
  return queueEmail({
    tx,
    orgId: input.orgId,
    caseId: input.caseId,
    template: "ack",
    to: input.to,
    data: await emailData(tx, input.orgId, input.ref, input.code),
  });
}

/**
 * Staff-logged feedback's receipt-code email, INSIDE the createCase transaction (the one exception in
 * lib/email/send.ts): if it fails or takes longer than 5 seconds, the caller rolls the whole intake back.
 */
export async function sendIntakeEmail(
  tx: Tx,
  input: { orgId: string; caseId: string; ref: string; template: "receipt_code"; to: string; code: string },
): Promise<SentEmail> {
  return sendEmailInTransaction({
    tx,
    orgId: input.orgId,
    caseId: input.caseId,
    template: input.template,
    to: input.to,
    data: await emailData(tx, input.orgId, input.ref, input.code),
  });
}

/** The re-test request for the case's current round, once per round. The case must be waiting for the reporter. */
export async function queueRetestRequest(tx: Tx, c: CaseRow): Promise<CaseEmailQueued> {
  if (c.status !== "retest_open" || c.retestRound < 1) return { ok: false, reason: "not_applicable" };
  const events = await eventsOf(tx, c);
  if (messagesSent(events, "retest_request", c.retestRound).length || (await inFlight(tx, c, "retest_request"))) {
    return { ok: false, reason: "already_sent" };
  }
  const to = await reporterEmailOf(tx, c.orgId, c.id);
  if (!to) return { ok: false, reason: "no_email" };
  const queued = await queueEmail({
    tx,
    orgId: c.orgId,
    caseId: c.id,
    template: "retest_request",
    to,
    data: await retestEmailData(tx, c, events),
    round: c.retestRound,
  });
  return { ok: true, queued };
}

/**
 * The one reminder of a re-test round (domain §3: at most one reminder, only to a reporter who gave an email): the
 * lead's "Send a reminder email", or the daily job (app/api/cron/daily) a week after the request.
 */
export async function queueRetestReminder(tx: Tx, c: CaseRow, actor: EmailActor): Promise<CaseEmailQueued> {
  if (c.status !== "retest_open" || c.retestRound < 1) return { ok: false, reason: "not_applicable" };
  const events = await eventsOf(tx, c);
  if (reminderSentAt(events, c.retestRound) || (await inFlight(tx, c, "retest_reminder"))) {
    return { ok: false, reason: "already_sent" };
  }
  const to = await reporterEmailOf(tx, c.orgId, c.id);
  if (!to) return { ok: false, reason: "no_email" };
  const queued = await queueEmail({
    tx,
    orgId: c.orgId,
    caseId: c.id,
    template: "retest_reminder",
    to,
    data: await retestEmailData(tx, c, events),
    round: c.retestRound,
    actor,
  });
  return { ok: true, queued };
}

/**
 * ACR s.9(4) for feedback that came by email: the acknowledgement email. When it goes out (or is logged with
 * FAKE_EMAIL=1), the acknowledgement is recorded with its result, in the status transaction: ack_recorded
 * { channel: "email", messageId } and cases.ackAt. A failed send records only the failed attempt.
 */
export async function queueAckEmail(tx: Tx, c: CaseRow, actor: EmailActor & { kind: "staff" }): Promise<CaseEmailQueued> {
  if (c.intakeChannel !== "email" || c.isAnonymous || c.ackAt) return { ok: false, reason: "not_applicable" };
  if (await inFlight(tx, c, "ack")) return { ok: false, reason: "already_sent" };
  const to = await reporterEmailOf(tx, c.orgId, c.id);
  if (!to) return { ok: false, reason: "no_email" };
  const queued = await queueEmail(
    { tx, orgId: c.orgId, caseId: c.id, template: "ack", to, data: await emailData(tx, c.orgId, c.ref), actor },
    async (tx2, sent) => {
      if (sent.status === "failed") return;
      await appendCaseEvent(tx2, {
        orgId: c.orgId,
        caseId: c.id,
        type: "ack_recorded",
        actorKind: "staff",
        actorId: actor.memberId,
        createdAt: sent.at,
        payload: { channel: "email", messageId: sent.messageId },
      });
      await tx2.update(cases).set({ ackAt: sent.at, updatedAt: sent.at }).where(and(eq(cases.orgId, c.orgId), eq(cases.id, c.id)));
    },
  );
  return { ok: true, queued };
}
