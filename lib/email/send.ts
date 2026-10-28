// THE mailer (docs/decisions.md "Message model"; docs/archive/phase7-prompt.md T3 item 8). Server-only (Node runtime).
//   FAKE_EMAIL=1  -> nothing is sent; the attempt is logged to outbound_messages with status "skipped_fake".
//   otherwise     -> Resend (RESEND_API_KEY, EMAIL_FROM): status "sent" with the provider's id, or "failed".
// It never falls back from one to the other: with FAKE_EMAIL unset and no key, the status is "failed" and the server
// log says why. Every attempt is then recorded on the case as a message_sent event { template, channel, status,
// messageId } (never the address, never the body). Addresses and bodies are never logged.
//
// No network call inside a database transaction (a slow provider must not hold a pooled connection):
//   1. queueEmail(tx, ...)  in the CALLER's transaction: the outbound_messages row, status "pending". If that
//                           transaction rolls back, the row goes with it and nothing is ever sent.
//   2. deliverEmail(queued) after the caller's transaction COMMITTED: the send, limited to EMAIL_SEND_TIMEOUT_MS
//                           (AbortSignal.timeout; Resend's Idempotency-Key is the row's id, so a retried request can't
//                           send it twice), then a SECOND SHORT transaction records the result: the row's status and
//                           provider id, the message_sent event, and the caller's follow-up (the acknowledgement of
//                           an ack email). An email that fails or times out is "failed"; nothing is undone.
// The one exception is sendEmailInTransaction(): staff-logged feedback's receipt-code email, whose failure must roll
// back the whole intake (nobody could ever see that code again, and the immutable `submitted` event already says
// codeRelayedByStaff: false). It sends inside that lead transaction, limited to the same 5 seconds.
// A "pending" row younger than PENDING_IN_FLIGHT_MS is an email on its way (lib/email/case-emails.ts refuses to queue
// the same one twice meanwhile); an older one is a send whose process stopped, and the Outbox says it was not confirmed.
import { and, eq } from "drizzle-orm";
import { Resend } from "resend";
import type { Tx } from "@/db/client";
import { orgs, outboundMessages } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { absoluteUrl } from "@/lib/app-url";
import { appendCaseEvent } from "@/lib/case-events";
import { renderEmail, type EmailData, type EmailTemplate, type RenderedEmail } from "./templates";

export type EmailStatus = "sent" | "failed" | "skipped_fake";

/** outbound_messages.status of a row whose send has not been recorded yet. */
export const PENDING_STATUS = "pending";

/** The longest a send may take (Resend's API call). Then it is aborted and recorded as failed. */
export const EMAIL_SEND_TIMEOUT_MS = 5_000;

/** A pending row younger than this is an email still on its way (the send plus two short transactions). */
export const PENDING_IN_FLIGHT_MS = 2 * 60_000;

export type EmailActor = { kind: "staff"; memberId: string } | { kind: "system" };

export interface SendEmailInput {
  tx: Tx;
  orgId: string;
  caseId: string;
  template: EmailTemplate;
  /**
   * The reporter's address: from the request that is being handled, or decrypted by a lead transaction. For an owner
   * alert, the staff member's address (lib/email/staff-address.ts); "" only with FAKE_EMAIL=1, where nothing is sent.
   */
  to: string;
  data: EmailData;
  /** The re-test round, for retest_request and retest_reminder (the one-reminder-per-round rule reads it). */
  round?: number;
  /** Who made it go out: a lead pressing a button, or the system (intake, a logged fix). Default: system. */
  actor?: EmailActor;
}

export interface SentEmail {
  /** outbound_messages.id, also in the message_sent event. */
  messageId: string;
  status: EmailStatus;
  /** When the result was recorded (the message_sent event's time). */
  at: Date;
}

/** Runs one short transaction in the email's org (deliverEmail's second step). Tests pass their own. */
export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** An email recorded as pending in a transaction that has to commit before it is sent. Lives in memory only. */
export interface QueuedEmail {
  readonly messageId: string;
  readonly orgId: string;
  readonly caseId: string;
  readonly template: EmailTemplate;
  readonly round?: number;
  readonly actor: EmailActor;
  readonly codeIncluded: boolean;
  /** A re-test email that carries its one-round link (lib/retest-link.ts). The link itself is never stored. */
  readonly linkIncluded: boolean;
  /** Never stored or logged: the address and the rendered email (which may hold a receipt code or a link). */
  readonly to: string;
  readonly email: RenderedEmail;
  /** Extra writes in the status transaction, after the message_sent event (the ack email's acknowledgement). */
  readonly onRecorded?: (tx: Tx, sent: SentEmail) => Promise<void>;
}

export interface DeliverOptions {
  /** The second transaction. Default: withOrg({ orgId, role: "system" }). */
  runTx?: TxRunner;
  /** Default EMAIL_SEND_TIMEOUT_MS (tests use a short one). */
  timeoutMs?: number;
}

/** A clear server log line that never contains an address, a code or a body. */
function logEmail(template: EmailTemplate, what: string) {
  console.error(`[email] ${template} email ${what}`);
}

async function deliver(
  template: EmailTemplate,
  to: string,
  email: RenderedEmail,
  idempotencyKey: string,
  timeoutMs: number,
): Promise<{ status: EmailStatus; providerId: string | null }> {
  if (process.env.FAKE_EMAIL === "1") return { status: "skipped_fake", providerId: null };
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) {
    logEmail(template, "not sent: FAKE_EMAIL is not 1, and RESEND_API_KEY or EMAIL_FROM is not set. Recorded as failed.");
    return { status: "failed", providerId: null };
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await new Resend(key).emails.send(
      { from, to, subject: email.subject, text: email.text, html: email.html },
      { signal, idempotencyKey },
    );
    if (signal.aborted) {
      logEmail(template, `failed (no answer from Resend within ${timeoutMs / 1000} s)`);
      return { status: "failed", providerId: null };
    }
    if (res.error) {
      // Only the error's name and HTTP status: Resend's message can repeat the address.
      logEmail(template, `failed (Resend ${res.error.name}${res.error.statusCode ? ` ${res.error.statusCode}` : ""})`);
      return { status: "failed", providerId: null };
    }
    return { status: "sent", providerId: res.data?.id ?? null };
  } catch (err) {
    logEmail(template, signal.aborted ? `failed (no answer from Resend within ${timeoutMs / 1000} s)` : `failed (${err instanceof Error ? err.name : "UnknownError"})`);
    return { status: "failed", providerId: null };
  }
}

/** Step 1, in the caller's transaction: render the email and record it as pending. Nothing is sent. */
export async function queueEmail(input: SendEmailInput, onRecorded?: QueuedEmail["onRecorded"]): Promise<QueuedEmail> {
  const { tx, orgId, caseId, template, to, data } = input;
  const email = renderEmail(template, data);
  const [row] = await tx
    .insert(outboundMessages)
    .values({ orgId, caseId, channel: "email", template, status: PENDING_STATUS, providerId: null })
    .returning({ id: outboundMessages.id });
  return {
    messageId: row.id,
    orgId,
    caseId,
    template,
    round: input.round,
    actor: input.actor ?? { kind: "system" },
    codeIncluded: Boolean(data.code),
    linkIncluded: Boolean(data.retestUrl),
    to,
    email,
    onRecorded,
  };
}

/** The status, the provider id and the message_sent event of a delivered email, in the transaction given. */
async function recordResult(tx: Tx, q: QueuedEmail, status: EmailStatus, providerId: string | null): Promise<SentEmail> {
  const at = new Date();
  await tx
    .update(outboundMessages)
    .set({ status, providerId })
    .where(and(eq(outboundMessages.orgId, q.orgId), eq(outboundMessages.id, q.messageId)));
  await appendCaseEvent(tx, {
    orgId: q.orgId,
    caseId: q.caseId,
    type: "message_sent",
    actorKind: q.actor.kind,
    actorId: q.actor.kind === "staff" ? q.actor.memberId : null,
    createdAt: at,
    payload: {
      template: q.template,
      channel: "email",
      status,
      messageId: q.messageId,
      codeIncluded: q.codeIncluded,
      ...(q.linkIncluded ? { linkIncluded: true } : {}),
      ...(q.round !== undefined ? { round: q.round } : {}),
    },
  });
  const sent: SentEmail = { messageId: q.messageId, status, at };
  if (q.onRecorded) await q.onRecorded(tx, sent);
  return sent;
}

/**
 * Step 2, AFTER the caller's transaction committed (never inside one): send with a time limit, then record the
 * result in a second short transaction. Errors from that transaction are thrown (the caller logs them); a failed or
 * timed-out send is not an error, it is status "failed".
 */
export async function deliverEmail(q: QueuedEmail, options: DeliverOptions = {}): Promise<SentEmail> {
  const { status, providerId } = await deliver(q.template, q.to, q.email, q.messageId, options.timeoutMs ?? EMAIL_SEND_TIMEOUT_MS);
  const runTx: TxRunner = options.runTx ?? ((fn) => withOrg({ orgId: q.orgId, role: "system" }, fn));
  try {
    return await runTx((tx) => recordResult(tx, q, status, providerId));
  } catch (err) {
    logEmail(q.template, `was ${status === "failed" ? "not sent" : "handed over"}, but its status could not be recorded (${err instanceof Error ? err.name : "UnknownError"})`);
    throw err;
  }
}

/**
 * Only for an email whose failure must undo the transaction it belongs to (staff intake's receipt code, see the file
 * header): queued, sent and recorded inside `input.tx`, the send limited to EMAIL_SEND_TIMEOUT_MS.
 */
export async function sendEmailInTransaction(input: SendEmailInput, timeoutMs = EMAIL_SEND_TIMEOUT_MS): Promise<SentEmail> {
  const q = await queueEmail(input);
  const { status, providerId } = await deliver(q.template, q.to, q.email, q.messageId, timeoutMs);
  return recordResult(input.tx, q, status, providerId);
}

/**
 * The org's name and designate title, the case ref, the /check link and the staff case page's link: everything a
 * template needs but a code or a re-test link.
 */
export async function emailData(tx: Tx, orgId: string, ref: string, code: string | null = null): Promise<EmailData> {
  const [org] = await tx
    .select({ name: orgs.name, title: orgs.feedbackDesignateTitle })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) throw new Error("emailData: org not found");
  return { orgName: org.name, designateTitle: org.title, ref, checkUrl: absoluteUrl("/check"), caseUrl: caseUrlOf(ref), code };
}

/** The absolute link to a case's staff page (owner alerts; the Outbox renders them again with the same link). */
export function caseUrlOf(ref: string): string {
  return absoluteUrl(`/app/cases/${encodeURIComponent(ref)}`);
}
