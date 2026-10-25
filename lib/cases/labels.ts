// Plain-words labels for case fields shown to staff. Status labels live in lib/status.ts and priority-area
// headings in lib/report/headings.ts (AREA_HEADINGS); this file covers the rest.
import type { cases } from "@/db/schema";

type CaseRow = typeof cases.$inferSelect;

/** Where it happened (the reporter's step 2 options, domain §4), in staff wording. */
export const LOCATION_KIND_LABELS: Record<CaseRow["locationKind"], string> = {
  digital: "Website or app",
  place: "At a place",
  phone_or_service: "Phone or service",
  document: "Document",
  other: "Somewhere else",
};

/** How the feedback reached the org (ACR s.9(3)). */
export const INTAKE_CHANNEL_LABELS: Record<CaseRow["intakeChannel"], string> = {
  web: "Web form",
  email: "Email",
  phone: "Phone",
  mail: "Mail",
  in_person: "In person",
  other: "Other",
};

/** Who wrote the summary staff see (cases.summarySource, domain §6). */
export const SUMMARY_SOURCE_LABELS: Record<NonNullable<CaseRow["summarySource"]>, string> = {
  ai_confirmed: "AI summary, confirmed by the reporter",
  ai_edited: "AI summary, edited by the reporter",
  reporter_words: "The reporter's own words",
  staff: "AI summary of feedback logged by staff (the person did not review it)",
};

/** The same, short enough for a table cell (the inbox). */
export const SUMMARY_SOURCE_SHORT_LABELS: Record<NonNullable<CaseRow["summarySource"]>, string> = {
  ai_confirmed: "AI summary, confirmed",
  ai_edited: "AI summary, edited by the reporter",
  reporter_words: "Reporter's own words",
  staff: "AI summary, logged by staff",
};

/** Why a lead closed a case without a fix (domain §3), in staff wording. Reporters see lib/status.ts wording. */
export const CLOSED_REASON_STAFF_LABELS: Record<NonNullable<CaseRow["closedReason"]>, string> = {
  duplicate: "Duplicate of another case",
  out_of_scope: "Out of scope for this organization",
  spam: "Not feedback about a barrier",
  no_action_possible: "No action possible",
};

/** Case refs look like BAR-0017. Anything else can't be a case, so pages 404 without a query. */
export const CASE_REF = /^BAR-\d{4,6}$/;
