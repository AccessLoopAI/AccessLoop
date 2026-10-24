// The dashboard's report-readiness card (docs/domain.md §10 item 5): for the newest report of the dashboard's period,
// its state and its heading checks, in the same words as the report page's "Report checks" region. The checks are
// re-run here with reportChecks (the frozen checkProgressReport over the stored content and the lead's text, with the
// settings frozen in the draft), exactly as /app/reports/[id] runs them, so the two pages can never disagree. No case
// number is computed here (those are lib/metrics'). Pure and client-safe.
import { reportChecks } from "./compose";
import type { ReportContent } from "./types";
import { checksSummary, checksView, reportState, toWriteLine, type ReportState } from "./view";

export interface ReportReadiness {
  state: ReportState;
  /** Every required check passes and no sentence blocks sign-off: the checklist's "All required checks pass". */
  ok: boolean;
  /** "All required checks pass" / "2 required checks fail" (the first line of "Report checks"). */
  summary: string;
  /** Parts the lead still has to write (plan areas and Consultations). */
  toWrite: number;
  /** "7 parts still need your text" / "Every part has its text". */
  toWriteLine: string;
  /** Sentences without sources or refused by the sentence checks (they block sign-off and export). */
  blockers: number;
  canSignOff: boolean;
  /** One plain sentence: where the report stands and what comes next. */
  next: string;
}

export interface ReadinessInput {
  status: string;
  publishedAt: Date | string | null;
  content: ReportContent;
  areaText: Readonly<Record<string, string>> | null;
  consultationsText: string | null;
}

export function reportReadiness(r: ReadinessInput): ReportReadiness {
  const live = reportChecks(r.content, r.areaText ?? {}, r.consultationsText);
  const view = checksView(live.results, []);
  const blockers = live.blockers.length;
  const state = reportState(r);
  return {
    state,
    ok: live.passes && blockers === 0,
    summary: checksSummary(view, blockers),
    toWrite: live.toWrite,
    toWriteLine: toWriteLine(live.toWrite),
    blockers,
    canSignOff: live.canSignOff,
    next: nextStep(state, live.passes, live.toWrite, blockers),
  };
}

function nextStep(state: ReportState, passes: boolean, toWrite: number, blockers: number): string {
  if (state === "published") return "Published on your public page.";
  if (state === "signed_off") return "Signed off, not published yet.";
  // A blocker is a sentence with no sources or one the sentence checks refused (exportBlockers): the report page's words.
  if (blockers > 0) return "A sentence has no sources or did not pass the sentence checks, so this draft can't be signed off. Build a new one.";
  if (!passes) return "Fix the required checks before sign-off.";
  if (toWrite > 0) return "Write the missing parts, then sign off.";
  return "Ready for sign-off.";
}
