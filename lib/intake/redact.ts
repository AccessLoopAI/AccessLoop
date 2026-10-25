// The server-side redaction pipeline for intake (docs/domain.md §5). Fail-closed: if the AI layer fails,
// layer 1 is kept and the case is flagged for manual redaction; it never waits for or depends on AI.
//   1. layer 1: detectPatterns() on the RAW text (deterministic)
//   2. layer 2: flagPii() on the layer-1 MASKED text; its exact substrings are mapped back onto the RAW text
//   3. layer 3: the lead's approval on the case page (Phase 2, Slice B)
import { flagPiiOrFallback, isAiError, type AiContext, type PiiItem } from "@/lib/ai";
import { applyRedaction, detectPatterns, spansFromValues, type Span } from "@/lib/redaction/patterns";

export interface Redaction {
  /** The raw text with every span replaced by "[TYPE]". The only text staff work from. */
  redactedText: string;
  /** Merged spans over the RAW text (offsets and types are logged; values never). */
  spans: Span[];
  /**
   * Layer 2's answer: the exact substrings it flagged. null = layer 2 did not run (AI opt-out) or failed;
   * either way a person must look for names by hand.
   */
  piiItems: PiiItem[] | null;
  /** True when layer 2 did not cover this text, so human review must look for names itself. */
  needsManualRedaction: boolean;
}

/**
 * Combine layer-1 and layer-2 spans so that EVERY character either layer flagged stays hidden. Overlapping
 * spans become one span covering both (typed after the longer one). The frozen mergeSpans() keeps only the
 * longer of two overlapping spans, which would leave the rest of a shorter layer-2 value in clear text
 * (e.g. "Call 416" flagged by layer 2 over the layer-1 phone "416-555-0142" kept "Call " visible).
 */
export function coverSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      const longer = s.end - s.start > last.end - last.start ? s : last;
      out[out.length - 1] = { start: last.start, end: Math.max(last.end, s.end), type: longer.type, source: longer.source };
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

/** Layer 1 only: the deterministic patterns. Also used for any free text going into an event payload. */
export function redactLayer1(text: string): string {
  return applyRedaction(text, detectPatterns(text));
}

/**
 * Layers 1 and 2 with layer-2 values that are already known (from this request, or from a preview token
 * this server signed). Pure and deterministic: the same raw text and items always give the same result.
 */
export function redactWithItems(raw: string, piiItems: PiiItem[] | null): Redaction {
  const layer1 = detectPatterns(raw);
  const llm = piiItems ? spansFromValues(raw, piiItems, "llm") : [];
  const spans = coverSpans([...layer1, ...llm]);
  return { redactedText: applyRedaction(raw, spans), spans, piiItems, needsManualRedaction: piiItems === null };
}

/**
 * The full pipeline on one piece of reporter text. With aiOptOut, layer 2 is skipped (no AI call at all).
 * If flagPii fails (backend not usable, refused, timed out, past the deadline, bad output), the shared fallback
 * applies: layer 1 is kept and needsManualRedaction is set. `ai` says who is asking (lib/ai/context.ts; claude-cli
 * needs it); `deadline` (Date.now() ms) is when the caller stops waiting (lib/intake/pipeline.ts runIntakeAi).
 */
export async function redact(
  raw: string,
  { aiOptOut, ai, deadline }: { aiOptOut: boolean; ai?: AiContext; deadline?: number },
): Promise<Redaction> {
  if (aiOptOut) return redactWithItems(raw, null);
  const masked = redactLayer1(raw);
  const found = await flagPiiOrFallback(masked, ai, logAiFailure, deadline !== undefined ? { deadline } : undefined);
  return redactWithItems(raw, found ? found.value.items : null);
}

/** Never logs report text: only the error's class, plus the message of our own (text-free) AI error types. */
export function logAiFailure(fn: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  console.error(`[intake] ${fn} failed (${name})${isAiError(err) ? `: ${err.message}` : ""}`);
}
