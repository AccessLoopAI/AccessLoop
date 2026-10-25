// Who may open a case and run each step on it (docs/domain.md §2, §3; CLAUDE.md "Routes"). Pure and client-safe:
// the case page uses it to decide which forms to show, and every server action checks it again before it
// calls the frozen transition() (which enforces the same rules once more).
import type { StaffRole } from "@/lib/auth/staff";
import type { CaseStatus } from "@/lib/status";

export interface CaseViewer {
  role: StaffRole;
  memberId: string;
}

export interface CaseAccessFacts {
  status: CaseStatus;
  assignedTo: string | null;
  /** A `redaction_approved` event exists (cases.redactionApprovedAt is its projection). */
  redactionApproved: boolean;
}

/**
 * Leads and auditors open every case of their org. An owner opens a case only while it is assigned to them;
 * anything else is a 404 (never a 403), so a ref's existence is not confirmed.
 */
export function canOpenCase(v: CaseViewer, c: Pick<CaseAccessFacts, "assignedTo">): boolean {
  if (v.role === "lead" || v.role === "auditor") return true;
  return v.role === "owner" && c.assignedTo !== null && c.assignedTo === v.memberId;
}

export type CaseCommand =
  | "review"
  /** Phase 7 T2: hide a detail the approved redaction missed (lead only, after the approval). */
  | "revise_redaction"
  | "reveal"
  | "triage"
  /** D2: correct the area or public summary of a triaged or assigned case. */
  | "retriage"
  | "assign"
  | "log_fix"
  | "close"
  | "reopen"
  /** D3: stop waiting for a reporter who can't be reached (the page and the state machine check the 14 days). */
  | "stop_waiting"
  /** Acknowledge receipt (ACR s.9(4)): send the email, or record one given by phone, mail, in person. Any status. */
  | "acknowledge"
  /** The one re-test reminder email of a round (domain §3), while the reporter has the question. */
  | "remind"
  /** Phase 7 T2 item 4: an internal note or an interim accommodation (the lead, or the owner it is assigned to). Any status. */
  | "note";

// The statuses lib/state-machine.ts allows each step from (CLOSE_REASONS_BY_STATUS, reopenTarget). This file is
// client-safe, so it can't import the state machine at runtime; tests/case-page.test.ts checks the two agree.
const CLOSABLE: readonly CaseStatus[] = ["new", "triaged", "assigned", "fixed_unverified"];
const REOPENABLE: readonly CaseStatus[] = ["fixed_unverified", "verified", "closed"];

/** May this viewer run this step on this case now? Auditors run nothing (read-only). */
export function canRun(cmd: CaseCommand, v: CaseViewer, c: CaseAccessFacts): boolean {
  if (!canOpenCase(v, c)) return false;
  const lead = v.role === "lead";
  switch (cmd) {
    case "review":
      return lead && !c.redactionApproved;
    case "revise_redaction":
      return lead && c.redactionApproved;
    case "reveal":
      return lead;
    case "triage":
      return lead && c.status === "new" && c.redactionApproved;
    case "retriage":
      return lead && (c.status === "triaged" || c.status === "assigned");
    case "assign":
      return lead && (c.status === "triaged" || c.status === "assigned");
    case "log_fix":
      return c.status === "assigned" && (lead || (v.role === "owner" && c.assignedTo === v.memberId));
    case "close":
      return lead && CLOSABLE.includes(c.status);
    case "reopen":
      return lead && REOPENABLE.includes(c.status);
    case "stop_waiting":
      return lead && c.status === "retest_open";
    case "acknowledge":
      return lead;
    case "remind":
      return lead && c.status === "retest_open";
    case "note":
      return lead || (v.role === "owner" && c.assignedTo === v.memberId);
  }
}
