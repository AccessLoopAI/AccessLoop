// Short case text for staff tables (the inbox and My work), and the acknowledgement line of the case page.
// Client-safe. Callers check caseTextVisible() (lib/cases/visibility.ts) BEFORE showing any of the text here.
import type { cases } from "@/db/schema";
import { SUMMARY_SOURCE_SHORT_LABELS } from "@/lib/cases/labels";
import { ACK_CHANNEL_WORDS } from "@/lib/cases/history";
import { isIsoDate, zonedNoon } from "@/lib/dates";

type CaseRow = typeof cases.$inferSelect;

const EXCERPT = 160;

export function excerpt(text: string, max = EXCERPT): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The text a table row shows for a case, and where it came from. "Keep my words only": the reporter rejected
 * the AI summary, so their (redacted) words are shown, never the rejected summary (docs/decisions.md).
 */
export function caseSummaryCell(c: Pick<CaseRow, "summary" | "summarySource" | "aiSummary" | "redactedText">): {
  text: string;
  source: string | null;
} {
  const ownWords = c.summarySource === "reporter_words";
  const summary = ownWords ? null : (c.summary ?? c.aiSummary);
  const source = ownWords
    ? SUMMARY_SOURCE_SHORT_LABELS.reporter_words
    : c.summary
      ? c.summarySource
        ? SUMMARY_SOURCE_SHORT_LABELS[c.summarySource]
        : null
      : c.aiSummary
        ? "AI summary"
        : "Redacted report text";
  return { text: excerpt(summary ?? c.redactedText), source };
}

export type AcknowledgementLine =
  | { kind: "screen"; at: Date }
  /**
   * `at`: the day it was given (a staff record's typed date, else the record's time). `recordedAt`: when the record
   * was written. `givenOn`: the typed date (YYYY-MM-DD), null when nobody typed one (AccessLoop's own email).
   */
  | { kind: "manual"; channelWords: string | null; at: Date; recordedAt: Date; givenOn: string | null }
  | { kind: "anonymous" }
  | { kind: "missing" };

/**
 * ACR s.9(4): acknowledgement "in the same means by which it is received", unless the feedback is anonymous.
 * A web report is acknowledged by the on-screen receipt (an ack_recorded {channel:"web_screen"} event); other
 * channels by a recorded acknowledgement (staff, or an email). The latest acknowledgement wins. A staff-recorded
 * acknowledgement carries the day it was given (`on`, YYYY-MM-DD), which may be before the day it was recorded:
 * the case page shows both (Phase 7, acknowledgement honesty).
 */
export function acknowledgementLine(
  c: Pick<CaseRow, "intakeChannel" | "isAnonymous">,
  acks: { payload: Record<string, unknown>; createdAt: Date }[],
): AcknowledgementLine {
  const last = acks[acks.length - 1];
  if (last) {
    const channel = String(last.payload.channel ?? "");
    if (channel === "web_screen") return { kind: "screen", at: last.createdAt };
    const on = last.payload.on;
    const givenOn = typeof on === "string" && isIsoDate(on) ? on : null;
    const at = givenOn ? zonedNoon(givenOn) : last.createdAt;
    return { kind: "manual", channelWords: ACK_CHANNEL_WORDS[channel] ?? null, at, recordedAt: last.createdAt, givenOn };
  }
  if (c.isAnonymous && c.intakeChannel !== "web") return { kind: "anonymous" };
  return { kind: "missing" };
}
