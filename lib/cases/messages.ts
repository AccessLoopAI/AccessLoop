// Rules about the emails already recorded on a case (message_sent events), and the acknowledgement step of the
// case page (ACR s.9(4)). Pure and client-safe: the case page decides what to offer with these, and the server
// actions and the mailer check the same rules again before they send anything.
import type { cases } from "@/db/schema";
import { ACK_CHANNEL_WORDS } from "./history";

type CaseRow = typeof cases.$inferSelect;

export interface EventLike {
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

/**
 * message_sent events of one template (and one re-test round, when given) that did not fail. A "skipped_fake"
 * email (FAKE_EMAIL=1, nothing leaves the machine) counts as sent: the prototype behaves as it will live.
 */
export function messagesSent(events: readonly EventLike[], template: string, round?: number): EventLike[] {
  return events.filter(
    (e) =>
      e.type === "message_sent" &&
      e.payload.template === template &&
      e.payload.status !== "failed" &&
      (round === undefined || e.payload.round === round),
  );
}

/** When the one reminder of this re-test round went out, or null (domain §3: at most one reminder per round). */
export function reminderSentAt(events: readonly EventLike[], round: number): Date | null {
  const sent = messagesSent(events, "retest_reminder", round);
  return sent.length ? sent[sent.length - 1].createdAt : null;
}

/** Did the reporter give an email address at intake? (the `submitted` event records it, never the address). */
export function reporterGaveEmail(events: readonly EventLike[]): boolean {
  return events.some((e) => e.type === "submitted" && e.payload.hasEmail === true);
}

export type ManualAckChannel = "email" | "phone" | "mail" | "in_person" | "other";

export type AckStep =
  | { kind: "email" }
  | { kind: "manual"; channel: ManualAckChannel; words: string }
  | null;

/**
 * What the lead still has to do to acknowledge receipt "in the same means by which it is received" (ACR s.9(4)):
 * nothing for web reports (the on-screen receipt), anonymous feedback or feedback already acknowledged; an email
 * for email feedback with an address; otherwise a record of the acknowledgement they gave by phone, mail, in person
 * or another way (also email feedback with no address on file: they replied from their own mailbox).
 */
export function acknowledgementStep(c: Pick<CaseRow, "intakeChannel" | "isAnonymous" | "ackAt">, hasEmail: boolean): AckStep {
  if (c.intakeChannel === "web" || c.isAnonymous || c.ackAt) return null;
  if (c.intakeChannel === "email" && hasEmail) return { kind: "email" };
  return { kind: "manual", channel: c.intakeChannel, words: ACK_CHANNEL_WORDS[c.intakeChannel] ?? "another way" };
}

/* ------------------------------------------------------------------ was the reporter really asked? */

/**
 * Whether the reporter was actually asked to check a fix (Phase 7 review: staff were told "the reporter is asked"
 * even when nobody was). `contact` when no email is on file: "none" (anonymous, or nothing recorded), "other" (a
 * phone number or address the lead can see with the original), "unknown" (an owner can't see contact details).
 */
export type RetestAsk =
  | { kind: "emailed"; at?: Date }
  | { kind: "logged"; at?: Date }
  | { kind: "failed" }
  | { kind: "not_sent" }
  | { kind: "no_email"; contact: "none" | "other" | "unknown" };

/** The words for a reporter without an email: they only see the question on their report page. */
export const NO_CONTACT_ON_FILE = "No contact on file: they'll see it only if they open their report page with their code.";
const NO_EMAIL_ON_FILE = "No email on file: they'll see it only if they open their report page with their code.";

/**
 * What happened to this round's re-test request, from the case's events: the email went out, was logged (FAKE_EMAIL),
 * failed, never went out although the reporter gave an email, or there is no email to send it to.
 */
export function retestAskOf(
  events: readonly EventLike[],
  round: number,
  noEmailContact: "none" | "other" | "unknown",
): RetestAsk {
  const requests = events.filter((e) => e.type === "message_sent" && e.payload.template === "retest_request" && e.payload.round === round);
  const ok = requests.filter((e) => e.payload.status !== "failed");
  const last = ok[ok.length - 1];
  if (last) return last.payload.status === "skipped_fake" ? { kind: "logged", at: last.createdAt } : { kind: "emailed", at: last.createdAt };
  if (requests.length) return { kind: "failed" };
  return reporterGaveEmail(events) ? { kind: "not_sent" } : { kind: "no_email", contact: noEmailContact };
}

/** One sentence for the "Log fix" result and the waiting panel: never says the reporter was asked when nobody was. */
export function retestAskSentence(ask: RetestAsk): string {
  switch (ask.kind) {
    case "emailed":
      return "The reporter was emailed and asked to check it.";
    case "logged":
      return "The email asking the reporter to check it was logged, not sent (email is simulated in this prototype; the Outbox shows it).";
    case "failed":
      return "The email asking the reporter to check it could not be sent, so they'll see it only if they open their report page with their code.";
    case "not_sent":
      return "No email asking the reporter to check it has gone out, so they'll see it only if they open their report page with their code.";
    case "no_email":
      return ask.contact === "none"
        ? NO_CONTACT_ON_FILE
        : ask.contact === "other"
          ? `${NO_EMAIL_ON_FILE} You can tell them another way: their contact details are with the original.`
          : NO_EMAIL_ON_FILE;
  }
}
