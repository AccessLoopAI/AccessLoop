// The sentence validator (docs/domain.md §7 step 5). A generated sentence is refused when:
//   - it has no fact IDs, or cites a fact that is not in the snapshot          (no_facts, unknown_fact)
//   - it contains a number that is not among its cited facts' values          (invented_number; the period's years
//     are allowed; digits inside a cited fact's quoted text, e.g. a public summary that says "10 times", are text;
//     numbers written as words count too: "twenty", "twenty-one", "twice", "half", "dozens")
//   - it contains a case reference that is not one of its cited facts' cases  (uncited_case_ref)
//   - it contains placeholders ([ ] { }) or raw text: contact details or other
//     layer-1 personal data (lib/redaction/patterns detectPatterns)            (placeholder, contact_detail)
//   - it drops a slot value of its claim (§7 step 4 "must keep every slot value") (dropped_slot)
//   - against its claim's FILLED template (Phase 7, before real AI rewords anything):
//       its numbers are not in the template's order (two values swapped)       (number_order)
//       it has more than 1.3 times the template's words (an added claim)       (too_long)
//       it has a banned word more often than the template does: compliant, compliance, certified,
//       guarantee(d), fully, every, all, 100%, satisfied, resolved, and the French ones (BANNED_WORDS)
//       (banned_word; with no claim to compare against, any banned word)
//   - it is empty                                                              (empty)
// A refused sentence falls back to its claim's deterministic template. If even the template is refused, the sentence
// is kept but marked `blocked`, which blocks sign-off and export (never an exception: one odd public summary must not
// make a period impossible to report). Only generated (claim) sentences are validated: General comes from the org's
// own settings and carries its address and phone number on purpose. Pure.
import { detectPatterns } from "@/lib/redaction/patterns";
import type { Claim, PhraseClaimsOutput } from "@/lib/ai/schemas";
import { compileClaims, fillTemplate } from "./claims";
import { periodYears } from "./period";
import type { Fact, RejectCode, RejectReason, ReportClaim, ReportContent, ReportSentence, ReportSnapshot } from "./types";

export interface ValidationContext {
  facts: ReadonlyMap<string, Fact>;
  /** caseId -> ref, for the snapshot's cases. */
  refsById: ReadonlyMap<string, string>;
  /** Years a sentence may name without a fact (the period's years). */
  allowedYears: readonly number[];
}

export type ValidationResult = { ok: true } | { ok: false; reasons: RejectReason[] };

/** The validator's view of a snapshot. */
export function validationContext(snapshot: Pick<ReportSnapshot, "facts" | "cases" | "period">): ValidationContext {
  return {
    facts: new Map(snapshot.facts.map((f) => [f.id, f])),
    refsById: new Map(snapshot.cases.map((c) => [c.id, c.ref])),
    allowedYears: periodYears(snapshot.period),
  };
}

/** A case reference however it is written ("bar-0003" is BAR-0003). */
const CASE_REF_G = /\bBAR-\d{4,6}\b/gi;
const NUMBER_G = /\d+(?:[.,]\d+)*/g;
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const SLOT = /\{(\w+)\}/g;

/** Every number written in `text`: "1,234" is 1234; "11,2" is 11 and 2; "24.5" is 24.5. */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(NUMBER_G)) {
    const raw = m[0];
    if (THOUSANDS.test(raw)) out.push(Number(raw.replace(/,/g, "")));
    else for (const part of raw.split(",")) out.push(Number(part));
  }
  return out.filter((n) => Number.isFinite(n));
}

// Numbers written as words count as numbers too (domain §7.5; the phrase prompt says "write 7, not seven"): a phrased
// sentence that says "twenty" or "half" where no cited fact has that value is refused like "20" would be.
const UNIT_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE_WORDS: Readonly<Record<string, number>> = { hundred: 100, thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };
/** Words that state an amount on their own ("twice", "a dozen", "half of them", "hundreds of"). */
const AMOUNT_WORDS: Readonly<Record<string, number>> = {
  twice: 2, thrice: 3, dozen: 12, half: 0.5, dozens: NaN, hundreds: NaN, thousands: NaN, millions: NaN,
};
const NUMBER_WORD = `(?:${[...Object.keys(UNIT_WORDS), ...Object.keys(SCALE_WORDS)].join("|")})`;
// "twenty-one", "two hundred", and "and" only after a scale word ("one hundred and five"), never "ten and eleven".
const NUMBER_WORDS_G = new RegExp(
  `\\b${NUMBER_WORD}(?:(?:[\\s-]+|(?<=(?:${Object.keys(SCALE_WORDS).join("|")}))\\s+and\\s+)${NUMBER_WORD})*\\b`,
  "gi",
);
const AMOUNT_WORDS_G = new RegExp(`\\b(?:${Object.keys(AMOUNT_WORDS).join("|")})\\b`, "gi");

/**
 * Every number written in words in `text`, with the word as written: "twenty-one" is 21, "one hundred and five" is 105,
 * "half" is 0.5, "dozens" is NaN (an amount no fact can have).
 */
export function numberWordsIn(text: string): { word: string; value: number }[] {
  const out: { word: string; value: number }[] = [];
  for (const m of text.matchAll(NUMBER_WORDS_G)) {
    let total = 0;
    let current = 0;
    for (const token of m[0].toLowerCase().split(/[\s-]+/)) {
      if (token === "and" || !token) continue;
      if (token in UNIT_WORDS) current += UNIT_WORDS[token];
      else if (token === "hundred") current = (current || 1) * 100;
      else {
        total += (current || 1) * SCALE_WORDS[token];
        current = 0;
      }
    }
    out.push({ word: m[0], value: total + current });
  }
  for (const m of text.matchAll(AMOUNT_WORDS_G)) out.push({ word: m[0], value: AMOUNT_WORDS[m[0].toLowerCase()] });
  return out;
}

/**
 * Words a reworded sentence may not ADD (a word its template already has, e.g. "all through our online form", is
 * fine): sweeping or legal claims no fact can back. English and French, any letter case; inflections listed out.
 */
export const BANNED_WORDS: readonly string[] = [
  // English
  "compliant", "compliance", "certified", "certify", "certification", "guarantee", "guarantees", "guaranteed",
  "guaranteeing", "fully", "every", "everyone", "everybody", "everything", "everywhere", "all", "satisfied",
  "resolved",
  // French
  "conforme", "conformes", "conformité", "certifié", "certifiée", "certifiés", "certifiées", "garantie", "garanties",
  "garanti", "garantis", "garantir", "garantit", "garantissons", "entièrement", "pleinement", "totalement", "chaque",
  "tout", "tous", "toute", "toutes", "satisfait", "satisfaite", "satisfaits", "satisfaites", "résolu", "résolue",
  "résolus", "résolues",
];
/** "100%", "100 %", "100 per cent", "100 percent", "cent pour cent": all counted as "100%". */
const HUNDRED_PERCENT = String.raw`(?<![\p{N}.,])100\s?(?:%|per\s?cent(?![\p{L}]))|(?<![\p{L}])cent\s+pour\s+cent(?![\p{L}])`;
const BANNED_G = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${BANNED_WORDS.join("|")})(?![\p{L}\p{N}])|${HUNDRED_PERCENT}`, "giu");

/** How often each banned word appears in `text` (lower case; every way of writing 100% is "100%"). */
export function bannedWordsIn(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.normalize("NFKC").matchAll(BANNED_G)) {
    const w = /^(?:100|cent)/i.test(m[0]) ? "100%" : m[0].toLowerCase();
    out.set(w, (out.get(w) ?? 0) + 1);
  }
  return out;
}

/** The most words a rewording of a `templateWords`-word template may have: 1.3 times, rounded up (integer maths). */
export function maxWords(templateWords: number): number {
  return Math.ceil((templateWords * 13) / 10);
}
const WORD_G = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

/** The words of `text` ("don't" is one, "account-opening" two), as the length rule counts them. */
export function wordCount(text: string): number {
  return text.normalize("NFKC").match(WORD_G)?.length ?? 0;
}

/** Replace every occurrence of each value (longest first) with a space. */
function strip(text: string, values: readonly string[]): string {
  let out = text;
  for (const v of [...values].sort((a, b) => b.length - a.length)) if (v) out = out.split(v).join(" ");
  return out;
}

/**
 * Check one sentence against the snapshot. `claim` (its template and slots) adds the "keep every slot value" rule:
 * a number slot must appear as that exact number, a text slot verbatim.
 */
export function validateSentence(
  s: { text: string; factIds: readonly string[] },
  ctx: ValidationContext,
  claim?: Pick<Claim, "template" | "slots">,
): ValidationResult {
  const reasons: RejectReason[] = [];
  const add = (code: RejectCode, detail?: string) => {
    if (!reasons.some((r) => r.code === code && r.detail === detail)) reasons.push(detail === undefined ? { code } : { code, detail });
  };
  const text = s.text ?? "";
  if (!text.trim()) return { ok: false, reasons: [{ code: "empty" }] };

  if (s.factIds.length === 0) add("no_facts");
  const cited: Fact[] = [];
  for (const id of s.factIds) {
    const f = ctx.facts.get(id);
    if (f) cited.push(f);
    else add("unknown_fact", id);
  }

  // Text values of the cited facts (a lead-approved public summary, an area heading) are quoted verbatim: they were
  // checked when the lead approved them, so the scans below skip them (a summary may say "the [Submit] button").
  // Both as stored and trimmed: a claim quotes a public summary trimmed (lib/report/claims.ts).
  const texts = cited.flatMap((f) => Object.values(f.values).filter((v): v is string => typeof v === "string")).flatMap((v) => [v, v.trim()]);
  // NFKC first, so full-width digits and brackets ("７", "［") are scanned as the ASCII ones they look like.
  const scan = strip(text.normalize("NFKC"), texts.map((t) => t.normalize("NFKC")));

  if (/[[\]{}]/.test(scan)) add("placeholder");
  for (const span of detectPatterns(scan)) add("contact_detail", span.type);

  const allowedRefs = new Set(cited.flatMap((f) => f.caseIds.map((id) => ctx.refsById.get(id)).filter((r): r is string => !!r)));
  for (const m of scan.matchAll(CASE_REF_G)) if (!allowedRefs.has(m[0].toUpperCase())) add("uncited_case_ref", m[0].toUpperCase());

  // Numbers outside the quoted text values must be number values of the cited facts (or a year of the period). A
  // digit inside a quoted summary ("tested it 10 times") was stripped above, so it never licenses a "10" elsewhere.
  const written = numbersIn(scan.replace(CASE_REF_G, " "));
  const allowed = new Set<number>(ctx.allowedYears);
  for (const f of cited) for (const v of Object.values(f.values)) if (typeof v === "number") allowed.add(v);
  for (const n of written) if (!allowed.has(n)) add("invented_number", String(n));
  for (const w of numberWordsIn(scan)) if (!allowed.has(w.value)) add("invented_number", w.word.toLowerCase());

  if (claim) {
    const found = new Set(written);
    for (const m of claim.template.matchAll(SLOT)) {
      const key = m[1];
      if (!Object.prototype.hasOwnProperty.call(claim.slots, key)) continue;
      const v = claim.slots[key];
      const kept = typeof v === "number" ? found.has(v) : text.includes(v);
      if (!kept) add("dropped_slot", key);
    }
  }

  // Against the claim's filled template, with the same quoted texts taken out (a public summary's own words and
  // digits are its text on both sides). Without a claim there is nothing to compare: any banned word is refused.
  const filled = claim ? strip(fillTemplate(claim).normalize("NFKC"), texts.map((t) => t.normalize("NFKC"))) : "";
  const licensed = bannedWordsIn(filled);
  for (const [word, n] of bannedWordsIn(scan)) if (n > (licensed.get(word) ?? 0)) add("banned_word", word);
  if (claim) {
    // The template's numbers in its order; the sentence's numbers that are template values must be exactly that
    // sequence (a swap, a repeat or a missing mention is refused). A dropped slot is already its own reason.
    if (!reasons.some((r) => r.code === "dropped_slot")) {
      const expected = numbersIn(filled.replace(CASE_REF_G, " "));
      const values = new Set(expected);
      const got = written.filter((n) => values.has(n));
      if (got.length !== expected.length || got.some((n, i) => n !== expected[i])) add("number_order");
    }
    const limit = maxWords(wordCount(fillTemplate(claim)));
    if (wordCount(text) > limit) add("too_long", String(limit));
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

const codes = (r: ValidationResult): RejectCode[] => (r.ok ? [] : [...new Set(r.reasons.map((x) => x.code))]);

/**
 * The sentence shown for each claim, in claim order: the phrased text when it passes the validator, otherwise the
 * claim's template (fallback). `phrased` null = the AI wording step failed: every sentence is its template.
 */
export function chooseSentences(claims: readonly Claim[], phrased: PhraseClaimsOutput | null, ctx: ValidationContext): ReportSentence[] {
  const byId = new Map((phrased ?? []).map((p) => [p.claimId, p.text]));
  return claims.map((c) => {
    const factIds = [...c.factIds];
    let rejected: RejectCode[] | undefined;
    const candidate = byId.get(c.claimId);
    if (candidate !== undefined) {
      const r = validateSentence({ text: candidate, factIds }, ctx, c);
      if (r.ok) return { id: c.claimId, text: candidate.trim(), factIds, fallback: false };
      rejected = codes(r);
    }
    const template = fillTemplate(c);
    const t = validateSentence({ text: template, factIds }, ctx, c);
    const sentence: ReportSentence = { id: c.claimId, text: template, factIds, fallback: true };
    if (rejected) sentence.rejected = rejected;
    if (!t.ok) sentence.blocked = codes(t);
    return sentence;
  });
}

/** Every generated sentence of a report, in reading order. */
export function contentSentences(content: Pick<ReportContent, "sections">): ReportSentence[] {
  return content.sections.flatMap((s) =>
    s.blocks.flatMap((b) => (b.kind === "claim" ? [b.sentence] : b.kind === "claimList" ? b.sentences : [])),
  );
}

export interface ExportBlocker {
  sentenceId: string;
  /** no_sources: the sentence cites nothing; blocked: even its template failed the validator. */
  reason: "no_sources" | "blocked";
}

/** domain §7.5 "Export is blocked if any sentence lacks a citation" (and any sentence the validator blocked). */
export function exportBlockers(content: Pick<ReportContent, "sections">): ExportBlocker[] {
  const out: ExportBlocker[] = [];
  for (const s of contentSentences(content)) {
    if (s.factIds.length === 0) out.push({ sentenceId: s.id, reason: "no_sources" });
    else if (s.blocked?.length) out.push({ sentenceId: s.id, reason: "blocked" });
  }
  return out;
}

/**
 * /verify check 1, second half: reports.content is outside the manifest, so every sentence stored in it is checked
 * again against the stored snapshot (the claims are recompiled from the snapshot and the frozen plan areas). A sentence
 * fails when its claim no longer exists, its citations changed, or the validator refuses it; a claim with no sentence
 * fails too. Swapping two numbers of the same fact is caught by the claim's template order (number_order, Phase 7):
 * both values belong to the fact, so the number check alone would let it through.
 */
export function revalidateContent(content: Pick<ReportContent, "sections" | "settings">, snapshot: ReportSnapshot): { ok: boolean; failed: string[] } {
  const ctx = validationContext(snapshot);
  const claims = new Map<string, ReportClaim>(compileClaims(snapshot, { planAreas: content.settings.planAreas }).map((c) => [c.claimId, c]));
  const failed: string[] = [];
  const seen = new Set<string>();
  for (const s of contentSentences(content)) {
    seen.add(s.id);
    const c = claims.get(s.id);
    const sameCitations = !!c && c.factIds.length === s.factIds.length && c.factIds.every((id, i) => id === s.factIds[i]);
    // A blocked sentence is its template, which the validator refused at generation: it must still be exactly that.
    const textOk = !!c && (s.blocked?.length ? s.text === fillTemplate(c) : validateSentence(s, ctx, c).ok);
    if (!c || !sameCitations || !textOk) failed.push(s.id);
  }
  for (const id of claims.keys()) if (!seen.has(id)) failed.push(id);
  return { ok: failed.length === 0, failed };
}
