// "Send report" for a public report (docs/domain.md §4), shared by the web form's server action
// (app/o/[orgSlug]/report/actions.ts) and the reporter JSON API (app/api/v1/orgs/[slug]/reports, domain §4.1), so both
// store exactly the same thing: the email checked, the org's daily cap counted (domain §9), the text redacted again on
// the server (prepareCase never calls the AI), the case created by the frozen createCase(), then the acknowledgement
// email when an email was given, recorded in a short transaction and sent only after it commits (lib/email/send.ts).
// Server-only. The org comes from the caller's server-side slug lookup, never from the request. Never logs report
// text, emails or receipt codes.
import { z } from "zod";
import { withOrg } from "@/db/tenant";
import { createCase } from "@/lib/cases/create";
import { queueIntakeEmail } from "@/lib/email/case-emails";
import { deliverEmail } from "@/lib/email/send";
import { limitOrgSubmission, logRateLimitFailure } from "@/lib/rate-limit";
import { prepareCase } from "./pipeline";
import { EMAIL_PATTERN, type SubmitRequest } from "./types";

const SimpleEmail = z.email();

/** The same rule on the web form and the API: a plain, single address with a dot in the domain. */
export function isReporterEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email) && SimpleEmail.safeParse(email).success;
}

export type SaveReportResult =
  | { ok: true; receiptCode: string; caseId: string; ref: string; receivedAt: Date }
  /**
   * "email": the reporter chose email but the address doesn't look right. "org_full": the org's form has taken its
   * reports for the day (ORG_DAILY_SUBMISSION_LIMIT; the caller names the org's other channels). "failed": nothing
   * was saved.
   */
  | { ok: false; problem: "email" | "org_full" | "failed" };

/**
 * Save one public report for `orgId`. `req` is already validated (zod) and trimmed. On success the receipt code is
 * returned to the caller, which shows it once (the receipt page, or the API's one response) and never logs it.
 */
export async function saveWebReport(orgId: string, req: SubmitRequest): Promise<SaveReportResult> {
  let email: string | null = null;
  if (req.emailChoice === "email") {
    if (!isReporterEmail(req.email)) return { ok: false, problem: "email" };
    email = req.email;
  }

  // The org's daily cap on web reports (lib/rate-limit.ts, ORG_DAILY_SUBMISSION_LIMIT; shown on its dashboard).
  // Counted last, after every check that could refuse the report, so a refused one never uses up a place.
  try {
    if (!(await limitOrgSubmission(orgId)).ok) return { ok: false, problem: "org_full" };
  } catch (err) {
    logRateLimitFailure("could not check the daily limit", err);
    return { ok: false, problem: "failed" };
  }

  const receivedAt = new Date();
  let saved: { receiptCode: string; caseId: string; ref: string };
  try {
    const prepared = await prepareCase(orgId, req, email); // never calls the AI (domain §6.1 limit 4)
    const created = await withOrg({ orgId, role: "reporter" }, (tx) => createCase(tx, { ...prepared, receivedAt }));
    saved = { receiptCode: created.receiptCode, caseId: created.case.id, ref: created.case.ref };
  } catch (err) {
    console.error(`[intake] could not save a web report (${err instanceof Error ? err.name : "UnknownError"})`);
    return { ok: false, problem: "failed" };
  }

  // Domain §4: an email acknowledgement when an email was given (the on-screen receipt stays the ACR s.9(4)
  // acknowledgement). It may carry the code: it is sent now, while the code is still known. After the case is
  // saved: its outbound_messages row in a short transaction of its own, then the send (5 s at most) with no
  // transaction open, then its status in a second short one (lib/email/send.ts). An email problem never loses the
  // report (the attempt is logged as failed).
  if (email) {
    const to = email;
    try {
      const queued = await withOrg({ orgId, role: "reporter" }, (tx) =>
        queueIntakeEmail(tx, { orgId, caseId: saved.caseId, ref: saved.ref, to, code: saved.receiptCode }),
      );
      await deliverEmail(queued);
    } catch (err) {
      console.error(`[intake] could not record the acknowledgement email (${err instanceof Error ? err.name : "UnknownError"})`);
    }
  }

  return { ok: true, ...saved, receivedAt };
}
