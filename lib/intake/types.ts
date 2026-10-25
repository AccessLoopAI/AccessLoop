// Shapes and limits shared by the reporter flow's client component and its server actions.
// Client-safe: types and constants only, no server imports.

/** Step 2 answers (domain §4) mapped to `location_kind`. The labels are the radios' exact names (e2e). */
export const LOCATION_OPTIONS = [
  { value: "digital", label: "On a website or app", hint: "For example, online banking, an app or a booking page." },
  { value: "place", label: "At a place", hint: "For example, a branch, an entrance, a ramp or a washroom." },
  { value: "phone_or_service", label: "On the phone or at a service", hint: "For example, a phone line or a service counter." },
  { value: "document", label: "In a document", hint: "For example, a form, a letter or a PDF." },
  { value: "other", label: "Somewhere else", hint: "Anything else, like a rule or the way you were treated." },
] as const;

export type LocationKindValue = (typeof LOCATION_OPTIONS)[number]["value"];
export const LOCATION_KINDS = LOCATION_OPTIONS.map((o) => o.value) as [LocationKindValue, ...LocationKindValue[]];

/**
 * Step 3, ONE question "How can we follow up?" (domain §4; Phase 7 T4.2). The labels are the radios' exact names
 * (e2e/demo.spec.ts). The two anonymous answers come first; the email field appears only under the third.
 */
export const FOLLOW_UP_OPTIONS = [
  { value: "none", label: "Don't contact me", wantsRetest: false, emailChoice: "anonymous" },
  { value: "code", label: "Let me check the fix with my code", wantsRetest: true, emailChoice: "anonymous" },
  { value: "email", label: "Email me, and let me check the fix", wantsRetest: true, emailChoice: "email" },
] as const;

export type FollowUpValue = (typeof FOLLOW_UP_OPTIONS)[number]["value"];
export const FOLLOW_UP_VALUES = FOLLOW_UP_OPTIONS.map((o) => o.value) as [FollowUpValue, ...FollowUpValue[]];

/** What the server is sent for an answer (the submit action's fields stay `wantsRetest` and `emailChoice`). */
export function followUpChoice(value: FollowUpValue): { wantsRetest: boolean; emailChoice: "anonymous" | "email" } {
  const o = FOLLOW_UP_OPTIONS.find((x) => x.value === value)!;
  return { wantsRetest: o.wantsRetest, emailChoice: o.emailChoice };
}

/** How the reporter answered "We understood" (stored in cases.summarySource). */
export const SUMMARY_CHOICES = ["ai_confirmed", "ai_edited", "reporter_words"] as const;
export type SummaryChoice = (typeof SUMMARY_CHOICES)[number];

export const TEXT_MAX = 6000;
export const DETAIL_MAX = 300;
export const EMAIL_MAX = 254;
export const EDITED_SUMMARY_MAX = 600;

/** Input of the preview action (step 3 "Next"). */
export interface PreviewRequest {
  text: string;
  locationKind: LocationKindValue;
  locationDetail: string;
  aiOptOut: boolean;
}

/**
 * What the browser gets back: the summary to show and a sealed token. Never the suggested areas.
 * `rateLimited`: too many previews from this connection (lib/rate-limit.ts); the form stays on step 3.
 * `aiPaused`: the hour's AI budget is spent (lib/rate-limit.ts), so no AI ran and there is no token: the report
 * takes the manual path, and the review says why in plain words (AI_PAUSED_MESSAGE).
 */
export type PreviewResponse =
  | { ok: true; summary: string | null; token: string | null; aiPaused?: boolean }
  | { ok: false; rateLimited?: boolean };

/** Input of the submit action ("Send report"). */
export interface SubmitRequest {
  text: string;
  locationKind: LocationKindValue;
  locationDetail: string;
  wantsRetest: boolean;
  emailChoice: "anonymous" | "email";
  email: string;
  aiOptOut: boolean;
  choice: SummaryChoice | null;
  editedSummary: string;
  token: string | null;
}

/** Only returned when sending failed; on success the action redirects to the receipt. */
export type SubmitState = { ok: false; error: string; at: number } | null;

/** Same rule on both sides: a plain, single address with a dot in the domain. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
