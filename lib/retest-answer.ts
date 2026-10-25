// Saving a reporter's re-test answer (docs/domain.md §3), shared by /r/[code]'s server action
// (app/r/[code]/actions.ts) and the reporter JSON API (POST /api/v1/retest, domain §4.1), so both apply exactly the
// same rules. Server-only. The receipt code is the reporter's only capability: it is resolved here on every call, and
// nothing else from the request (no case id, no org) is trusted. The frozen state machine decides whether the answer
// is still allowed. Never logs the code or the comment.
import { withOrg } from "@/db/tenant";
import { appendCaseEvent } from "@/lib/case-events";
import { redactLayer1 } from "@/lib/intake/redact";
import { loadReporterCase } from "@/lib/reporter-case";
import { isTerminal, retestAction, type RetestAnswer } from "@/lib/retest";
import { TransitionError, transition } from "@/lib/state-machine";

/**
 * Where the answer came from:
 * - "question": the re-test question, which exists only while a re-test is open;
 * - "stop_contact": the small "Stop contact about this report" form (answer opt_out), at any other time;
 * - "auto" (the API, which has one endpoint for both): opt_out is a stop-contact unless a re-test is open.
 */
export type RetestSource = "question" | "stop_contact" | "auto";

export type RetestSaveResult =
  /** Saved. `recorded` is false when nothing new had to be written (contact had already stopped, or the report is finished). */
  | { kind: "answered"; recorded: boolean }
  /** The code is unknown, malformed or expired (never says which). */
  | { kind: "not_found" }
  /** A stale answer: the question is no longer open (another tab or device answered first). Nothing changed. */
  | { kind: "already_answered" }
  /** The database failed; nothing was saved. */
  | { kind: "failed" };

/**
 * Save `answer` for the case behind a NORMALIZED receipt code (lib/receipt-code.ts normalizeReceiptCode). The comment
 * is already trimmed and within RETEST_COMMENT_MAX (the caller refuses a longer one with a field error).
 */
export async function saveRetestAnswer(
  normalized: string,
  input: { source: RetestSource; answer: RetestAnswer; comment: string },
): Promise<RetestSaveResult> {
  const { answer, comment } = input;
  try {
    const found = await loadReporterCase(normalized);
    if (!found) return { kind: "not_found" };

    const source = input.source !== "auto" ? input.source : answer === "opt_out" && found.status !== "retest_open" ? "stop_contact" : "question";
    // The stop-contact form only ever sends opt_out (its caller refuses anything else before this call).
    if (source === "stop_contact" && answer !== "opt_out") return { kind: "already_answered" };
    // The question only exists while a re-test is open. A stale answer (another tab answered first, or the page was
    // left open) gets a calm "already answered", never a second answer.
    if (source === "question" && found.status !== "retest_open") return { kind: "already_answered" };
    // "Stop contact" when contact has already stopped, or the report is finished (verified or closed: nobody asks
    // about it again): nothing new to record in the log, and the answer is still true.
    if (source === "stop_contact" && (!found.wantsRetest || isTerminal(found.status))) return { kind: "answered", recorded: false };

    await withOrg({ orgId: found.orgId, role: "reporter" }, async (tx) => {
      // transition() locks the case row and re-plans on its fresh state, so a second (stale) answer fails here.
      await transition(tx, found.orgId, found.caseId, retestAction(answer, comment), { kind: "reporter", via: "receipt_code" });
      // The opt-out event has no comment field. If the person wrote something anyway, keep it as a note (layer-1
      // scrubbed first: free text never enters the log unredacted).
      if (answer === "opt_out" && comment) {
        await appendCaseEvent(tx, {
          orgId: found.orgId,
          caseId: found.caseId,
          type: "note_added",
          actorKind: "reporter",
          actorId: null,
          payload: { via: "receipt_code", note: redactLayer1(comment) },
        });
      }
    });
    return { kind: "answered", recorded: true };
  } catch (err) {
    if (err instanceof TransitionError) return { kind: "already_answered" };
    console.error(`[retest] could not save a re-test answer (${err instanceof Error ? err.name : "UnknownError"})`);
    return { kind: "failed" };
  }
}
