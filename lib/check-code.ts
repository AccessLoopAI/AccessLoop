// /check: a reporter types the receipt code to find their report (docs/domain.md §4). Client-safe: the words and
// the action's state, shared by the server action and the form. The code itself is never logged.
import { RATE_LIMITED_MESSAGE } from "@/lib/rate-limit-message";

export const CHECK_CODE_MAX = 64;

export type CheckProblem = "format" | "unknown" | "rate_limited" | "failed";

/** `code` is what the person typed, sent back only to their own form so a typo can be fixed in place. */
export type CheckState = { problem: CheckProblem; code: string; at: number } | null;

export const CHECK_MESSAGES: Record<CheckProblem, string> = {
  format: "That code doesn't look right. It has 16 letters and numbers.",
  // The same answer whether the code never existed or no longer works: it never says which.
  unknown: "We couldn't find a report with that code. Check it and try again.",
  rate_limited: RATE_LIMITED_MESSAGE,
  failed: "We could not check your code just now. Please try again.",
};

/** Problems with the code itself go on the field; the others are about the connection or the server. */
export function isFieldProblem(problem: CheckProblem): boolean {
  return problem === "format" || problem === "unknown";
}
