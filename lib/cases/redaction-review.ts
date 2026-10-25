// Layer 3 of the redaction pipeline (docs/domain.md §5): the lead's review on the case page. Pure functions, run
// on the server only (the page and its server actions); the browser never gets the original text or an offset it
// could send back. The lead's choices come back as INDICES into the stored `redaction_proposed` spans plus the
// exact words they added, and the final spans are re-derived here from the original text every time.
import { z } from "zod";
import { coverSpans } from "@/lib/intake/redact";
import { applyRedaction, spansFromValues, type PiiType, type Span } from "@/lib/redaction/patterns";
import { PII_TYPES, type AddedWords, type ReviewItem, type ReviewView } from "./redaction-labels";

const StoredSpan = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
  type: z.enum(PII_TYPES),
  source: z.enum(["pattern", "llm", "human"]),
});

/**
 * The spans of a `redaction_proposed` (or `redaction_approved`) payload, in their stored order. Anything that
 * isn't a well-formed span inside the text is dropped, so a bad row can never make the page throw.
 */
export function parseSpans(payloadSpans: unknown, textLength: number): Span[] {
  if (!Array.isArray(payloadSpans)) return [];
  const out: Span[] = [];
  for (const s of payloadSpans) {
    const parsed = StoredSpan.safeParse(s);
    if (parsed.success && parsed.data.end > parsed.data.start && parsed.data.end <= textLength) out.push(parsed.data);
  }
  return out;
}

/** How many characters of redacted text to show on each side of a token. */
export const CONTEXT_CHARS = 48;

/**
 * Added words as spansFromValues matches them: trimmed, otherwise exact (a line break inside the words must be
 * in the report too). Words shorter than 2 characters or containing "[" are never matched.
 */
export function cleanWords(text: string): string {
  return text.trim();
}

export function usableWords(text: string): boolean {
  const v = cleanWords(text);
  return v.length >= 2 && !v.includes("[");
}

/** Every place the words appear in `raw`, as human spans. Whitespace inside the words must match exactly. */
function wordSpans(raw: string, w: AddedWords): Span[] {
  return spansFromValues(raw, [{ text: cleanWords(w.text), type: w.type }], "human");
}

/** Hide every occurrence of the given values in `text` (the summaries and the "Where exactly?" detail). */
export function redactValues(text: string, values: { text: string; type: PiiType }[]): string {
  const spans = coverSpans(spansFromValues(text, values, "human"));
  return spans.length ? applyRedaction(text, spans) : text;
}

/** Count how often the words appear in a piece of (already redacted) text. */
function occurrences(text: string | null, w: AddedWords): number {
  return text ? spansFromValues(text, [{ text: cleanWords(w.text), type: w.type }], "human").length : 0;
}

interface Rendered {
  text: string;
  /** The output range of the token that covers each merged span. */
  tokens: { start: number; end: number; outStart: number; outEnd: number; token: string }[];
}

/** applyRedaction over non-overlapping spans, remembering where each token landed in the output. */
function render(raw: string, merged: Span[]): Rendered {
  let text = "";
  let i = 0;
  const tokens: Rendered["tokens"] = [];
  for (const m of merged) {
    text += raw.slice(i, m.start);
    const token = `[${m.type}]`;
    tokens.push({ start: m.start, end: m.end, outStart: text.length, outEnd: text.length + token.length, token });
    text += token;
    i = m.end;
  }
  return { text: text + raw.slice(i), tokens };
}

/** Redacted text around a token, cut at a space so no token is split. */
function context(out: string, outStart: number, outEnd: number): { before: string; after: string } {
  let before = out.slice(Math.max(0, outStart - CONTEXT_CHARS), outStart);
  if (outStart - CONTEXT_CHARS > 0) {
    const cut = before.indexOf(" ");
    before = "…" + (cut >= 0 ? before.slice(cut + 1) : before);
  }
  let after = out.slice(outEnd, outEnd + CONTEXT_CHARS);
  if (outEnd + CONTEXT_CHARS < out.length) {
    const cut = after.lastIndexOf(" ");
    after = (cut > 0 ? after.slice(0, cut) : after) + "…";
  }
  return { before, after };
}

export interface OtherTexts {
  summary: string | null;
  aiSummary: string | null;
  locationDetail: string | null;
}

/** The values a set of spans hides in `raw`, plus words the lead typed (they may only appear in the summary). */
function hiddenValues(raw: string, spans: Span[], added: AddedWords[]): { text: string; type: PiiType }[] {
  return [
    ...spans.map((s) => ({ text: raw.slice(s.start, s.end), type: s.type })),
    ...added.map((w) => ({ text: cleanWords(w.text), type: w.type })),
  ];
}

/**
 * What the review region shows: the report and the other texts with EVERY proposed span and every added word
 * hidden (whether or not "Keep hidden" is ticked: the region never shows a hidden value), and one item per
 * span or per added words with its redacted surroundings.
 */
export function buildReview(raw: string, proposed: Span[], added: AddedWords[], others: OtherTexts): ReviewView {
  const addedSpans = added.map((w) => wordSpans(raw, w));
  const merged = coverSpans([...proposed, ...addedSpans.flat()]);
  const out = render(raw, merged);
  const tokenAt = (start: number) => out.tokens.find((t) => t.start <= start && start < t.end);

  const items: ReviewItem[] = [];
  proposed.forEach((p, index) => {
    const t = tokenAt(p.start);
    const ctx = t ? context(out.text, t.outStart, t.outEnd) : { before: "", after: "" };
    items.push({ key: `p:${index}`, kind: "proposed", index, type: p.type, source: p.source, token: t?.token ?? `[${p.type}]`,
      ...ctx, places: 1, inReport: true });
  });
  added.forEach((w, index) => {
    const spans = addedSpans[index];
    const first = spans[0] ? tokenAt(spans[0].start) : undefined;
    const ctx = first ? context(out.text, first.outStart, first.outEnd) : { before: "", after: "" };
    const elsewhere = occurrences(others.summary, w) + occurrences(others.aiSummary, w) + occurrences(others.locationDetail, w);
    items.push({ key: `a:${index}`, kind: "added", index, type: w.type, source: "human", token: first?.token ?? `[${w.type}]`,
      ...ctx, places: spans.length + elsewhere, inReport: spans.length > 0 });
  });

  const values = hiddenValues(raw, [...proposed, ...addedSpans.flat()], added);
  const other = (t: string | null) => (t === null ? null : redactValues(t, values));
  return { text: out.text, summary: other(others.summary), aiSummary: other(others.aiSummary),
    locationDetail: other(others.locationDetail), items };
}

/** True when the words appear in the report or in one of the other texts (else: WORDS_NOT_FOUND). */
export function wordsFound(raw: string, w: AddedWords, others: OtherTexts): boolean {
  return wordSpans(raw, w).length + occurrences(others.summary, w) + occurrences(others.aiSummary, w) +
    occurrences(others.locationDetail, w) > 0;
}

export interface Approval {
  /** The final spans over the original text: the kept proposed spans plus the lead's words, unioned. */
  spans: Span[];
  redactedText: string;
  summary: string | null;
  aiSummary: string | null;
  locationDetail: string | null;
  counts: { kept: number; removed: number; added: number };
}

export type ApprovalProblem = { problem: "bad_index" } | { problem: "words_not_found"; index: number };

/**
 * The lead pressed "Approve redaction". `keep` are indices into `proposed` (anything else is refused);
 * `added` are the exact words they asked to hide, each of which must still be found somewhere.
 */
export function finalizeApproval(
  raw: string, proposed: Span[], keep: number[], added: AddedWords[], others: OtherTexts,
): Approval | ApprovalProblem {
  const keepSet = new Set(keep);
  if ([...keepSet].some((i) => !Number.isInteger(i) || i < 0 || i >= proposed.length)) return { problem: "bad_index" };
  const missing = added.findIndex((w) => !usableWords(w.text) || !wordsFound(raw, w, others));
  if (missing >= 0) return { problem: "words_not_found", index: missing };

  const kept = proposed.filter((_, i) => keepSet.has(i));
  const human = added.flatMap((w) => wordSpans(raw, w));
  const spans = coverSpans([...kept, ...human]);
  const values = hiddenValues(raw, spans, added);
  const other = (t: string | null) => (t === null ? null : redactValues(t, values));
  return {
    spans,
    redactedText: applyRedaction(raw, spans),
    summary: other(others.summary),
    aiSummary: other(others.aiSummary),
    locationDetail: other(others.locationDetail),
    counts: { kept: kept.length, removed: proposed.length - kept.length, added: added.length },
  };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does staff text (a public summary, a close note, a reopen reason, the lead's fix description) bring back a
 * value the redaction hides in the original? `hidden` are the approved spans (or, before approval, the proposed
 * ones). A match is the exact value anywhere (as spansFromValues finds it), OR the value as whole words in any
 * letter case and spacing ("DANIEL  okafor"), so retyping a name differently does not slip through. Whole words
 * keep a short hidden name ("Ed") from refusing ordinary words ("fixed").
 */
export function containsHiddenValue(text: string, raw: string, hidden: Span[]): boolean {
  const values = hidden.map((s) => ({ text: raw.slice(s.start, s.end), type: s.type }));
  if (spansFromValues(text, values, "human").length > 0) return true;
  return values.some(({ text: value }) => {
    const words = value.trim().split(/\s+/).filter(Boolean);
    if (words.join(" ").length < 2) return false;
    const pattern = words.map(escapeRegExp).join("\\s+");
    return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(text);
  });
}
