// Who may read a case's words (redacted text, AI and reporter summaries, the "Where exactly?" detail)
// before the lead's redaction review (domain §5 layer 3). Layers 1-2 can miss names: with the AI opt-out or a
// failed flagPii only layer 1 ran, and a summary the reporter rewrote never had a layer-2 pass of its own.
// So until the lead approves the redaction, only the lead reads the text; auditors (and, from Slice B,
// owners) see the case's facts (ref, status, channel, dates, area) but not its words. Domain §2: auditors
// read cases "(redacted)"; §5: "Owners never see a case before this approval".
//
// The check is `cases.redactionApprovedAt`, the projection of the `redaction_approved` event. Slice B must set
// it in the same transaction that appends that event (db/seed.ts does), and reuse this helper on owner pages.
// It fails closed: a case closed straight from `new` without an approval stays lead-only.
import type { StaffRole } from "@/lib/auth/staff";

export function caseTextVisible(role: StaffRole, c: { redactionApprovedAt: Date | null }): boolean {
  return role === "lead" || c.redactionApprovedAt !== null;
}

/** Shown in place of the case's words to anyone but the lead before the redaction review. */
export const AWAITING_REDACTION_REVIEW = "Waiting for redaction review. The lead checks it for names first.";
