// The shapes of a progress report (docs/domain.md §7, §8). Type-only and client-safe: pages, components and the
// server code under lib/report share these. What is stored where:
//   reports.snapshot       ReportSnapshot  (frozen at generation; manifestHash = sha256(canonicalJson(snapshot)))
//   reports.manifest_hash  manifestHash(snapshot)
//   reports.content        ReportContent   (sections and the validated sentences; settings frozen with them)
//   reports.heading_check  CheckResult[]   (lib/report/headings.ts checkProgressReport over toDraftSections)
//   reports.area_text      Record<PriorityArea, string>  (the lead's progress text per plan area)
//   reports.consultations_text  string | null           (the lead's Consultations text)
//   reports.content.signing     ReportSigning           (the signed root, written at sign-off; never by generation)
import type { CaseStatus } from "@/lib/status";
import type { Claim } from "@/lib/ai/schemas";
import type { PriorityArea } from "./headings";

/** An inclusive range of calendar dates (YYYY-MM-DD, America/Toronto): feedback RECEIVED on start..end. */
export interface ReportPeriod {
  start: string;
  end: string;
}

/**
 * One case as the report saw it (domain §7.1). Dates are ISO strings so the jsonb round trip keeps the hash.
 * Every case received in the period is here; one closed as not accessibility feedback is cited only by
 * F_NOT_FEEDBACK (Phase 7 D6), never counted by another fact.
 */
export interface SnapshotCase {
  id: string;
  ref: string;
  status: CaseStatus;
  priorityArea: PriorityArea | null;
  /** The lead-approved public summary: the only case text a report may use. */
  publicSummary: string | null;
  receivedAt: string;
  verifiedAt: string | null;
  /** Hash of the case's latest event when the snapshot was frozen (domain §8 check 3 replays up to it). */
  headHash: string;
}

export const FACT_KINDS = ["F_TOTAL", "F_ANON", "F_NOT_FEEDBACK", "F_AREA", "F_OUTCOME", "F_VERIFY_TIME", "F_ACK", "F_RETEST", "F_CASE"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

/** domain §7.2: `{ id, kind, values, caseIds }`. Values are numbers or strings only (never null or NaN). */
export interface Fact {
  /** "F_TOTAL", "F_AREA:ict", "F_CASE:BAR-0012", ... */
  id: string;
  kind: FactKind;
  values: Record<string, number | string>;
  /** The cases behind the fact, in snapshot order (case seq). */
  caseIds: string[];
}

/**
 * reports.snapshot. domain §7.1 is `{ cases, facts }`; `version`, `period` and `asOf` are added (docs/decisions.md)
 * so the fingerprint also covers which period was reported and when it was frozen.
 */
export interface ReportSnapshot {
  version: 1;
  period: ReportPeriod;
  /** When the snapshot was frozen (ISO). The facts never depend on it; it is recorded for the reader. */
  asOf: string;
  cases: SnapshotCase[];
  facts: Fact[];
}

/** Why a sentence was refused (domain §7.5 plus "keep every slot value", §7.4). */
export const REJECT_CODES = [
  "empty",
  "no_facts",
  "unknown_fact",
  "invented_number",
  "uncited_case_ref",
  "placeholder",
  "contact_detail",
  "dropped_slot",
  // Phase 7 (lib/report/validate.ts, a reworded sentence against its filled template):
  "number_order", // its numbers are not in the template's order (two values swapped)
  "too_long", // more than 1.3 times the template's words (an added claim)
  "banned_word", // a sweeping or legal word the template does not have ("fully compliant", "every barrier")
] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export interface RejectReason {
  code: RejectCode;
  /** Text-free detail: a fact id, a number, a case ref. Never sentence text. */
  detail?: string;
}

/** One generated, cited sentence of the report. */
export interface ReportSentence {
  /** The claim it says (e.g. "C:F_OUTCOME"); unique within a report. */
  id: string;
  text: string;
  /** The facts it cites; the Sources button lists the union of their cases. */
  factIds: string[];
  /** true: the deterministic template is shown because the phrased sentence was refused or phrasing failed. */
  fallback: boolean;
  /** Why the phrased sentence was refused (when `fallback` because of the validator). */
  rejected?: RejectCode[];
  /** Even the template failed the validator (a bug or an unusual public summary): blocks sign-off and export. */
  blocked?: RejectCode[];
}

/** Where a claim goes in the draft (domain §7.7). */
export type ClaimPlace =
  | "feedback:intro"
  | "feedback:outcome"
  | "feedback:followup"
  | "feedback:consideration"
  | `area:${PriorityArea}`;

/** A compiled claim (lib/ai Claim, sent to phraseClaims) plus where it goes. Only claimId/template/slots reach the AI. */
export interface ReportClaim extends Claim {
  place: ClaimPlace;
}

export type SectionKey = "general" | `area:${PriorityArea}` | "consultations" | "feedback";

export type ReportBlock =
  /** A sentence generated from org settings (General). Not a claim: carries the org's own contact details. */
  | { kind: "org"; text: string }
  /** The lead's text for this section (reports.area_text / consultations_text); a placeholder while empty. */
  | { kind: "lead" }
  | { kind: "claim"; sentence: ReportSentence }
  /** An h3 inside the section. Plain heading, never a region (names like "What happened to the feedback"). */
  | { kind: "subheading"; text: string }
  /** A bulleted list of cited sentences (the cases that were fixed). */
  | { kind: "claimList"; sentences: ReportSentence[] };

export interface ReportSection {
  key: SectionKey;
  /** The exact <h2> text: "General", an area's canonical heading, "Consultations", "Feedback". */
  heading: string;
  level: 2;
  blocks: ReportBlock[];
}

/** The org settings the draft was built from, frozen with it (later settings changes need a new draft). */
export interface ReportSettings {
  orgName: string;
  slug: string;
  planAreas: PriorityArea[];
  feedbackDesignateTitle: string;
  contactMailingAddress: string;
  contactPhone: string;
  contactEmail: string;
  /** The public feedback form's address as written in General. */
  formUrl: string;
}

/** How the sentences were worded. Never holds claim text or model output. */
export interface PhraseMeta {
  /** false: the AI wording step failed and every sentence uses its template. */
  ok: boolean;
  backend: string | null;
  model: string | null;
  promptSha: string | null;
  latencyMs: number | null;
  /** The error's class name when !ok (text-free). */
  error?: string;
  /** Sentences that show their template instead of the phrased text. */
  fallbacks: number;
}

/** One case history's last record when the report was signed off (docs/domain.md §8 "Signed at sign-off"). */
export interface SignedHead {
  caseId: string;
  /** The record's number in its case history (= the history's length then). */
  seq: number;
  hash: string;
}

/**
 * reports.content.signing, written once, in the same UPDATE that signs the report off (lib/report/edit.ts). The
 * root seals the report and EVERY case history of the org at that moment (lib/report/signing.ts `reportRoot`):
 *   root = sha256(canonicalJson({ kind: "accessloop.report-root", version: 1, reportId, signedAt,
 *                                 heads: the sorted head hashes, manifestHash, leadTextHash, contentHash }))
 *   signature = Ed25519 over the 64 ASCII characters of the root, with REPORT_SIGNING_KEY (key `keyId`).
 * `contentHash` covers reports.content without this `signing` key. The root is the fingerprint the lead puts in the
 * ACR s.16 notice to the regulator.
 */
export interface ReportSigning {
  version: 1;
  alg: "Ed25519";
  /** "ed25519-" + the first 16 hex characters of sha256(the raw 32-byte public key). */
  keyId: string;
  /** = reports.signed_off_at (ISO). */
  signedAt: string;
  root: string;
  /** base64 */
  signature: string;
  /** reports.manifest_hash when it was signed. */
  manifestHash: string;
  /** sha256(canonicalJson({ areaText, consultationsText })): the lead's own words. */
  leadTextHash: string;
  /** sha256(canonicalJson(reports.content without `signing`)): the published sentences, sections and settings. */
  contentHash: string;
  /** Every case history of the org at sign-off, sorted by hash. */
  heads: SignedHead[];
}

/** reports.content */
export interface ReportContent {
  version: 1;
  settings: ReportSettings;
  sections: ReportSection[];
  phrase: PhraseMeta;
  /** Present once the report is signed off with a signing key (reports signed off before this existed have none). */
  signing?: ReportSigning;
}
