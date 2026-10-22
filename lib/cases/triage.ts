// Helpers for the case page's forms (triage, assign, close, log fix). Client-safe: pure functions and labels.
import { ABSTAIN_THRESHOLD } from "@/eval/score";
import { detectPatterns } from "@/lib/redaction/patterns";
import { AREA_HEADINGS, PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";
import { CLOSED_REASON_STAFF_LABELS } from "@/lib/cases/labels";
import { CLOSED_REASONS } from "@/lib/status";

/** The "Priority area" options: the 7 keys as values, the domain §1.2 heading names as labels. */
export const AREA_OPTIONS = PRIORITY_AREAS.map((value) => ({ value, label: AREA_HEADINGS[value].canonical }));

export function isPriorityArea(value: unknown): value is PriorityArea {
  return typeof value === "string" && (PRIORITY_AREAS as readonly string[]).includes(value);
}

/**
 * The AI's suggestion to pre-select: the valid area with the highest confidence (the first one on a tie), or
 * null when there is none. The lead always confirms it (domain §6: AI output never changes case state).
 */
export function topAiArea(areas: unknown): PriorityArea | null {
  if (!Array.isArray(areas)) return null;
  let best: { area: PriorityArea; confidence: number } | null = null;
  for (const a of areas) {
    const area = (a as { area?: unknown } | null)?.area;
    const confidence = (a as { confidence?: unknown } | null)?.confidence;
    if (!isPriorityArea(area) || typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    if (!best || confidence > best.confidence) best = { area, confidence };
  }
  return best?.area ?? null;
}

export type ConfidenceWord = "high" | "medium" | "low";

/** From this confidence up the AI's area reads "high confidence". */
export const HIGH_CONFIDENCE = 0.8;

/**
 * The AI's confidence in plain words: high (0.8 and up), medium (from the eval's ABSTAIN_THRESHOLD, 0.5, up to 0.8),
 * low (below 0.5: the eval counts that as the AI abstaining, so the triage form does not pre-select it).
 */
export function confidenceWord(confidence: number): ConfidenceWord {
  if (confidence >= HIGH_CONFIDENCE) return "high";
  if (confidence >= ABSTAIN_THRESHOLD) return "medium";
  return "low";
}

/**
 * What structure() may say it is unsure about (lib/ai/prompts/structure.md "uncertain"), in staff words. Only these
 * fixed words are ever shown: an answer outside them is shown as one generic line, never as the model's own text.
 */
export const UNCERTAIN_LABELS: Readonly<Record<string, string>> = {
  priorityArea: "Which area fits: no area clearly fits, or the report is too vague",
  location: "Where it happened",
  summary: "What the report says: it is hard to understand, for example broken dictation",
};
export const UNCERTAIN_OTHER = "Something else it did not name";

export interface AiAreaSuggestion {
  area: PriorityArea;
  /** The domain §1.2 heading name of the area. */
  label: string;
  confidence: number;
  word: ConfidenceWord;
  /** Pre-select it in the triage form: only when confidence >= ABSTAIN_THRESHOLD (0.5). The lead always confirms. */
  preselect: boolean;
  /** The AI's "uncertain" list in staff words (UNCERTAIN_LABELS), each once. */
  uncertain: string[];
}

/**
 * The AI suggestion the triage form shows (domain §6): the top area (topAiArea) with its confidence as a word, whether
 * to pre-select it, and what the AI was unsure about. null when the AI gave no valid area (no AI result, or AI opt-out).
 */
export function aiSuggestion(areas: unknown, uncertain: unknown): AiAreaSuggestion | null {
  const area = topAiArea(areas);
  if (!area) return null;
  let confidence = 0;
  for (const a of areas as { area?: unknown; confidence?: unknown }[]) {
    if (a?.area === area && typeof a.confidence === "number" && Number.isFinite(a.confidence)) {
      confidence = Math.max(confidence, Math.min(1, Math.max(0, a.confidence)));
    }
  }
  const words = new Set<string>();
  if (Array.isArray(uncertain)) {
    for (const u of uncertain) {
      if (typeof u !== "string" || !u.trim()) continue;
      words.add(Object.hasOwn(UNCERTAIN_LABELS, u.trim()) ? UNCERTAIN_LABELS[u.trim()] : UNCERTAIN_OTHER);
    }
  }
  return {
    area,
    label: AREA_HEADINGS[area].canonical,
    confidence,
    word: confidenceWord(confidence),
    preselect: confidence >= ABSTAIN_THRESHOLD,
    uncertain: [...words],
  };
}

/** "Reason for closing" options, in staff words (domain §3 closedReason). */
export const CLOSE_REASON_OPTIONS = CLOSED_REASONS.map((value) => ({ value, label: CLOSED_REASON_STAFF_LABELS[value] }));

export const PUBLIC_SUMMARY_MAX = 400;
export const FIX_DESCRIPTION_MAX = 2000;
export const NOTE_MAX = 1000;
export const EVIDENCE_URL_MAX = 2000;

export type EvidenceUrlCheck = { ok: true; url: string | undefined } | { ok: false; error: string };

export const EVIDENCE_URL_ERRORS = {
  format: "Enter a full link that starts with https:// or http://, or leave it empty.",
  tooLong: `Keep the link under ${EVIDENCE_URL_MAX.toLocaleString("en-CA")} characters.`,
  personal: "This link may carry personal details (an email, a number, or a code after \"?\"). Use a link without them.",
} as const;

/**
 * "Link to evidence (optional)": empty, or an http/https URL. It goes into the append-only fix_logged payload
 * as it is (transition() scrubs only the description), so a link that layer 1 would redact (an email, a phone
 * number, a URL with a query string) is refused instead of stored.
 */
export function checkEvidenceUrl(input: string): EvidenceUrlCheck {
  const value = input.trim();
  if (!value) return { ok: true, url: undefined };
  if (value.length > EVIDENCE_URL_MAX) return { ok: false, error: EVIDENCE_URL_ERRORS.tooLong };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: EVIDENCE_URL_ERRORS.format };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) {
    return { ok: false, error: EVIDENCE_URL_ERRORS.format };
  }
  if (detectPatterns(value).length > 0 || detectPatterns(url.href).length > 0) return { ok: false, error: EVIDENCE_URL_ERRORS.personal };
  return { ok: true, url: url.href };
}
