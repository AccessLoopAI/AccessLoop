// Staff-logged intake (docs/domain.md §1.3 s.9(3), §3, §4 "Staff-logged intake"), server-only. Feedback that came by
// email, phone, mail, in person or another way enters the same pipeline as the web form: layer-1 patterns and
// layer-2 flagPii on the text as received (both skipped for layer 2 when the person declined AI), the AI summary of
// the REDACTED text, then createCase() (frozen) as `new`, so the lead's redaction review still comes first.
// parseStaffIntake is pure; prepareStaffCase calls the AI (lib/ai, fakes in tests and e2e) through the same shared
// functions and fallbacks as the web form.
import { z } from "zod";
import type { CreateCaseInput } from "@/lib/cases/create";
import type { FieldErrors } from "@/lib/cases/action-result";
import { checkPastDate, instantForDate } from "@/lib/dates";
import type { AiContext } from "@/lib/ai";
import { runIntakeAi } from "./pipeline";
import { DETAIL_MAX, EMAIL_MAX, EMAIL_PATTERN, LOCATION_KINDS, TEXT_MAX, type LocationKindValue } from "./types";
import { CONTACT_MAX, STAFF_CHANNELS, type StaffChannel } from "./staff-types";

export interface StaffIntake {
  channel: StaffChannel;
  /** YYYY-MM-DD, the day the org received it (display time zone). */
  receivedDate: string;
  text: string;
  locationKind: LocationKindValue;
  locationDetail: string;
  anonymous: boolean;
  email: string | null;
  contact: string | null;
  wantsRetest: boolean;
  aiOptOut: boolean;
}

export const STAFF_INTAKE_ERRORS = {
  channel: "Choose how the feedback arrived.",
  dateMissing: "Enter the date you received it.",
  dateInvalid: "Enter the date as year, month and day, for example 2026-10-19.",
  dateFuture: "The date received can't be in the future.",
  dateTooOld: "The date received can't be more than 7 years ago.",
  text: "Write what they told us.",
  textTooLong: `Keep what they told us under ${TEXT_MAX.toLocaleString("en-CA")} characters.`,
  locationKind: "Choose where it happened.",
  detailTooLong: `Keep "Where exactly?" under ${DETAIL_MAX} characters.`,
  anonymous: "Choose if the person wants to stay anonymous.",
  email: "Check the email address. It should look like name@example.com.",
  contactTooLong: `Keep the phone or mailing address under ${CONTACT_MAX} characters.`,
  wantsRetest: "Choose if we can ask them to check the fix later.",
} as const;

const SimpleEmail = z.email();

/** Validate the form's raw values (FormData strings; the checkbox is "on" when ticked). */
export function parseStaffIntake(
  raw: Partial<Record<string, string>>,
  now: Date,
): { ok: true; value: StaffIntake } | { ok: false; errors: FieldErrors } {
  const v = (k: string) => (raw[k] ?? "").trim();
  const errors: FieldErrors = {};

  const channel = z.enum(STAFF_CHANNELS).safeParse(v("channel"));
  if (!channel.success) errors.channel = STAFF_INTAKE_ERRORS.channel;

  const date = v("receivedDate");
  const dateProblem = checkPastDate(date, now);
  if (dateProblem === "missing") errors.receivedDate = STAFF_INTAKE_ERRORS.dateMissing;
  else if (dateProblem === "invalid") errors.receivedDate = STAFF_INTAKE_ERRORS.dateInvalid;
  else if (dateProblem === "future") errors.receivedDate = STAFF_INTAKE_ERRORS.dateFuture;
  else if (dateProblem === "too_old") errors.receivedDate = STAFF_INTAKE_ERRORS.dateTooOld;

  const text = v("text");
  if (!text) errors.text = STAFF_INTAKE_ERRORS.text;
  else if (text.length > TEXT_MAX) errors.text = STAFF_INTAKE_ERRORS.textTooLong;

  const location = z.enum(LOCATION_KINDS).safeParse(v("locationKind"));
  if (!location.success) errors.locationKind = STAFF_INTAKE_ERRORS.locationKind;
  const detail = v("locationDetail");
  if (detail.length > DETAIL_MAX) errors.locationDetail = STAFF_INTAKE_ERRORS.detailTooLong;

  const anonymousAnswer = v("anonymous");
  if (anonymousAnswer !== "yes" && anonymousAnswer !== "no") errors.anonymous = STAFF_INTAKE_ERRORS.anonymous;
  const anonymous = anonymousAnswer === "yes";

  // Contact details count only when the person does not stay anonymous (a hidden field may still hold old input).
  const email = anonymous ? "" : v("email");
  if (email && (email.length > EMAIL_MAX || !EMAIL_PATTERN.test(email) || !SimpleEmail.safeParse(email).success)) {
    errors.email = STAFF_INTAKE_ERRORS.email;
  }
  const contact = anonymous ? "" : v("contact");
  if (contact.length > CONTACT_MAX) errors.contact = STAFF_INTAKE_ERRORS.contactTooLong;

  const retest = v("wantsRetest");
  if (retest !== "yes" && retest !== "no") errors.wantsRetest = STAFF_INTAKE_ERRORS.wantsRetest;

  if (Object.keys(errors).length || !channel.success || !location.success) return { ok: false, errors };
  return {
    ok: true,
    value: {
      channel: channel.data,
      receivedDate: date,
      text,
      locationKind: location.data,
      locationDetail: detail,
      anonymous,
      email: email || null,
      contact: contact || null,
      wantsRetest: retest === "yes",
      aiOptOut: raw.aiOptOut === "on" || raw.aiOptOut === "true",
    },
  };
}

/** Everything createCase() needs for feedback a lead logs. The code goes by email when one was given (codeRelayedByStaff false). */
export async function prepareStaffCase(
  orgId: string,
  intake: StaffIntake,
  memberId: string,
  now: Date,
  aiCtx?: AiContext,
): Promise<CreateCaseInput> {
  // The same AI steps as the web form's preview (lib/intake/pipeline.ts runIntakeAi): both flagPii calls in parallel,
  // one time budget, the shared fallbacks. On any AI failure there is no summary, and the lead triages from the words.
  const run = await runIntakeAi(intake.text, intake.locationDetail || null, intake.locationKind, {
    aiOptOut: intake.aiOptOut,
    ai: aiCtx,
  });
  const { text, detail } = run;

  const r = run.ai;
  const ai: CreateCaseInput["ai"] = r
    ? {
        summary: r.value.summary,
        priorityAreas: r.value.priorityAreas,
        uncertain: r.value.uncertain,
        backend: r.meta.backend,
        model: r.meta.model,
        promptSha: r.meta.promptSha,
        latencyMs: r.meta.latencyMs,
        cliVersion: r.meta.cliVersion,
      }
    : null;

  return {
    orgId,
    intakeChannel: intake.channel,
    locationKind: intake.locationKind,
    locationDetail: detail ? detail.redactedText : null,
    rawText: intake.text,
    redactedText: text.redactedText,
    spans: text.spans,
    needsManualRedaction: text.needsManualRedaction || Boolean(detail?.needsManualRedaction),
    isAnonymous: intake.anonymous,
    wantsRetest: intake.wantsRetest,
    aiOptOut: intake.aiOptOut,
    reporterEmail: intake.email,
    reporterContact: intake.contact,
    receivedAt: instantForDate(intake.receivedDate, now),
    ai,
    // The AI summary of the redacted text (layers 1 and 2 already ran on what it saw); the person never reviewed
    // it, so summarySource is "staff" and the lead's redaction review shows it before anyone else reads it.
    summary: ai?.summary ?? null,
    summarySource: "staff",
    loggedByMemberId: memberId,
    codeRelayedByStaff: !intake.email,
  };
}
