// The reporter's re-test page /r/[code] (docs/domain.md §3, §4): the five answers, what each one does, and the
// sentences shown and announced after an answer. Client-safe (no server imports): the page, its client panel
// and its server action share these, so the words can never drift apart.
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";
import type { CaseStatus } from "@/lib/status";

/** The five answers, in the order domain §3 lists them. `label` is each radio's exact accessible name (e2e). */
export const RETEST_ANSWERS = [
  { value: "fixed", label: "Yes, it works now", hint: undefined },
  { value: "partly", label: "Partly", hint: "Some of it works, but not all of it." },
  { value: "not_fixed", label: "No, still a barrier", hint: undefined },
  { value: "cant_check", label: "I can't check right now", hint: "We will mark it as fixed, but not checked by you." },
  { value: "opt_out", label: "Don't contact me about this again", hint: "We won't ask you about this report again." },
] as const;

export type RetestAnswer = (typeof RETEST_ANSWERS)[number]["value"];
export const RETEST_ANSWER_VALUES = RETEST_ANSWERS.map((a) => a.value) as [RetestAnswer, ...RetestAnswer[]];

export const RETEST_QUESTION = "Does it work for you now?";
export const RETEST_COMMENT_MAX = 1000;
/**
 * How much of a too-long comment the action sends back to the form, so the person can shorten it in place.
 * A comment is never cut short silently: over RETEST_COMMENT_MAX it is refused with a field error.
 */
export const RETEST_COMMENT_ECHO_MAX = RETEST_COMMENT_MAX * 10;

/** What each answer asks the frozen state machine to do (lib/state-machine.ts). */
export function retestAction(answer: RetestAnswer, comment?: string):
  | { kind: "verdict"; verdict: Exclude<RetestAnswer, "opt_out">; comment?: string }
  | { kind: "opt_out" } {
  if (answer === "opt_out") return { kind: "opt_out" };
  return { kind: "verdict", verdict: answer, comment: comment || undefined };
}

/**
 * The sentence shown and announced after an answer. "fixed" is domain §3 verbatim (e2e/demo.spec.ts checks
 * "fixed and confirmed by you" in the status region). Straight apostrophes, like the rest of the contract.
 */
export const RETEST_RESULT_MESSAGES: Record<RetestAnswer, string> = {
  fixed: "Thank you. It's now marked as fixed and confirmed by you.",
  partly: "Thank you. We'll tell the team it only partly works, so they can keep working on it.",
  not_fixed: "Thank you. We'll tell the team it still needs work.",
  cant_check: "That's fine. We've marked it as fixed but not checked by you.",
  opt_out: "We won't contact you about this report again.",
};

export type RetestProblem =
  | "choose"
  | "comment_too_long"
  | "rate_limited"
  | "already_answered"
  | "not_found"
  /** A one-round link from a re-test email (/r/t/{token}) that has expired or belongs to an earlier round. */
  | "link_ended"
  | "failed";

/** The action's answer to the page. `comment` and `answer` come back on a failed submit so nothing typed is lost. */
export type RetestState =
  | { kind: "idle" }
  | { kind: "answered"; answer: RetestAnswer; at: number }
  | { kind: "problem"; problem: RetestProblem; at: number; comment?: string; answer?: RetestAnswer };

export const RETEST_IDLE: RetestState = { kind: "idle" };

/**
 * Heading and sentence for every outcome other than the field errors ("choose" is an error on the question,
 * "comment_too_long" on the comment: see retestFieldError).
 */
export function retestOutcome(state: RetestState): { title: string; message: string; tone: "success" | "info" | "warning" | "danger" } | null {
  if (state.kind === "idle") return null;
  if (state.kind === "answered") {
    return {
      title: "Your answer is saved",
      message: RETEST_RESULT_MESSAGES[state.answer],
      tone: state.answer === "fixed" ? "success" : "info",
    };
  }
  switch (state.problem) {
    case "choose":
    case "comment_too_long":
      return null;
    case "rate_limited":
      return {
        title: "Please wait a few minutes",
        message: RATE_LIMITED_MESSAGE,
        tone: "warning",
      };
    case "already_answered":
      return {
        title: "This question is already answered",
        message: "This question is already answered. This page now shows where your report is.",
        tone: "info",
      };
    case "not_found":
      return {
        title: "We couldn't find this report",
        message: "We couldn't find a report for this code any more. Check the code on your receipt.",
        tone: "warning",
      };
    case "link_ended":
      return {
        title: "This link no longer works",
        message: RETEST_LINK_ENDED_MESSAGE,
        tone: "warning",
      };
    case "failed":
      return {
        title: "Your answer was not saved",
        message: "We could not save your answer just now. Please try again.",
        tone: "danger",
      };
  }
}

/**
 * A re-test email's link (/r/t/{token}, lib/retest-link.ts) works for one check only, for 30 days at most. After that,
 * or once a newer check has started, this is what the person reads. Nothing about the report changed.
 */
export const RETEST_LINK_ENDED_MESSAGE =
  "The link in our email works for one check only, for 30 days at most. Nothing was saved. To see your report, use your receipt code.";

/** The error shown on the question itself when "Send answer" is pressed with nothing chosen. */
export const RETEST_CHOOSE_ERROR = "Choose one answer.";

/** The error shown on the comment when it is longer than RETEST_COMMENT_MAX (nothing is saved). */
export const RETEST_COMMENT_TOO_LONG_ERROR = `Keep your comment under ${RETEST_COMMENT_MAX.toLocaleString("en-CA")} characters.`;

/** The field error for a problem state, with the field it belongs to; null for every other state. */
export function retestFieldError(state: RetestState): { field: "answer" | "comment"; message: string } | null {
  if (state.kind !== "problem") return null;
  if (state.problem === "choose") return { field: "answer", message: RETEST_CHOOSE_ERROR };
  if (state.problem === "comment_too_long") return { field: "comment", message: RETEST_COMMENT_TOO_LONG_ERROR };
  return null;
}

/* ------------------------------------------------------------------ how long a receipt code works */

/** Domain §4: "The code is valid until the case is terminal plus 30 days." */
export const RECEIPT_VALID_AFTER_TERMINAL_DAYS = 30;

export const TERMINAL_STATUSES: readonly CaseStatus[] = ["verified", "closed"];

export function isTerminal(status: CaseStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * True when the code no longer works: the case is verified or closed and that happened more than 30 days
 * before `now`. A terminal case without a known time keeps working (it can't be judged, so nothing is lost).
 */
export function receiptExpired(status: CaseStatus, terminalAt: Date | null, now: Date): boolean {
  if (!isTerminal(status) || !terminalAt) return false;
  return now.getTime() - terminalAt.getTime() > RECEIPT_VALID_AFTER_TERMINAL_DAYS * 86_400_000;
}

/** The reporter can still be asked about this case: they said yes to a re-test and it is not finished. */
export function canStopContact(status: CaseStatus, wantsRetest: boolean): boolean {
  return wantsRetest && !isTerminal(status) && status !== "retest_open";
}
