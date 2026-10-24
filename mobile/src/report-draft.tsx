// The report being written, shared by the four step screens. In memory only: nothing the person types (and never
// the email or the AI summary) is written to the device. Closing the app forgets it; there is no time limit
// while it is open. After "Send report" the words are dropped and only the receipt stays, until "Done".
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { LocationKind, OrgInfo, PreviewResult, SubmitRequest } from "./api";
import type { FollowUp, ReviewChoice } from "./copy";

export interface PreviewState extends PreviewResult {
  /** The AI step gave no summary (not the same as skipping it). */
  failed: boolean;
}

export interface Receipt {
  code: string;
  ref: string;
  orgName: string;
  /** The local id in My reports (src/reports-store.ts), never the code. */
  reportId: string;
  /** Really stored in the secure store (false on the web, or if storing failed). */
  kept: boolean;
  followUp: FollowUp;
}

export interface Draft {
  org: OrgInfo | null;
  /** false = the server couldn't confirm the org (no lookup endpoint); its slug is used as typed. */
  orgConfirmed: boolean;
  /** The QR poster's location, when the report started from one. */
  locationId: string | null;
  text: string;
  locationKind: LocationKind | null;
  locationDetail: string;
  followUp: FollowUp | null;
  email: string;
  /** "Skip the AI summary" on step 3: the AI never sees this report. */
  aiSkipped: boolean;
  preview: PreviewState | null;
  /** What the current preview was made from, so Back then Next with nothing changed doesn't ask the AI again. */
  previewKey: string | null;
  /** A new summary replaced one the person had already answered. */
  summaryRenewed: boolean;
  choice: ReviewChoice | null;
  edited: string;
  receipt: Receipt | null;
}

const EMPTY: Draft = {
  org: null,
  orgConfirmed: false,
  locationId: null,
  text: "",
  locationKind: null,
  locationDetail: "",
  followUp: null,
  email: "",
  aiSkipped: false,
  preview: null,
  previewKey: null,
  summaryRenewed: false,
  choice: null,
  edited: "",
  receipt: null,
};

interface DraftApi {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  /** A fresh report for this org (and the QR poster's place, if any). */
  start: (org: OrgInfo, confirmed: boolean) => void;
  /** After sending: forget the words, keep only the receipt. */
  finish: (receipt: Receipt) => void;
  /** "Done": forget everything. */
  clear: () => void;
}

const DraftContext = createContext<DraftApi | null>(null);

export function ReportDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const start = useCallback((org: OrgInfo, confirmed: boolean) => {
    setDraft((d) => {
      // Same org, same place, words already typed (the person came back to this screen): carry on.
      if (d.org?.slug === org.slug && d.locationId === (org.location?.id ?? null) && d.text && !d.receipt) {
        return { ...d, org, orgConfirmed: confirmed };
      }
      return {
        ...EMPTY,
        org,
        orgConfirmed: confirmed,
        locationId: org.location?.id ?? null,
        locationKind: org.location?.kind ?? null,
        locationDetail: org.location?.name ?? "",
      };
    });
  }, []);
  const finish = useCallback((receipt: Receipt) => setDraft({ ...EMPTY, org: null, receipt }), []);
  const clear = useCallback(() => setDraft(EMPTY), []);
  const value = useMemo(() => ({ draft, update, start, finish, clear }), [draft, update, start, finish, clear]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftApi {
  const api = useContext(DraftContext);
  if (!api) throw new Error("useDraft outside ReportDraftProvider");
  return api;
}

/** The key the preview depends on: the words, the place and the detail (the AI never sees the follow-up). */
export function previewKeyOf(d: Draft): string {
  return JSON.stringify([d.text.trim(), d.locationKind, d.locationDetail.trim()]);
}

/** The summary is there to answer (not skipped, not failed). */
export function hasSummary(d: Draft): boolean {
  return Boolean(!d.aiSkipped && d.preview?.summary);
}

/** "Send report": the body for POST /api/v1/orgs/{slug}/reports, the same rules as the web's sendReport. */
export function submitBody(d: Draft): SubmitRequest {
  const summary = hasSummary(d);
  const aiOptOut = d.aiSkipped || d.choice === "no_ai";
  const choice = summary && d.choice && d.choice !== "no_ai" ? d.choice : "reporter_words";
  return {
    text: d.text.trim(),
    locationKind: d.locationKind ?? "other",
    locationDetail: d.locationDetail.trim(),
    wantsRetest: d.followUp === "code" || d.followUp === "email",
    emailChoice: d.followUp === "email" ? "email" : "anonymous",
    email: d.followUp === "email" ? d.email.trim() : "",
    aiOptOut,
    choice,
    editedSummary: !aiOptOut && summary && d.choice === "ai_edited" ? d.edited.trim() : "",
    token: aiOptOut ? null : (d.preview?.token ?? null),
    ...(d.locationId ? { locationId: d.locationId } : {}),
  };
}
