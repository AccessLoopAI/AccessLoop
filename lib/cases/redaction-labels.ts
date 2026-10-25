// Words for the redaction review on the staff case page (docs/domain.md §5 layer 3). Client-safe: labels and
// shapes only, no server imports, so the review's client component and its server actions share them.
import type { PiiType, Span } from "@/lib/redaction/patterns";

/** Every [TYPE] a span can have (lib/redaction/patterns.ts PiiType), in the order the "Kind of detail" list shows. */
export const PII_TYPES = [
  "PERSON",
  "STAFF_NAME",
  "DOB",
  "QUASI_ID",
  "OTHER_ID",
  "EMAIL",
  "PHONE",
  "STREET_ADDRESS",
  "POSTAL_CODE",
  "URL",
  "ACCOUNT_NUMBER",
  "HEALTH_CARD",
  "SIN",
] as const satisfies readonly PiiType[];

// Compile-time guard: the list above covers PiiType exactly.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const piiTypesComplete: Same<(typeof PII_TYPES)[number], PiiType> = true;
void piiTypesComplete;

/** The "Kind of detail" options, in plain words. */
export const PII_TYPE_LABELS: Record<PiiType, string> = {
  PERSON: "Person's name",
  STAFF_NAME: "Staff member's name",
  DOB: "Date of birth",
  QUASI_ID: "Identifying detail",
  OTHER_ID: "Other ID number",
  EMAIL: "Email address",
  PHONE: "Phone number",
  STREET_ADDRESS: "Street address",
  POSTAL_CODE: "Postal code",
  URL: "Web link",
  ACCOUNT_NUMBER: "Account or card number",
  HEALTH_CARD: "Health card number",
  SIN: "Social insurance number",
};

/** Short lower-case words for lists in sentences: "2 details hidden automatically (person, phone)". */
export const PII_TYPE_WORDS: Record<PiiType, string> = {
  PERSON: "person",
  STAFF_NAME: "staff name",
  DOB: "date of birth",
  QUASI_ID: "identifying detail",
  OTHER_ID: "other ID",
  EMAIL: "email",
  PHONE: "phone",
  STREET_ADDRESS: "address",
  POSTAL_CODE: "postal code",
  URL: "link",
  ACCOUNT_NUMBER: "account number",
  HEALTH_CARD: "health card",
  SIN: "SIN",
};

/** Who found a span: the patterns (layer 1), the AI (layer 2) or the lead (layer 3). */
export const SPAN_SOURCE_LABELS: Record<Span["source"], string> = {
  pattern: "Found by a pattern",
  llm: "Found by AI",
  human: "Added by you",
};

export function isPiiType(value: unknown): value is PiiType {
  return typeof value === "string" && (PII_TYPES as readonly string[]).includes(value);
}

/** Words the lead asks to hide: exactly as written in the report. */
export interface AddedWords {
  text: string;
  type: PiiType;
}

/** Limits for "Hide more words". */
export const HIDE_WORDS_MAX = 200;
export const HIDE_WORDS_MAX_ITEMS = 50;

/** One hidden detail in the review list. It never carries the hidden value, only its redacted surroundings. */
export interface ReviewItem {
  /** "p:3" = the 4th span of the stored proposal; "a:0" = the first words the lead added. */
  key: string;
  kind: "proposed" | "added";
  index: number;
  type: PiiType;
  source: Span["source"];
  /** The redacted text just before and after the token (every hidden detail stays hidden in it). */
  before: string;
  token: string;
  after: string;
  /** How many places the words are hidden (added words can appear more than once). */
  places: number;
  /** False when added words appear only in the summary or the "Where exactly?" detail, not the report. */
  inReport: boolean;
}

/** What the "Redaction review" region shows. Every text here is redacted with ALL spans (kept or not). */
export interface ReviewView {
  text: string;
  summary: string | null;
  aiSummary: string | null;
  locationDetail: string | null;
  items: ReviewItem[];
}

export const WORDS_NOT_FOUND = "We couldn't find those exact words in the report.";
