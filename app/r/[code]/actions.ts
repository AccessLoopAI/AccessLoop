"use server";

// The re-test answer on /r/[code] (docs/domain.md §3). A POST only: the page's GET never changes anything, so
// email link scanners that prefetch the link can't answer for the reporter. The receipt code is the reporter's
// only capability: it is re-resolved here on every call, and nothing else the browser sends (no case id, no
// org) is trusted. The state machine (frozen lib/state-machine.ts) decides whether the answer is still allowed.
// The rules live in lib/retest-answer.ts, shared with the reporter JSON API (POST /api/v1/retest).
// Never log the code or the comment.
import { refresh } from "next/cache";
import { z } from "zod";
import { limitRequest, logRateLimitFailure } from "@/lib/rate-limit";
import { normalizeReceiptCode } from "@/lib/receipt-code";
import {
  RETEST_ANSWER_VALUES,
  RETEST_COMMENT_ECHO_MAX,
  RETEST_COMMENT_MAX,
  type RetestProblem,
  type RetestState,
} from "@/lib/retest";
import { saveRetestAnswer } from "@/lib/retest-answer";

const AnswerSchema = z.object({
  code: z.string().max(64),
  /** Which form sent it: the re-test question, or the small "Stop contact about this report" form. */
  source: z.enum(["question", "stop_contact"]),
  answer: z.enum(RETEST_ANSWER_VALUES),
  // Never cut short silently: a comment over RETEST_COMMENT_MAX is refused below with a field error.
  comment: z.string().max(RETEST_COMMENT_ECHO_MAX).transform((s) => s.trim()),
});

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** The reporter's answer to "Does it work for you now?", or "Stop contact about this report" (answer opt_out). */
export async function answerRetest(_prev: RetestState, form: FormData): Promise<RetestState> {
  const comment = field(form, "comment").slice(0, RETEST_COMMENT_ECHO_MAX);
  const chosen = RETEST_ANSWER_VALUES.find((a) => a === field(form, "answer"));
  const problem = (p: RetestProblem): RetestState => ({ kind: "problem", problem: p, at: Date.now(), comment, answer: chosen });

  try {
    if (!(await limitRequest("verdict")).ok) return problem("rate_limited");
  } catch (err) {
    logRateLimitFailure("could not check the re-test limit", err);
    return problem("failed");
  }

  const parsed = AnswerSchema.safeParse({
    code: field(form, "code"),
    source: field(form, "source"),
    answer: field(form, "answer") || undefined,
    comment,
  });
  if (!parsed.success) {
    // Nothing chosen (or an answer that isn't one of the five): ask again, keeping the comment.
    return problem("choose");
  }
  const { answer, source } = parsed.data;
  if (source === "stop_contact" && answer !== "opt_out") return problem("choose");
  if (parsed.data.comment.length > RETEST_COMMENT_MAX) return problem("comment_too_long");
  const normalized = normalizeReceiptCode(parsed.data.code);
  if (!normalized) return problem("not_found");

  const saved = await saveRetestAnswer(normalized, { source, answer, comment: parsed.data.comment });
  if (saved.kind === "not_found") return problem("not_found");
  if (saved.kind === "failed") return problem("failed");
  if (saved.kind === "already_answered") {
    refresh(); // show where the report is now
    return problem("already_answered");
  }

  refresh();
  return { kind: "answered", answer, at: Date.now() };
}
