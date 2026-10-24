// Every sentence the app shows, in one file. The same plain-language copy as the web reporter flow (grade 6-8):
// lib/intake/types.ts, app/o/[orgSlug]/report/ReportFlow.tsx, lib/retest.ts, lib/status.ts, lib/check-code.ts.
// Never the words "priority area" or "barrier classification". Never "compliant", "certified" or "guarantees".
// Straight apostrophes, like the web contract.
import type { ApiProblem, CaseStatus, LocationKind, RetestAnswer } from "./api";

export const STEP_TITLES = {
  1: "What got in your way?",
  2: "Where did it happen?",
  3: "How can we follow up?",
  4: "Check your report",
} as const;
export type Step = keyof typeof STEP_TITLES;

export const LOCATION_OPTIONS: readonly { value: LocationKind; label: string; hint: string }[] = [
  { value: "digital", label: "On a website or app", hint: "For example, online banking, an app or a booking page." },
  { value: "place", label: "At a place", hint: "For example, a branch, an entrance, a ramp or a washroom." },
  { value: "phone_or_service", label: "On the phone or at a service", hint: "For example, a phone line or a service counter." },
  { value: "document", label: "In a document", hint: "For example, a form, a letter or a PDF." },
  { value: "other", label: "Somewhere else", hint: "Anything else, like a rule or the way you were treated." },
];

/** Step 3: one question, three answers (T4 item 2). Each maps to wantsRetest + emailChoice in src/report-draft.tsx. */
export type FollowUp = "none" | "code" | "email";
export const FOLLOW_UP_OPTIONS: readonly { value: FollowUp; label: string; hint: string }[] = [
  {
    value: "none",
    label: "Don't contact me",
    hint: "You still get a receipt code, so you can check on your report.",
  },
  {
    value: "code",
    label: "Let me check the fix with my code",
    hint: "When a fix is ready, you can use your code to tell us if it works for you. You stay anonymous.",
  },
  {
    value: "email",
    label: "Email me, and let me check the fix",
    hint: "We email you when there is news, and you can tell us if the fix works for you.",
  },
];

export const EMAIL_HINT =
  "If you add your email, the organization's accessibility team can see it. It is never shown in public reports.";

export const AI_DISCLOSURE =
  "An AI tool helps summarize your report. We remove names and contact details before staff see it.";
export const AI_LATER_CHOICE = "On the next screen, you can choose not to use the AI summary.";
export const NO_AI_NOTE =
  "We won't use AI on your report. A staff member will read it and remove names and contact details before others see it.";
export const SUMMARIZING = "Summarizing your report…";
export const SENDING = "Sending your report…";

/** Step 4: "Is this right?" Four answers; the last one turns the AI off for this report. */
export type ReviewChoice = "ai_confirmed" | "ai_edited" | "reporter_words" | "no_ai";
export const REVIEW_OPTIONS: readonly { value: ReviewChoice; label: string; hint: string }[] = [
  { value: "ai_confirmed", label: "Yes, that's right", hint: "We send this short version with your report." },
  { value: "ai_edited", label: "Change it", hint: "Write the short version yourself." },
  { value: "reporter_words", label: "Keep my words only", hint: "We send your own words, just as you wrote them." },
  {
    value: "no_ai",
    label: "Don't use AI on my report",
    hint: "We throw away the AI summary. A staff member will read your words and sort your report.",
  },
];

export const ERRORS = {
  text: "Tell us what got in your way. A few words is enough.",
  textTooLong: (max: number) => `This is too long to send. Keep it under ${max.toLocaleString("en-CA")} characters.`,
  where: "Choose where it happened. If you are not sure, choose Somewhere else.",
  detailTooLong: (max: number) => `Keep this under ${max} characters.`,
  followUp: "Choose one answer.",
  emailMissing: "Enter your email address, or choose another answer.",
  emailFormat: "Enter an email address like name@example.com.",
  choice: "Choose one answer: Yes, that's right, Change it, Keep my words only, or Don't use AI on my report.",
  edited: "Write a short summary, or choose Keep my words only.",
  editedTooLong: (max: number) => `Keep your summary under ${max} characters.`,
  slug: "Enter the organization's short name, like maple-harbour. Use small letters, numbers and dashes.",
  code: "That code doesn't look right. It has 16 letters and numbers.",
  retestChoose: "Choose one answer.",
  retestCommentTooLong: (max: number) => `Keep your comment under ${max.toLocaleString("en-CA")} characters.`,
};

export const RATE_LIMITED_MESSAGE = "Too many tries from this connection. Please wait a few minutes and try again.";

/** One calm sentence per API problem. `what` is the thing that didn't work ("send your report"). */
export function problemMessage(problem: ApiProblem, what: string): string {
  switch (problem) {
    case "rate_limited":
      return RATE_LIMITED_MESSAGE;
    case "offline":
      return `We could not ${what} because the app can't reach AccessLoop. Check your connection and try again.`;
    case "invalid":
      return `Part of your answers could not be read, so we could not ${what}. Go back and check your answers.`;
    default:
      return `We could not ${what} just now. Please try again.`;
  }
}

/** Reporter wording (domain §3, "Reporter sees"). */
export const REPORTER_STATUS_LABELS: Record<CaseStatus, string> = {
  new: "We got your report",
  triaged: "A team is looking at it",
  assigned: "Someone is working on a fix",
  retest_open: "Please tell us if it works now",
  verified: "Fixed and confirmed by you",
  fixed_unverified: "Fixed (not checked by you)",
  closed: "Closed",
};

const CLOSED_REASON_PLAIN: Record<string, string> = {
  duplicate: "someone already reported this",
  out_of_scope: "this organization is not in charge of it",
  spam: "it was not a report about a barrier",
  no_action_possible: "the team could not find a way to change it",
};

export function reporterStatusLabel(status: CaseStatus, closedReason: string | null): string {
  if (status !== "closed") return REPORTER_STATUS_LABELS[status];
  const plain = closedReason ? CLOSED_REASON_PLAIN[closedReason] : undefined;
  return plain ? `Closed: ${plain}` : REPORTER_STATUS_LABELS.closed;
}

/** One plain sentence about what happens next (app/r/[code]/RetestPanel.tsx NextStep). */
export function nextStepSentence(status: CaseStatus, wantsRetest: boolean): string {
  switch (status) {
    case "retest_open":
      return "The team made a fix. Please tell us below if it works for you.";
    case "verified":
      return "Thank you for checking the fix. This report is finished.";
    case "closed":
      return "This report is closed. The team will not do more on it.";
    case "fixed_unverified":
      return "The team made a fix. If it still doesn't work for you, you can tell them in a new report.";
    default:
      return wantsRetest
        ? "When the team has made a fix, you can tell us here if it works for you."
        : "We won't ask you to check the fix. The team will still work on your report.";
  }
}

export const RETEST_QUESTION = "Does it work for you now?";
export const RETEST_ANSWERS: readonly { value: RetestAnswer; label: string; hint: string }[] = [
  { value: "fixed", label: "Yes, it works now", hint: "We mark it as fixed and confirmed by you." },
  { value: "partly", label: "Partly", hint: "Some of it works, but not all of it." },
  { value: "not_fixed", label: "No, still a barrier", hint: "We tell the team it still needs work." },
  { value: "cant_check", label: "I can't check right now", hint: "We will mark it as fixed, but not checked by you." },
  { value: "opt_out", label: "Don't contact me about this again", hint: "We won't ask you about this report again." },
];

export const RETEST_RESULT_MESSAGES: Record<RetestAnswer, string> = {
  fixed: "Thank you. It's now marked as fixed and confirmed by you.",
  partly: "Thank you. We'll tell the team it only partly works, so they can keep working on it.",
  not_fixed: "Thank you. We'll tell the team it still needs work.",
  cant_check: "That's fine. We've marked it as fixed but not checked by you.",
  opt_out: "We won't contact you about this report again.",
};

export const RECEIPT_KEEP = "Keep this code. It is the only way to check your report or confirm a fix if you stay anonymous.";

export const CODE_NOT_FOUND = "We couldn't find a report with that code. Check it and try again.";
