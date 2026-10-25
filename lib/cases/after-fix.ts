// What happens after a fix is logged on the staff case page, once its transaction has committed. Server-only.
//
// When the reporter agreed to check the fix and rounds remain, transition() has already moved the case to
// retest_open and appended `retest_requested` (domain §3). Anonymous reporters check with their receipt code on
// /r/[code]. Reporters who gave an email also get the re-test request email (lib/email/case-emails.ts; FAKE_EMAIL=1:
// logged to outbound_messages, recorded as a message_sent event), at most once per round. It is a separate step
// on purpose: an email problem must never undo a logged fix. The email is recorded in a short transaction, sent
// once that has committed (lib/email/send.ts: never inside a transaction), and its result recorded in another.
//
// The fix may have been logged by an owner, whose transaction can't read case_private. This is a system send, so it
// opens its own transaction with the lead role (the only role RLS lets read the address) for this one email.
//
// It answers what really happened (lib/cases/messages.ts RetestAsk), so the "Log fix" result never says the
// reporter was asked when nobody was (Phase 7 review). Only the null-ness of the other contact is read, and only
// reported back to a lead.
import { and, eq, sql } from "drizzle-orm";
import { casePrivate, cases } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { queueRetestRequest } from "@/lib/email/case-emails";
import { deliverEmail, type QueuedEmail } from "@/lib/email/send";
import type { RetestAsk } from "./messages";

export interface FixLogged {
  orgId: string;
  caseId: string;
  ref: string;
  /** True when the case is now waiting for the reporter (retest_open). */
  retestRequested: boolean;
  /** The re-test round the fix opened (cases.retestRound after the transition). */
  round: number;
  /** The member who logged it may read contact details (a lead): then "no email" says whether another contact exists. */
  viewerSeesContact: boolean;
}

/**
 * Called by the "Log fix" server action after a successful log_fix transition. null: no re-test was requested, or the
 * case moved on in between (nothing to say about asking).
 */
export async function afterFixLogged(fix: FixLogged): Promise<RetestAsk | null> {
  if (!fix.retestRequested) return null;
  const r = await withOrg(
    { orgId: fix.orgId, role: "lead" },
    async (tx): Promise<{ queued: QueuedEmail } | { ask: RetestAsk | null }> => {
      const [c] = await tx
        .select()
        .from(cases)
        .where(and(eq(cases.orgId, fix.orgId), eq(cases.id, fix.caseId)))
        .for("update");
      if (!c || c.retestRound !== fix.round) return { ask: null }; // the case moved on in between: nothing to ask
      const q = await queueRetestRequest(tx, c);
      if (q.ok) return { queued: q.queued };
      if (q.reason !== "no_email") return { ask: null };
      if (c.isAnonymous) return { ask: { kind: "no_email", contact: "none" } };
      if (!fix.viewerSeesContact) return { ask: { kind: "no_email", contact: "unknown" } };
      const [p] = await tx
        .select({ other: sql<boolean>`${casePrivate.reporterContactEnc} is not null` })
        .from(casePrivate)
        .where(and(eq(casePrivate.orgId, fix.orgId), eq(casePrivate.caseId, fix.caseId)))
        .limit(1);
      return { ask: { kind: "no_email", contact: p?.other ? "other" : "none" } };
    },
  );
  if ("ask" in r) return r.ask;
  // Sent only after the transaction that recorded it has committed (lib/email/send.ts).
  const sent = await deliverEmail(r.queued);
  if (sent.status === "failed") return { kind: "failed" };
  return sent.status === "skipped_fake" ? { kind: "logged" } : { kind: "emailed" };
}
