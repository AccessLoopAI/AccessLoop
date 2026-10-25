"use server";

// "Log feedback" (docs/domain.md §3, §4 staff-logged intake; CLAUDE.md security rules). A public POST endpoint like
// every server action, so it checks everything itself: the signed-in member (none -> the calm signed-out answer), the lead role, the
// form (zod). The org is the member's, never the request's. The case is created by the frozen createCase() in a
// lead transaction. The receipt code then goes to the person by the system (an email to the address given) or comes
// back in THIS answer only, to be read out once; it is never stored, logged or put in a URL.
import { headers } from "next/headers";
import { withOrg } from "@/db/tenant";
import { aiRequestContext } from "@/lib/ai/context";
import { getStaffOrg } from "@/lib/auth/staff";
import { signedOutAnswer } from "@/lib/auth/signed-out";
import { REFUSED } from "@/lib/cases/action-result";
import { createCase } from "@/lib/cases/create";
import { sendIntakeEmail } from "@/lib/email/case-emails";
import { parseStaffIntake, prepareStaffCase } from "@/lib/intake/staff";
import { STAFF_INTAKE_FIELDS, type LogFeedbackResult } from "@/lib/intake/staff-types";

/** The receipt code could not be emailed: the whole intake rolls back, because nobody else will ever see that code. */
class CodeNotEmailed extends Error {}

export async function logFeedback(form: FormData): Promise<LogFeedbackResult> {
  const staff = await getStaffOrg();
  if (!staff) return signedOutAnswer();
  const at = Date.now();
  if (staff.role !== "lead") return { ok: false, message: REFUSED.role, at };

  const raw: Record<string, string> = {};
  for (const name of [...STAFF_INTAKE_FIELDS, "aiOptOut"]) {
    const value = form.get(name);
    if (typeof value === "string") raw[name] = value;
  }
  const now = new Date();
  const parsed = parseStaffIntake(raw, now);
  if (!parsed.ok) return { ok: false, message: Object.values(parsed.errors)[0], fieldErrors: parsed.errors, at };
  const intake = parsed.value;

  try {
    const ai = aiRequestContext(await headers()); // claude-cli runs only for a local request (domain §6.1)
    const input = await prepareStaffCase(staff.orgId, intake, staff.memberId, now, ai);
    const done = await withOrg({ orgId: staff.orgId, role: "lead" }, async (tx) => {
      const created = await createCase(tx, input);
      if (!intake.email) return { ref: created.case.ref, code: created.receiptCode, emailStatus: null };
      const sent = await sendIntakeEmail(tx, {
        orgId: staff.orgId,
        caseId: created.case.id,
        ref: created.case.ref,
        template: "receipt_code",
        to: intake.email,
        code: created.receiptCode,
      });
      if (sent.status === "failed") throw new CodeNotEmailed();
      return { ref: created.case.ref, code: null, emailStatus: sent.status };
    });
    const simulated = done.emailStatus === "skipped_fake";
    return {
      ok: true,
      ref: done.ref,
      code: done.code,
      emailed: done.emailStatus !== null,
      emailSimulated: simulated,
      needsAck: !intake.anonymous,
      message: done.code
        ? `Feedback logged as ${done.ref}. Read the receipt code below to the person: it won't be shown again.`
        : `Feedback logged as ${done.ref}. The receipt code was ${simulated ? "emailed (simulated)" : "emailed"} to the person.`,
      at: Date.now(),
    };
  } catch (err) {
    if (err instanceof CodeNotEmailed) {
      const msg =
        "We couldn't email the receipt code, so nothing was saved. Check the email address and try again, or leave it empty: then you read the code to the person.";
      return { ok: false, message: msg, fieldErrors: { email: msg }, at: Date.now() };
    }
    console.error(`[intake] could not log staff feedback (${err instanceof Error ? err.name : "UnknownError"})`);
    return { ok: false, message: REFUSED.failed, at: Date.now() };
  }
}
