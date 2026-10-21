// FROZEN BASELINE (layer 1 of docs/domain.md §5). You may ADD patterns with tests; never remove or loosen one.
// Pure and deterministic. Runs before any text leaves the server.

export type PiiType =
  | "EMAIL" | "PHONE" | "SIN" | "POSTAL_CODE" | "HEALTH_CARD" | "ACCOUNT_NUMBER" | "STREET_ADDRESS" | "URL"
  // produced by the LLM layer / human review, not by this file:
  | "PERSON" | "STAFF_NAME" | "DOB" | "QUASI_ID" | "OTHER_ID";

export interface Span {
  start: number;  // inclusive, UTF-16 index into the ORIGINAL text
  end: number;    // exclusive
  type: PiiType;
  source: "pattern" | "llm" | "human";
}

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

// ---- Keyword-anchored building blocks (Phase 7, docs/phase7-prompt.md T1 item 4; the misses the review reproduced) ----
// Since Phase 7 this file also produces DOB (a date next to a birth keyword) and OTHER_ID (a ticket or reference number
// next to its keyword, or an IT-service ticket number). The keyword itself stays visible ("my SIN is [SIN]"): each
// lookbehind below matches the keyword and the words joining it to the value, and the span covers the value only.
// Strings, so the rules below can share them; every rule using them has the `u` flag.
// No ReDoS: every run of spaces or signs is bounded ({0,4}) and no two quantifiers can share the same characters, so a
// long run of spaces or joining words costs linear time (tests/redaction.patterns.test.ts times a hostile text).
// Rules whose value starts with a digit check that first ((?=\d)), before their lookbehind.
/** Words and signs between a keyword and its value: "number", "no.", "#", ":", "is", "est le", "de"... (or nothing). */
const JOIN = String.raw`[\s:#=]{0,4}(?:(?:is|was|are|est|c['’]est|number|numbers|num[ée]ro|num|nr|no|n[°º]|of|de|du|le|la)(?![\p{L}])\.?[\s:#=]{0,4}){0,4}`;
/** EN street words in any letter case (the capitalized rule above stays as it is). */
const STREET_WORDS = String.raw`street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|way|crescent|cres|court|ct|place|pl|trail|terrace|parkway|pkwy|highway|hwy|circle|cir|square|sq`;
/** Words that end a lowercase street name: "3 cars on the road" and "a 5 minute drive" are not addresses. */
const NOT_STREET_NAME = String.raw`the|a|an|of|on|in|at|to|for|from|by|my|your|our|their|his|her|its|this|that|these|those|and|or|but|with|into|onto|near|down|up|across|along|over|under|past|off|per|each|every|other|more|minute|minutes|min|mins|hour|hours|hr|hrs|second|seconds|sec|day|days|week|weeks|month|months|year|years|time|times|km|kilometre|kilometres|kilometer|kilometers|mile|miles|metre|metres|meter|meters|m|ft|foot|feet|block|blocks|lane|lanes|way|ways|car|cars|bus|buses|stop|stops|people|person|persons|step|steps|floor|floors|storey|storeys|stair|stairs|seat|seats|door|doors|light|lights|busy|wide|narrow|long|short`;
const STREET_TAIL = String.raw`(?:${STREET_WORDS})(?![\p{L}])\.?(?:\s{1,4}(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)(?![\p{L}]))?(?:,?\s{0,4}(?:apt|apartment|unit|suite|#)\.?\s{0,4}[\p{L}\p{N}-]+)?`;
const STREET_NAME_WORD = String.raw`(?!(?:${NOT_STREET_NAME})\s)[\p{L}][\p{L}'’.-]*\s{1,4}`;
const SPOKEN_NUMBER = String.raw`zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand`;
const ADDRESS_KEYWORD = String.raw`(?<![\p{L}])(?:live|lives|lived|living|reside|resides|residing|stay|stays|staying|address|adresse|moved)(?:\s{1,4}(?:is|was|at|on|to)(?![\p{L}])){0,3}[\s:]{1,4}`;
/** FR street words and their abbreviations ("boul.", "ch.", "av."), any letter case. */
const FR_STREET_WORDS = String.raw`boul|boulv|blvd|ch|chem|av|rte|mont[ée]e|all[ée]e|impasse|promenade|croissant|terrasse|c[ôo]te|rang|carr[ée]|rue|chemin|boulevard|avenue|route`;
const HEALTH_KEYWORD = String.raw`(?<![\p{L}])(?:ohip|health\s{0,4}card|health\s{0,4}(?:insurance\s{0,4})?(?:number|no\.?|#)|health\s{0,4}insurance\s{0,4}card|carte\s{0,4}(?:sant[ée]|soleil|d['’]assurance[\s-]maladie)|(?:num[ée]ro\s{0,4}d['’])?assurance[\s-]maladie|ramq)`;
const ACCOUNT_KEYWORD = String.raw`(?<![\p{L}])(?:account|acct|a\/c|chequing|checking|savings|compte|folio)(?:\s{1,4}(?:bancaire|ch[èe]ques?|[ée]pargne|bank|banking))?`;
/** A bank transit (branch) number is 5 digits, sometimes followed by the 3-digit institution number. */
const TRANSIT_KEYWORD = String.raw`(?<![\p{L}])(?:transit|branch\s{0,4}(?:number|no\.?|#)|succursale)`;
/** "SIN"/"NAS" need a joining word or sign before the number; a bare "SIN 123 456 789" stays Luhn-checked (frozen test). */
const SIN_KEYWORD = String.raw`(?<![\p{L}])(?:(?:sin|s\.i\.n\.?|nas|n\.a\.s\.?)\s{0,4}(?:[:#=]|(?:is|was|est|c['’]est|number|num[ée]ro|num|nr|no|n[°º])(?![\p{L}])\.?)|social\s{1,4}insurance\s{1,4}(?:number|no\.?|#)|(?:num[ée]ro|no\.?|n[°º])\s{0,4}d['’]assurance[\s-]sociale|assurance[\s-]sociale)`;
const MONTH = String.raw`(?:jan(?:uary|v\.?|vier)?|feb(?:ruary)?|f[ée]v(?:rier|r\.?)?|mar(?:ch|s)?|apr(?:il)?|avr(?:il|\.)?|may|mai|june?|juin|july?|juil(?:let|\.)?|aug(?:ust)?|ao[ûu]t|sep(?:t(?:ember|embre)?)?\.?|oct(?:ober|obre)?\.?|nov(?:ember|embre)?\.?|d[ée]c(?:ember|embre)?\.?)(?![\p{L}])`;
const DAY = String.raw`(?:[12]\d|3[01]|0?[1-9])(?:st|nd|rd|th|er|e)?`;
const YEAR = String.raw`(?:19|20)\d{2}`;
/** 1990-05-14, 14/05/1990, 05-14-90, May 14, 1990, 14th of May 1990, 1er mai 1990, May 1990. */
const DATE = String.raw`(?:${YEAR}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:${YEAR}|\d{2})|${MONTH}\s{0,4}${DAY},?\s{1,4}${YEAR}|${DAY}\s{1,4}(?:of\s{1,4})?${MONTH},?\s{1,4}${YEAR}|${MONTH}\s{1,4}${YEAR})`;
const DOB_KEYWORD = String.raw`(?<![\p{L}])(?:born|dob|d\.o\.b\.?|date\s{1,4}of\s{1,4}birth|birth\s{0,4}date|birthday|n[ée]\(e\)|né(?:e|es|s)?|date\s{1,4}de\s{1,4}naissance|naissance|ddn)[\s:,=-]{0,4}(?:(?:is|was|on|in|the|of|le|la|au|en|est)(?![\p{L}])[\s:,=-]{1,4}){0,3}`;
/** Ticket and reference words. The first group may stand alone ("ticket 48213"); the second needs "number"/"ID"/"#". */
const ID_KEYWORD = String.raw`(?<![\p{L}])(?:(?:ticket|incident|claim|confirmation|reference|ref|booking|reservation|r[ée]servation|dossier|r[ée]clamation|r[ée]f[ée]rence|billet)(?:\s{1,4}(?:number|no\.?|num[ée]ro|nr|id|code|#))?|(?:case|candidate|employee|client|customer|member|membership|patient|student|applicant|application|file|staff)\s{0,4}(?:number|no\.?|num[ée]ro|nr|id|code|#))`;

const RULES: { type: PiiType; re: RegExp; accept?: (m: string) => boolean }[] = [
  { type: "EMAIL", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: "URL", re: /https?:\/\/[^\s?#]+\?[^\s]+/gi }, // only URLs with query strings (may carry tokens/ids)
  { type: "HEALTH_CARD", re: /(?<![\dA-Z])\d{4}[- ]?\d{3}[- ]?\d{3}[- ]?[A-Z]{2}(?![A-Z\d])/gi }, // e.g. Ontario
  { type: "ACCOUNT_NUMBER", re: /(?<!\d)(?:\d[ -]?){11,18}\d(?!\d)/g },        // 12-19 digit runs (cards, accounts)
  { type: "SIN", re: /(?<!\d)\d{3}[ -]?\d{3}[ -]?\d{3}(?!\d)/g, accept: (m) => luhn(m.replace(/\D/g, "")) },
  { type: "PHONE", re: /(?<!\d)(?:\+?1[ .-]?)?\(?[2-9]\d{2}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)/g },
  // Dictated numbers: 7+ spoken digits in a row ("four one six five five five ..."), EN + FR.
  { type: "PHONE", re: /(?<!\p{L})(?:(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|zéro|un|deux|trois|quatre|cinq|sept|huit|neuf)[\s,-]+){6,}(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|zéro|un|deux|trois|quatre|cinq|sept|huit|neuf)(?!\p{L})/giu },
  { type: "POSTAL_CODE", re: /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi },
  { type: "STREET_ADDRESS",
    re: /\b\d{1,5}[A-Z]?\s+(?:[A-Z][\w'’-]*\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Crescent|Cres|Court|Ct|Place|Pl|Trail|Terrace|Parkway|Pkwy)\b\.?(?:\s+(?:N|S|E|W|North|South|East|West))?(?:,?\s*(?:Apt|Unit|Suite|#)\s*\w+)?/g },
  { type: "STREET_ADDRESS", re: /\b\d{1,5}[A-Z]?,?\s+(?:rue|chemin|boulevard|avenue|route)\s+(?:[\wÀ-ÿ'’-]+\s?){1,4}/gi },
  // ---- Phase 7 additions (keyword-anchored; building blocks above). Each only adds spans. ----
  // Street addresses in any letter case, as dictation writes them: "12 king street west", "250 old mill rd, unit 4".
  { type: "STREET_ADDRESS", re: new RegExp(String.raw`(?<![\p{L}\p{N}])\d{1,5}[a-z]?\s{1,4}(?:${STREET_NAME_WORD}){1,3}${STREET_TAIL}`, "giu") },
  // A spoken house number after "I live at" / "my address is": "i live at one twenty three king street".
  { type: "STREET_ADDRESS", re: new RegExp(String.raw`(?=[a-z])(?<=${ADDRESS_KEYWORD})(?:(?:${SPOKEN_NUMBER})[\s-]{1,4}){1,6}(?:${STREET_NAME_WORD}){1,3}${STREET_TAIL}`, "giu") },
  // French street words and abbreviations, any case: "12 boul. René-Lévesque Ouest", "1234, CH. DE LA CÔTE-DES-NEIGES".
  { type: "STREET_ADDRESS", re: new RegExp(String.raw`(?<![\p{L}\p{N}])\d{1,5}[a-z]?,?\s{1,4}(?:${FR_STREET_WORDS})(?:\.\s{0,4}|\s{1,4})[\p{L}\p{N}'’-]+(?:\s[\p{L}\p{N}'’-]+){0,3}`, "giu") },
  // PO Box, Rural Route, case postale: "P.O. Box 1234", "RR 2", "R.R. #3", "C.P. 456", "case postale 12".
  { type: "STREET_ADDRESS", re: /(?<![\p{L}])(?:p\.?\s?o\.?\s?box|post\s{1,4}office\s{1,4}box|postal\s{1,4}box|c\.\s?p\.|case\s{1,4}postale|bo[iî]te\s{1,4}postale)\s{0,4}(?:no\.?|#)?\s{0,4}\d{1,6}(?![\p{N}])/giu },
  { type: "STREET_ADDRESS", re: /(?<![\p{L}])(?:r\.?\s?r\.?|rural\s{1,4}route)\s{0,4}(?:no\.?|#)?\s{0,4}\d{1,3}(?![\p{N}])/giu },
  // Health card numbers after their keyword, with or without version letters: "my OHIP number is 1234 567 890",
  // "carte santé : 1234-567-890", "RAMQ ABCD 1234 5678".
  { type: "HEALTH_CARD", re: new RegExp(String.raw`(?=\d|[a-z]{4})(?<=${HEALTH_KEYWORD}${JOIN})(?:\d{4}[- ]?\d{3}[- ]?\d{3}(?:[- ]?[a-z]{1,2})?|[a-z]{4}[- ]?\d{4}[- ]?\d{4})(?![\p{L}\p{N}])`, "giu") },
  // The Ontario grouping on its own (4-3-3 with one kind of separator), which no phone number uses: "1234-567-890".
  { type: "HEALTH_CARD", re: /(?<![\p{L}\p{N}-])\d{4}([- ])\d{3}\1\d{3}(?![\p{N}]|[- ]\d)/gu },
  // Bank account numbers (5+ digits) after their keyword: "account no. 1234567", "numéro de compte : 123-4567",
  // "compte chèques 7654321"; transit numbers: "transit 12345", "transit number 12345-003".
  { type: "ACCOUNT_NUMBER", re: new RegExp(String.raw`(?=\d)(?<=${ACCOUNT_KEYWORD}${JOIN})\d(?:[ -]?\d){4,16}(?![\p{N}])`, "giu") },
  { type: "ACCOUNT_NUMBER", re: new RegExp(String.raw`(?=\d)(?<=${TRANSIT_KEYWORD}${JOIN})\d{5}(?:[- ]\d{3})?(?![\p{N}])`, "giu") },
  // Nine digits after "SIN"/"NAS" and a joining word, Luhn-valid or not (a typo is still someone's number):
  // "my SIN is 123 456 789", "SIN: 123-456-789", "NAS : 123 456 789", "numéro d'assurance sociale 123 456 789".
  { type: "SIN", re: new RegExp(String.raw`(?=\d)(?<=${SIN_KEYWORD}${JOIN})\d{3}[ -]?\d{3}[ -]?\d{3}(?![\p{N}])`, "giu") },
  // Dates of birth next to their keyword: "born on 14/05/1990", "DOB: 1990-05-14", "née le 3 mars 1985".
  { type: "DOB", re: new RegExp(String.raw`(?=[\p{L}\p{N}])(?<=${DOB_KEYWORD})${DATE}(?![\p{L}\p{N}])`, "giu") },
  // IT-service ticket numbers: "INC0012345", "RITM0045678" (never inside a link's path or query: no "/" or "=" before).
  { type: "OTHER_ID", re: /(?<![\p{L}\p{N}/=#?&_.-])(?:INC|RITM|REQ|CHG|PRB|TASK|SCTASK|CS)\d{6,10}(?![\p{L}\p{N}])/gu },
  // Ticket, case and reference numbers after their keyword: "ticket #48213", "booking reference QX7T2M", "candidate ID
  // is 448812", "numéro de dossier 2024-55". At least 5 letters and digits with a digit; never a case ref (BAR-0003).
  { type: "OTHER_ID", re: new RegExp(String.raw`(?=[\p{L}\p{N}])(?<=${ID_KEYWORD}${JOIN})[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?![\p{L}\p{N}])`, "giu"),
    accept: (m) => /\d/.test(m) && m.replace(/-/g, "").length >= 5 && !/^BAR-\d+$/i.test(m) },
];

/** Layer-1 spans over `text`, non-overlapping; earlier rules win ties, longer spans win overlaps. */
export function detectPatterns(text: string): Span[] {
  const found: Span[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      if (rule.accept && !rule.accept(m[0])) continue;
      const value = m[0].replace(/[\s.,]+$/, "");
      found.push({ start: m.index!, end: m.index! + value.length, type: rule.type, source: "pattern" });
    }
  }
  return mergeSpans(found);
}

/** Merge overlapping spans: keep the longer one (first one on equal length). */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start < last.end) {
      if (s.end - s.start > last.end - last.start) out[out.length - 1] = s;
      continue;
    }
    out.push(s);
  }
  return out;
}

/** Replace spans with "[TYPE]". Spans must index into `text`. */
export function applyRedaction(text: string, spans: Span[]): string {
  let out = "", i = 0;
  for (const s of mergeSpans(spans)) {
    out += text.slice(i, s.start) + `[${s.type}]`;
    i = s.end;
  }
  return out + text.slice(i);
}

/**
 * The LLM layer returns exact substrings (LLMs are unreliable with offsets). Map every occurrence
 * of each value back onto the ORIGINAL text. Values shorter than 2 chars or containing "[" are ignored.
 */
export function spansFromValues(
  text: string, items: { text: string; type: PiiType }[], source: Span["source"] = "llm",
): Span[] {
  const spans: Span[] = [];
  for (const it of items) {
    const v = it.text.trim();
    if (v.length < 2 || v.includes("[")) continue;
    let from = 0, at: number;
    while ((at = text.indexOf(v, from)) !== -1) {
      spans.push({ start: at, end: at + v.length, type: it.type, source });
      from = at + v.length;
    }
  }
  return spans;
}
