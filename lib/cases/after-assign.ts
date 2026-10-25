// "A barrier was assigned to you" (docs/phase7-prompt.md T2 item 7): the email to the staff member a case is assigned
// to, sent by the "Assign" server action once its transaction has committed. Server-only.
//
// It is a separate step on purpose, like the re-test request after a fix (lib/cases/after-fix.ts): an email problem
// must never undo an assignment, and no network call may hold the assignment's transaction open. It carries no report
// text: the case reference and a link to the case page only (lib/email/templates.ts "owner_assigned").
//
// Staff addresses: org_members has none (AUTH_MODE=local has no addresses at all; at Going live it is the Clerk
// user's primary email), so lib/email/staff-address.ts answers null until the Clerk adapter exists. With FAKE_EMAIL=1
// nothing leaves the machine, so the email is still recorded in the Outbox (and as a message_sent event on the case);
// with real email and no address nothing is sent and the lead is told to tell them another way. Never a guess.
//
// T3's mailer (lib/email/send.ts): the email is queued in one short lead transaction (the outbound_messages row,
// "pending"), sent only after that transaction has committed, and its result recorded in a second short one.
import { and, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cases, orgMembers } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { deliverEmail, emailData, queueEmail, type QueuedEmail, type SentEmail, type TxRunner } from "@/lib/email/send";
import { staffEmailAddress } from "@/lib/email/staff-address";

/** What happened to the email telling the assignee. */
export type OwnerTold =
  | { kind: "emailed" }
  | { kind: "logged" }
  | { kind: "failed" }
  | { kind: "not_sent" }
  | { kind: "no_address" };

export interface Assigned {
  orgId: string;
  caseId: string;
  ref: string;
  /** The member the case is now assigned to. */
  memberId: string;
  /** The lead who assigned it (the email's actor in the case's log). */
  assignedBy: string;
}

/**
 * Tell the assignee by email. null: nothing to tell (the case moved on in between, or is no longer theirs). The
 * caller decides when it is worth an email: a new assignee, never the lead who assigned it to themself.
 */
export async function afterAssigned(a: Assigned): Promise<OwnerTold | null> {
  const r = await withOrg({ orgId: a.orgId, role: "lead" }, (tx) => queueAssigneeEmail(tx, a));
  // Sent only after the transaction that recorded it has committed (lib/email/send.ts); recorded as the system.
  return r && "queued" in r ? toldOf(await deliverEmail(r.queued)) : r;
}

/**
 * The same, with each step in its own transaction from `runTx` (the tests run them on PGlite): queue, then send
 * after that transaction committed, then record the result in a second one.
 */
export async function tellAssignee(a: Assigned, runTx: TxRunner): Promise<OwnerTold | null> {
  const r = await runTx((tx) => queueAssigneeEmail(tx, a));
  return r && "queued" in r ? toldOf(await deliverEmail(r.queued, { runTx })) : r;
}

/** Step 1, in the caller's transaction: the checks, and the email recorded as pending. Nothing is sent here. */
async function queueAssigneeEmail(tx: Tx, a: Assigned): Promise<{ queued: QueuedEmail } | OwnerTold | null> {
  const [c] = await tx
    .select({ status: cases.status, assignedTo: cases.assignedTo })
    .from(cases)
    .where(and(eq(cases.orgId, a.orgId), eq(cases.id, a.caseId)))
    .for("update");
  if (!c || c.status !== "assigned" || c.assignedTo !== a.memberId) return null;
  const [member] = await tx
    .select({ id: orgMembers.id, clerkUserId: orgMembers.clerkUserId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, a.orgId), eq(orgMembers.id, a.memberId)))
    .limit(1);
  if (!member) return null;
  const to = await staffEmailAddress({ orgId: a.orgId, memberId: member.id, clerkUserId: member.clerkUserId });
  // With FAKE_EMAIL=1 nothing leaves the machine, so the Outbox records it even with no address known.
  if (!to && process.env.FAKE_EMAIL !== "1") return { kind: "no_address" };
  const queued = await queueEmail({
    tx,
    orgId: a.orgId,
    caseId: a.caseId,
    template: "owner_assigned",
    to: to ?? "",
    data: await emailData(tx, a.orgId, a.ref),
    actor: { kind: "staff", memberId: a.assignedBy },
  });
  return { queued };
}

function toldOf(sent: SentEmail): OwnerTold {
  if (sent.status === "failed") return { kind: "failed" };
  return sent.status === "skipped_fake" ? { kind: "logged" } : { kind: "emailed" };
}

/** One sentence for the "Assign" result: what really happened to the email, never "they were told" when nobody was. */
export function ownerToldSentence(told: OwnerTold, name: string): string {
  switch (told.kind) {
    case "emailed":
      return `${name} was emailed that it is theirs.`;
    case "logged":
      return `The email telling ${name} was logged, not sent (email is simulated in this prototype; the Outbox shows it).`;
    case "failed":
      return `The email telling ${name} could not be sent, so tell them another way.`;
    case "not_sent":
      return `No email went to ${name}, so tell them another way.`;
    case "no_address":
      return `No email address is on file for ${name}, so no email was sent: tell them another way.`;
  }
}
