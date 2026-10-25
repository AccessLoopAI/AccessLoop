// The report form's draft, autosaved in this browser (docs/domain.md §4). Client-safe.
// Where it is kept: by default in sessionStorage (this tab only: it is gone when the tab is closed), or in
// localStorage for up to 7 days when the person ticks "Keep this draft on this device" (Phase 7, T3.10: a shared or
// library computer no longer keeps report text for the next person unless someone asked for that).
// What is kept: the answers the person typed or chose. What is NEVER kept: the email address (only the choice of
// the email answer), the AI summary, the summary answer and the preview token. Every storage access is wrapped, so
// the form works the same when storage is blocked or full.
import { DETAIL_MAX, FOLLOW_UP_VALUES, LOCATION_KINDS, TEXT_MAX, type FollowUpValue, type LocationKindValue } from "./types";

/** Everything the report form holds for its first three steps (the email included, for the form itself). */
export interface ReportDraft {
  text: string;
  locationKind: LocationKindValue | "";
  locationDetail: string;
  /** Step 3, "How can we follow up?" (lib/intake/types.ts FOLLOW_UP_OPTIONS); "" = not answered yet. */
  followUp: FollowUpValue | "";
  email: string;
  /** "Don't use AI on my report" (chosen on the review step; later previews then never call the AI). */
  aiOptOut: boolean;
}

export const EMPTY_DRAFT: ReportDraft = {
  text: "",
  locationKind: "",
  locationDetail: "",
  followUp: "", // no answer is chosen for the person; both anonymous answers come first (ACR s.9(2))
  email: "",
  aiOptOut: false,
};

/** What goes into storage: the draft minus the email address. */
export type StoredDraft = Omit<ReportDraft, "email">;

/** Where a draft is kept: this tab only (sessionStorage, the default) or this device (localStorage, when asked). */
export type DraftPlace = "tab" | "device";

const VERSION = 2;

/** A draft kept on the device that nobody came back to for this long is dropped. */
export const DRAFT_MAX_AGE_MS = 7 * 86_400_000;

/** One draft per organization's form. */
export function draftKey(orgSlug: string): string {
  return `accessloop:report-draft:${orgSlug}`;
}

/** True when the person has answered or typed anything worth keeping. */
export function hasContent(d: Omit<ReportDraft, "email"> & { email?: string }): boolean {
  return Boolean(d.text.trim() || d.locationKind || d.locationDetail.trim() || d.followUp || d.aiOptOut);
}

/** The JSON to store, or null when there is nothing to keep. The email address is never part of it. */
export function serializeDraft(d: ReportDraft, now: number): string | null {
  if (!hasContent(d)) return null;
  const stored: StoredDraft & { v: number; savedAt: number } = {
    v: VERSION,
    savedAt: now,
    text: d.text,
    locationKind: d.locationKind,
    locationDetail: d.locationDetail,
    followUp: d.followUp,
    aiOptOut: d.aiOptOut,
  };
  return JSON.stringify(stored);
}

const LIMIT = { text: TEXT_MAX * 3, detail: DETAIL_MAX * 3 };

/**
 * Version 1 (before Phase 7) kept two step-3 answers. Map them onto the one question; a pair the new question
 * can't say (an email reply without a re-test, or nothing chosen) is asked again.
 */
function followUpFromV1(o: Record<string, unknown>): FollowUpValue | "" {
  const email = o.emailChoice === "email";
  if (o.wantsRetest === "yes") return email ? "email" : "code";
  if (o.wantsRetest === "no" && !email) return "none";
  return "";
}

/** A stored draft, checked field by field; null when it is missing, malformed, from another version or too old. */
export function parseDraft(raw: string | null, now: number): StoredDraft | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if ((o.v !== VERSION && o.v !== 1) || typeof o.savedAt !== "number" || now - o.savedAt > DRAFT_MAX_AGE_MS || o.savedAt > now + 60_000) {
    return null;
  }
  const text = typeof o.text === "string" ? o.text.slice(0, LIMIT.text) : "";
  const locationKind = LOCATION_KINDS.includes(o.locationKind as LocationKindValue) ? (o.locationKind as LocationKindValue) : "";
  const locationDetail = typeof o.locationDetail === "string" ? o.locationDetail.slice(0, LIMIT.detail) : "";
  const followUp =
    o.v === 1 ? followUpFromV1(o) : FOLLOW_UP_VALUES.includes(o.followUp as FollowUpValue) ? (o.followUp as FollowUpValue) : "";
  const aiOptOut = o.aiOptOut === true;
  const draft: StoredDraft = { text, locationKind, locationDetail, followUp, aiOptOut };
  return hasContent(draft) ? draft : null;
}

/** The form's starting values from a stored draft (the email field starts empty). */
export function draftFromStored(s: StoredDraft | null): ReportDraft {
  return s ? { ...s, email: "" } : EMPTY_DRAFT;
}

/**
 * A location poster's place (Phase 7 T4.5, ?loc=) as the starting answer of "Where did it happen?" and "Where
 * exactly?". It never overwrites an answer: a draft that already says where (any answer of step 2) is kept as it is,
 * and "Where exactly?" is filled only when it is empty.
 */
export function withPlace(d: ReportDraft, place: { locationKind: LocationKindValue; locationDetail: string } | null): ReportDraft {
  if (!place || d.locationKind) return d;
  return { ...d, locationKind: place.locationKind, locationDetail: d.locationDetail.trim() ? d.locationDetail : place.locationDetail };
}

/** The same answers in both (every field the form holds), e.g. a form still as "Start over" left it. */
export function sameAnswers(a: ReportDraft, b: ReportDraft): boolean {
  return (
    a.text === b.text &&
    a.locationKind === b.locationKind &&
    a.locationDetail === b.locationDetail &&
    a.followUp === b.followUp &&
    a.email === b.email &&
    a.aiOptOut === b.aiOptOut
  );
}

/* ------------------------------------------------------------------ storage (browser only, never throws) */

function storage(place: DraftPlace): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return place === "device" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // blocked (privacy settings, sandboxed frame)
  }
}

const OTHER: Record<DraftPlace, DraftPlace> = { tab: "device", device: "tab" };

/** The kept draft and where it was kept: this tab first (the fresher one), then this device. */
export function loadDraft(orgSlug: string): { draft: StoredDraft; place: DraftPlace } | null {
  for (const place of ["tab", "device"] as const) {
    try {
      const s = storage(place);
      const draft = parseDraft(s?.getItem(draftKey(orgSlug)) ?? null, Date.now());
      if (draft) return { draft, place };
      s?.removeItem(draftKey(orgSlug)); // nothing usable: don't keep it around
    } catch {
      // Blocked: try the other place.
    }
  }
  return null;
}

/** Save to `place` and forget any copy in the other place (ticking or unticking "Keep this draft" moves it). */
export function saveDraft(orgSlug: string, d: ReportDraft, place: DraftPlace = "tab"): void {
  try {
    storage(OTHER[place])?.removeItem(draftKey(orgSlug));
  } catch {
    // Nothing to do.
  }
  try {
    const s = storage(place);
    if (!s) return;
    const json = serializeDraft(d, Date.now());
    if (json) s.setItem(draftKey(orgSlug), json);
    else s.removeItem(draftKey(orgSlug));
  } catch {
    // Full or blocked: the form keeps working, only the draft isn't kept.
  }
}

/** Forget the draft in both places ("Start over", and once the report is sent). */
export function clearDraft(orgSlug: string): void {
  for (const place of ["tab", "device"] as const) {
    try {
      storage(place)?.removeItem(draftKey(orgSlug));
    } catch {
      // Nothing to do.
    }
  }
}
