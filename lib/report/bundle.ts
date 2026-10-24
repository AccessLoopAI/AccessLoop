// "Download evidence bundle" on a published report (docs/domain.md §8 "Signed at sign-off"). Pure: the caller
// loads the published report and its cited cases' events (lib/report/access.ts loadPublishedBundle).
//
// Public-safe fields ONLY, by allow-list: hashes, record types, timestamps, statuses, priority areas and the
// lead-approved public summaries the published report already shows; the report's own snapshot, sentences and lead
// text (all on the public page). Never an event payload, an actor, reporter text, a name or a contact detail.
// Staff-internal record types (redaction review, "Show original", notes) are written "internal", as /verify says
// "Internal record". A record's hash cannot be recomputed from these fields (the frozen chain hashes the whole
// payload), so a third party checks the links between records, that each history contains the record the report
// froze and the one that was signed, and the signed root over all of them (docs/domain.md §8).
import { DISPLAY_TIME_ZONE } from "@/lib/format";
import { CASE_STATUSES } from "@/lib/status";
import { citedCaseIds } from "./compose";
import { EVENT_WORDS, type ChainEvent } from "./evidence";
import { PRIORITY_AREAS } from "./headings";
import { contentForSigning, ROOT_KIND, ROOT_VERSION } from "./signing";
import type { ReportContent, ReportSigning, ReportSnapshot } from "./types";

export const BUNDLE_FORMAT = "accessloop-evidence-bundle";
export const BUNDLE_VERSION = 1;

export interface BundleEvent {
  seq: number;
  /** case_events.type, or "internal" for a staff-internal record. */
  type: string;
  /** When the record was written (ISO). */
  at: string;
  hash: string;
  prevHash: string;
  /** Status before and after, on records that change it. */
  from?: string;
  to?: string;
  /** The priority area set by this record (triage). */
  priorityArea?: string;
}

export interface BundleChain {
  caseId: string;
  ref: string;
  /** The lead-approved public summary as the report froze it (null: none yet). */
  publicSummary: string | null;
  /** The last record the report saw (snapshot headHash). */
  reportHead: string;
  /** The last record when the report was signed off (null: the report carries no signature). */
  signedHead: string | null;
  /** Every record of the history as stored now (seq order); records after the signed head are later updates. */
  events: BundleEvent[];
}

export interface EvidenceBundle {
  format: typeof BUNDLE_FORMAT;
  version: typeof BUNDLE_VERSION;
  /** When this file was made (ISO). */
  createdAt: string;
  about: string;
  /** The report page, its online evidence check, the published keys and the offline checker (tools/verify-bundle.mjs). */
  links: { report: string; verify: string; signingKeys: string; verifier: string };
  org: { name: string; slug: string };
  report: {
    id: string;
    title: string;
    period: { start: string; end: string };
    signedOffAt: string | null;
    publishedAt: string | null;
    /** reports.manifest_hash: sha256(canonicalJson(snapshot)). */
    manifestHash: string;
    /** reports.snapshot as stored. */
    snapshot: unknown;
    /** reports.content as stored, without `signing` (what contentHash covers). */
    content: unknown;
    /** The lead's text (reports.area_text, reports.consultations_text), as stored. */
    areaText: unknown;
    consultationsText: unknown;
    /** The time zone calendar dates are counted in ("received in the period", days to a fix). Not signed. */
    timeZone: string;
  };
  /** The signed root and what it covers; null for a report signed off before signing existed. */
  signature: {
    alg: "Ed25519";
    keyId: string;
    signedAt: string;
    root: string;
    /** base64 Ed25519 signature over the 64 ASCII characters of `root`. */
    signature: string;
    rootKind: typeof ROOT_KIND;
    rootVersion: typeof ROOT_VERSION;
    manifestHash: string;
    leadTextHash: string;
    contentHash: string;
    /** The head hash of every case history of the org at sign-off, sorted. */
    heads: string[];
    /** How the root is computed, in words. */
    rootFormula: string;
  } | null;
  /** Each case the report cites, in snapshot order. */
  chains: BundleChain[];
}

const STATUSES: ReadonlySet<string> = new Set(CASE_STATUSES);
const AREAS: ReadonlySet<string> = new Set(PRIORITY_AREAS);

/** One stored record as public-safe fields (allow-list; nothing else from the payload ever leaves). */
export function publicEvent(e: ChainEvent): BundleEvent {
  const out: BundleEvent = {
    seq: e.seq,
    type: Object.hasOwn(EVENT_WORDS, e.type) ? e.type : "internal",
    at: e.createdAt.toISOString(),
    hash: e.hash,
    prevHash: e.prevHash,
  };
  const p = e.payload ?? {};
  if (typeof p.to === "string" && STATUSES.has(p.to)) {
    out.to = p.to;
    if (typeof p.from === "string" && STATUSES.has(p.from)) out.from = p.from;
  }
  if (typeof p.priorityArea === "string" && AREAS.has(p.priorityArea)) out.priorityArea = p.priorityArea;
  return out;
}

export const ROOT_FORMULA =
  'root = sha256(canonicalJson({ kind: "accessloop.report-root", version: 1, reportId, signedAt, heads (sorted), manifestHash, leadTextHash, contentHash })); ' +
  "leadTextHash = sha256(canonicalJson({ areaText, consultationsText })); contentHash = sha256(canonicalJson(content)); " +
  "manifestHash = sha256(canonicalJson(snapshot)); canonicalJson = JSON with object keys sorted and no whitespace. " +
  "The signature is Ed25519 over the 64 ASCII characters of root.";

export const BUNDLE_ABOUT =
  "Evidence for a published accessibility progress report. It holds public information only: the report as published, " +
  "and for each case it cites the hashes, record types, times and statuses of its history. It never holds what a person " +
  "reported, names or contact details. Check the signature with the key listed at the signingKeys link. To check " +
  "everything offline, run AccessLoop's tools/verify-bundle.mjs (Node.js 20 or later, no other software) on this file.";

export interface BundleInput {
  org: { name: string; slug: string };
  report: {
    id: string;
    title: string;
    periodStart: string;
    periodEnd: string;
    signedOffAt: Date | null;
    publishedAt: Date | null;
    manifestHash: string;
    snapshot: ReportSnapshot;
    content: ReportContent;
    areaText: unknown;
    consultationsText: unknown;
  };
  /** Each cited case's stored events (any order), by case id. */
  chains: ReadonlyMap<string, readonly ChainEvent[]>;
  now: Date;
  links: EvidenceBundle["links"];
}

export function buildEvidenceBundle(i: BundleInput): EvidenceBundle {
  const { report } = i;
  const signing: ReportSigning | null = report.content.signing ?? null;
  const signedHeadOf = new Map((signing?.heads ?? []).map((h) => [h.caseId, h.hash]));
  const cited = new Set(citedCaseIds(report.content, report.snapshot));
  const chains: BundleChain[] = report.snapshot.cases
    .filter((c) => cited.has(c.id))
    .map((c) => ({
      caseId: c.id,
      ref: c.ref,
      publicSummary: c.publicSummary,
      reportHead: c.headHash,
      signedHead: signing ? (signedHeadOf.get(c.id) ?? null) : null,
      events: [...(i.chains.get(c.id) ?? [])].sort((a, b) => a.seq - b.seq).map(publicEvent),
    }));
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    createdAt: i.now.toISOString(),
    about: BUNDLE_ABOUT,
    links: i.links,
    org: { name: i.org.name, slug: i.org.slug },
    report: {
      id: report.id,
      title: report.title,
      period: { start: report.periodStart, end: report.periodEnd },
      signedOffAt: report.signedOffAt ? report.signedOffAt.toISOString() : null,
      publishedAt: report.publishedAt ? report.publishedAt.toISOString() : null,
      manifestHash: report.manifestHash,
      snapshot: report.snapshot,
      content: contentForSigning(report.content),
      areaText: report.areaText ?? {},
      consultationsText: report.consultationsText ?? null,
      timeZone: DISPLAY_TIME_ZONE,
    },
    signature: signing
      ? {
          alg: signing.alg,
          keyId: signing.keyId,
          signedAt: signing.signedAt,
          root: signing.root,
          signature: signing.signature,
          rootKind: ROOT_KIND,
          rootVersion: ROOT_VERSION,
          manifestHash: signing.manifestHash,
          leadTextHash: signing.leadTextHash,
          contentHash: signing.contentHash,
          heads: signing.heads.map((h) => h.hash).sort(),
          rootFormula: ROOT_FORMULA,
        }
      : null,
    chains,
  };
}

/** The file's text: pretty JSON (the hashes are over canonical JSON, which a reader rebuilds from the parsed values). */
export function bundleJson(b: EvidenceBundle): string {
  return `${JSON.stringify(b, null, 2)}\n`;
}

/** "accessibility-progress-report-2026-version-1-evidence.json", from the title. */
export function bundleFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${slug || "progress-report"}-evidence.json`;
}
