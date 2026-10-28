"use server";

// The re-test answer through a one-round link from a re-test email (/r/t/{token}; docs/archive/phase7-prompt.md T3 item 11,
// docs/domain.md §3). The same five answers as /r/[code], with the same rules, but the capability is the signed
// token (lib/retest-link.ts), re-checked here on every call: its MAC, its expiry, and that the case is still in the
// round the token was made for. Nothing else the browser sends (no case id, no org) is trusted. The round check runs
// with the case row locked, so a link for round 1 can never answer round 2, even if a fix is logged in between.
// The frozen state machine decides whether the answer is still allowed, exactly as with the receipt code (its event
// says via "receipt_code": the link stands in for the code, it is only sent to the address the reporter gave).
// Never log the token or the comment.
import { refresh } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { cases } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { appendCaseEvent } from "@/lib/case-events";
import { redactLayer1 } from "@/lib/intake/redact";
import { limitRequest, logRateLimitFailure } from "@/lib/rate-limit";
import { loadReporterCaseById } from "@/lib/reporter-case";
import {
  RETEST_ANSWER_VALUES,
  RETEST_COMMENT_ECHO_MAX,
  RETEST_COMMENT_MAX,
  retestAction,
  type RetestProblem,
  type RetestState,
} from "@/lib/retest";
import { readRetestLink, retestLinkExpired, retestLinkSecret } from "@/lib/retest-link";
import { TransitionError, transition } from "@/lib/state-machine";

const AnswerSchema = z.object({
  token: z.string().max(200),
  answer: z.enum(RETEST_ANSWER_VALUES),
  comment: z.string().max(RETEST_COMMENT_ECHO_MAX).transform((s) => s.trim()),
});

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** Thrown inside the transaction when the case is no longer waiting for this link's round. */
class RoundMoved extends Error {
  constructor(readonly problem: "already_answered" | "link_ended") {
    super(problem);
  }
}

/** "Does it work for you now?" answered through a re-test email's link (only the question: no "Stop contact" form). */
export async function answerRetestByLink(_prev: RetestState, form: FormData): Promise<RetestState> {
  const comment = field(form, "comment").slice(0, RETEST_COMMENT_ECHO_MAX);
  const chosen = RETEST_ANSWER_VALUES.find((a) => a === field(form, "answer"));
  const problem = (p: RetestProblem): RetestState => ({ kind: "problem", problem: p, at: Date.now(), comment, answer: chosen });

  try {
    if (!(await limitRequest("verdict")).ok) return problem("rate_limited");
  } catch (err) {
    logRateLimitFailure("could not check the re-test limit", err);
    return problem("failed");
  }

  const parsed = AnswerSchema.safeParse({ token: field(form, "token"), answer: field(form, "answer") || undefined, comment });
  if (!parsed.success) return problem("choose");
  if (parsed.data.comment.length > RETEST_COMMENT_MAX) return problem("comment_too_long");
  const { answer } = parsed.data;

  let claims;
  try {
    claims = readRetestLink(parsed.data.token, retestLinkSecret());
  } catch (err) {
    console.error(`[retest] the re-test link secret is not available (${err instanceof Error ? err.name : "UnknownError"})`);
    return problem("failed");
  }
  if (!claims) return problem("not_found");
  if (retestLinkExpired(claims)) return problem("link_ended");
  const link = claims;

  try {
    const found = await loadReporterCaseById({ orgId: link.orgId, caseId: link.caseId });
    if (!found) return problem("not_found");

    await withOrg({ orgId: found.orgId, role: "reporter" }, async (tx) => {
      // Lock the row first and check the round on its fresh state; transition() then re-plans on the same lock.
      const [c] = await tx
        .select({ status: cases.status, retestRound: cases.retestRound })
        .from(cases)
        .where(and(eq(cases.orgId, found.orgId), eq(cases.id, found.caseId)))
        .for("update");
      if (!c) throw new RoundMoved("already_answered");
      if (c.retestRound !== link.round) throw new RoundMoved("link_ended");
      if (c.status !== "retest_open") throw new RoundMoved("already_answered");

      await transition(tx, found.orgId, found.caseId, retestAction(answer, parsed.data.comment), {
        kind: "reporter",
        via: "receipt_code",
      });
      // As on /r/[code]: the opt-out event has no comment field, so words written anyway are kept as a note
      // (layer-1 scrubbed first: free text never enters the log unredacted).
      if (answer === "opt_out" && parsed.data.comment) {
        await appendCaseEvent(tx, {
          orgId: found.orgId,
          caseId: found.caseId,
          type: "note_added",
          actorKind: "reporter",
          actorId: null,
          payload: { via: "retest_link", note: redactLayer1(parsed.data.comment) },
        });
      }
    });
  } catch (err) {
    if (err instanceof RoundMoved) {
      // Same round, already answered: show where the report is now. A newer round: no refresh, so the page keeps
      // this answer's message in view (and focused) instead of turning into the "earlier check" page under it.
      if (err.problem === "already_answered") refresh();
      return problem(err.problem);
    }
    if (err instanceof TransitionError) {
      refresh();
      return problem("already_answered");
    }
    console.error(`[retest] could not save a re-test answer from a link (${err instanceof Error ? err.name : "UnknownError"})`);
    return problem("failed");
  }

  refresh();
  return { kind: "answered", answer, at: Date.now() };
}
