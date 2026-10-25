// Case status labels, exactly as docs/domain.md section 3. The e2e tests assert the staff strings
// (inside data-testid="case-status"), so never reword them here without changing domain.md first.
import type { CaseStatus as SchemaCaseStatus } from "@/lib/state-machine";

export const CASE_STATUSES = [
  "new",
  "triaged",
  "assigned",
  "retest_open",
  "verified",
  "fixed_unverified",
  "closed",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

// Compile-time guard: this list and the DB enum (db/schema.ts via lib/state-machine.ts) must match exactly.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type StatusListMatchesSchema = Same<CaseStatus, SchemaCaseStatus> extends true ? true : never;
const statusListMatchesSchema: StatusListMatchesSchema = true;
void statusListMatchesSchema;

export const CLOSED_REASONS = ["duplicate", "out_of_scope", "spam", "no_action_possible"] as const;
export type ClosedReason = (typeof CLOSED_REASONS)[number];

/** Staff wording (domain §3, "Staff label"). */
export const STAFF_STATUS_LABELS: Record<CaseStatus, string> = {
  new: "New",
  triaged: "Triaged",
  assigned: "Assigned",
  retest_open: "Waiting for the reporter to check",
  verified: "Verified by reporter",
  fixed_unverified: "Fixed, not verified by reporter",
  closed: "Closed",
};

/**
 * Reporter wording on /r/[code] (domain §3, "Reporter sees"). For `closed` the reporter sees
 * "Closed: {reason in plain words}"; use reporterStatusLabel(status, closedReason) to get it.
 * The plain "Closed" here is only the fallback when the reason is unknown.
 */
export const REPORTER_STATUS_LABELS: Record<CaseStatus, string> = {
  new: "We got your report",
  triaged: "A team is looking at it",
  assigned: "Someone is working on a fix",
  retest_open: "Please tell us if it works now",
  verified: "Fixed and confirmed by you",
  fixed_unverified: "Fixed (not checked by you)",
  closed: "Closed",
};

/** The closing reason in plain words for reporters (grade 6-8 reading level). */
export const CLOSED_REASON_PLAIN: Record<ClosedReason, string> = {
  duplicate: "someone already reported this",
  out_of_scope: "this organization is not in charge of it",
  spam: "it was not a report about a barrier",
  no_action_possible: "the team could not find a way to change it",
};

export function isClosedReason(value: unknown): value is ClosedReason {
  return typeof value === "string" && (CLOSED_REASONS as readonly string[]).includes(value);
}

/** "Closed: {reason in plain words}", or "Closed" when the reason is missing or unknown. */
export function reporterClosedLabel(reason: string | null | undefined): string {
  return isClosedReason(reason) ? `Closed: ${CLOSED_REASON_PLAIN[reason]}` : REPORTER_STATUS_LABELS.closed;
}

export function staffStatusLabel(status: CaseStatus): string {
  return STAFF_STATUS_LABELS[status];
}

export function reporterStatusLabel(status: CaseStatus, closedReason?: string | null): string {
  return status === "closed" ? reporterClosedLabel(closedReason) : REPORTER_STATUS_LABELS[status];
}
