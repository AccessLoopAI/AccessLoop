// The reporter JSON API's request schemas and response bodies (docs/domain.md §4.1; Phase 7 T4.6). Pure: no database,
// no request, so tests/api-v1.test.ts checks every shape. The words (answers, labels, sentences) are the web pages'
// own constants, so the Expo app and the web form can never drift apart.
import { z } from "zod";
import { PREVIEW_TOKEN_MAX } from "@/lib/intake/preview-token";
import {
  DETAIL_MAX,
  EDITED_SUMMARY_MAX,
  EMAIL_MAX,
  FOLLOW_UP_OPTIONS,
  FOLLOW_UP_VALUES,
  LOCATION_KINDS,
  LOCATION_OPTIONS,
  SUMMARY_CHOICES,
  TEXT_MAX,
  followUpChoice,
  type PreviewRequest,
  type SubmitRequest,
} from "@/lib/intake/types";
import { spellCode } from "@/lib/intake/receipt-extras";
import type { LocationPrefill } from "@/lib/locations/input";
import type { PublicOrg } from "@/lib/orgs";
import type { ReporterCase } from "@/lib/reporter-case";
import {
  RETEST_ANSWERS,
  RETEST_ANSWER_VALUES,
  RETEST_COMMENT_ECHO_MAX,
  RETEST_COMMENT_MAX,
  RETEST_QUESTION,
  RETEST_RESULT_MESSAGES,
  canStopContact,
  type RetestAnswer,
} from "@/lib/retest";
import { reporterStatusLabel, type CaseStatus } from "@/lib/status";

/* ------------------------------------------------------------------ requests (strict: unknown keys are refused) */

/** POST /api/v1/orgs/{slug}/preview: what the web form's step 3 "Next" sends. */
export const PreviewBody = z
  .object({
    text: z.string().trim().min(1).max(TEXT_MAX),
    locationKind: z.enum(LOCATION_KINDS),
    locationDetail: z.string().trim().max(DETAIL_MAX).default(""),
    aiOptOut: z.boolean().default(false),
  })
  .strict();

export function toPreviewRequest(body: z.infer<typeof PreviewBody>): PreviewRequest {
  return { text: body.text, locationKind: body.locationKind, locationDetail: body.locationDetail, aiOptOut: body.aiOptOut };
}

/**
 * POST /api/v1/orgs/{slug}/reports: "Send report". `followUp` is step 3's one question (domain §4), so the app can't
 * ask for an email reply without a re-test either. `email` is used only with followUp "email" (otherwise it is
 * ignored and never stored, as on the web form, where the field is not shown).
 */
export const ReportBody = z
  .object({
    text: z.string().trim().min(1).max(TEXT_MAX),
    locationKind: z.enum(LOCATION_KINDS),
    locationDetail: z.string().trim().max(DETAIL_MAX).default(""),
    followUp: z.enum(FOLLOW_UP_VALUES),
    email: z.string().trim().max(EMAIL_MAX).default(""),
    aiOptOut: z.boolean().default(false),
    /** The answer to "Is this right?": the AI summary confirmed, changed, or the reporter's own words only. */
    summaryChoice: z.enum(SUMMARY_CHOICES).nullable().default(null),
    editedSummary: z.string().max(EDITED_SUMMARY_MAX).default(""),
    /** The preview's sealed token, handed back unchanged (null without a preview). */
    previewToken: z.string().max(PREVIEW_TOKEN_MAX).nullable().default(null),
  })
  .strict();

export function toSubmitRequest(body: z.infer<typeof ReportBody>): SubmitRequest {
  const { wantsRetest, emailChoice } = followUpChoice(body.followUp);
  return {
    text: body.text,
    locationKind: body.locationKind,
    locationDetail: body.locationDetail,
    wantsRetest,
    emailChoice,
    email: emailChoice === "email" ? body.email : "",
    aiOptOut: body.aiOptOut,
    choice: body.summaryChoice,
    editedSummary: body.editedSummary,
    token: body.previewToken,
  };
}

/**
 * POST /api/v1/retest: one of the five answers (domain §3). The comment's length is checked by the route, so a long
 * one gets its own error (comment_too_long) instead of a generic one, as on /r/[code].
 */
export const RetestBody = z
  .object({
    answer: z.enum(RETEST_ANSWER_VALUES),
    comment: z.string().max(RETEST_COMMENT_ECHO_MAX).default("").transform((s) => s.trim()),
  })
  .strict();

/* ------------------------------------------------------------------ responses */

/** The organization's public profile: public by law (ACR s.9(1), s.9(3), s.14(2)), as /p/{slug} shows it. */
export function orgSummary(org: PublicOrg) {
  return {
    slug: org.slug,
    name: org.name,
    feedbackPage: `/p/${org.slug}`,
    contact: {
      designatedTitle: org.feedbackDesignateTitle,
      phone: org.contactPhone,
      email: org.contactEmail,
      mailingAddress: org.contactMailingAddress,
    },
  };
}

/**
 * GET /api/v1/orgs/{slug}: the profile plus the form's answers and limits, in the web form's own words. With
 * `?loc={id}` (a location poster's QR code, Phase 7 T4.5) `place` holds that location's starting answers, exactly as
 * the web form fills them in; null when there is no such location in use in this org (never says why).
 */
export function orgBody(org: PublicOrg, place: LocationPrefill | null = null) {
  return {
    organization: orgSummary(org),
    place: place ? { name: place.name, locationKind: place.locationKind, locationDetail: place.locationDetail } : null,
    form: {
      locationKinds: LOCATION_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint })),
      followUp: FOLLOW_UP_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      summaryChoices: [...SUMMARY_CHOICES],
      limits: { text: TEXT_MAX, locationDetail: DETAIL_MAX, email: EMAIL_MAX, editedSummary: EDITED_SUMMARY_MAX },
    },
  };
}

/** 201 of POST /reports. The ONLY response that ever holds the receipt code (domain §4: it is shown once). */
export function receiptBody(org: PublicOrg, saved: { receiptCode: string; ref: string; receivedAt: Date }) {
  return {
    receiptCode: saved.receiptCode,
    receiptCodeSpelledOut: spellCode(saved.receiptCode),
    reference: saved.ref,
    receivedAt: saved.receivedAt.toISOString(),
    status: "new" as CaseStatus,
    statusLabel: reporterStatusLabel("new"),
    organization: orgSummary(org),
    notice:
      "Keep this code. It is the only way to check your report or confirm a fix if you stay anonymous. " +
      "We show it only this once.",
  };
}

/** GET /api/v1/status (and the report part of POST /retest's answer): what /r/{code} shows, never the code itself. */
export function statusBody(report: ReporterCase, org: PublicOrg | null) {
  const open = report.status === "retest_open";
  return {
    reference: report.ref,
    receivedAt: report.receivedAt.toISOString(),
    status: report.status,
    statusLabel: reporterStatusLabel(report.status, report.closedReason),
    closedReason: report.status === "closed" ? report.closedReason : null,
    organization: org ? orgSummary(org) : { slug: report.orgSlug, name: report.orgName, feedbackPage: `/p/${report.orgSlug}` },
    /** The latest fix description, layer-1 redacted before it entered the log. */
    fixDescription: report.fixDescription,
    wantsRetest: report.wantsRetest,
    /** "Stop contact about this report" is offered (POST /retest with answer opt_out). */
    canStopContact: canStopContact(report.status, report.wantsRetest),
    /** The re-test question with its five answers, only while a re-test is open. */
    retest: open
      ? {
          question: RETEST_QUESTION,
          offerText: report.retestOfferText,
          answers: RETEST_ANSWERS.map((a) => ({ value: a.value, label: a.label, hint: a.hint ?? null })),
          commentMax: RETEST_COMMENT_MAX,
        }
      : null,
  };
}

/** 200 of POST /retest: the sentence the web page shows and announces, and where the report is now. */
export function retestAnsweredBody(answer: RetestAnswer, report: ReturnType<typeof statusBody> | null) {
  return { answer, message: RETEST_RESULT_MESSAGES[answer], report };
}
