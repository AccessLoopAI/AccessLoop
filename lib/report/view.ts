// What the report pages render (docs/domain.md §7 steps 6-9): a stored report (content + snapshot) turned into a
// client-safe view. The staff draft (/app/reports/[id]), the public page (/p/[orgSlug]/reports/[id]) and the
// plain-text export all read this one shape, so the three can never show different sources for a sentence.
// No number is computed here beyond counting what the stored checks say (lib/metrics computed every fact). Pure.
import { STAFF_STATUS_LABELS, type CaseStatus } from "@/lib/status";
import { AREA_HEADINGS, passes, type CheckResult, type PriorityArea } from "./headings";
import { sentenceSources } from "./compose";
import { reportPeriodLabel } from "./period";
import type { ReportContent, ReportPeriod, ReportSentence, ReportSnapshot, SectionKey } from "./types";

/** One case a sentence cites, as the Sources list shows it (the lead-approved public summary only, never report text). */
export interface SourceCase {
  ref: string;
  /** The public summary approved at triage; null = not reviewed yet when the report was built. */
  summary: string | null;
  status: CaseStatus;
  /** The staff label of `status` (domain §3), as frozen in the snapshot. */
  statusLabel: string;
}

export interface SentenceView {
  id: string;
  text: string;
  /** Indexes into ReportView.cases, in snapshot order: the sentence's Sources list. */
  sources: number[];
  /** The validator refused even the template: sign-off and export are blocked (docs/decisions.md). */
  blocked: boolean;
}

export type BlockView =
  | { kind: "org"; text: string }
  | { kind: "lead" }
  | { kind: "claim"; sentence: SentenceView }
  | { kind: "subheading"; text: string }
  | { kind: "claimList"; sentences: SentenceView[] };

export interface SectionView {
  key: SectionKey;
  /** The exact <h2> text. */
  heading: string;
  /** Why the section is required (shown to staff only). */
  citation: string;
  blocks: BlockView[];
}

export interface ReportView {
  sections: SectionView[];
  /** The snapshot's cases, in snapshot order (case seq). */
  cases: SourceCase[];
}

/** The legal reason each section exists (ACR s.14(1); ACA s.71(4), (5)). */
export function sectionCitation(key: SectionKey): string {
  if (key === "general") return "ACR s.14(1)(a) and s.14(2)";
  if (key === "consultations") return "ACR s.14(1)(c); ACA s.71(4)";
  if (key === "feedback") return "ACR s.14(1)(d); ACA s.71(5)";
  const area = key.slice("area:".length) as PriorityArea;
  return `ACR s.14(1)(b); ACA s.${AREA_HEADINGS[area]?.acaPara ?? "5"}`;
}

export function reportView(content: Pick<ReportContent, "sections">, snapshot: Pick<ReportSnapshot, "facts" | "cases">): ReportView {
  const index = new Map(snapshot.cases.map((c, i) => [c.id, i]));
  const sentence = (s: ReportSentence): SentenceView => ({
    id: s.id,
    text: s.text,
    sources: sentenceSources(s, snapshot).map((c) => index.get(c.id)!),
    blocked: !!s.blocked?.length,
  });
  return {
    sections: content.sections.map((sec) => ({
      key: sec.key,
      heading: sec.heading,
      citation: sectionCitation(sec.key),
      blocks: sec.blocks.map((b): BlockView => {
        if (b.kind === "claim") return { kind: "claim", sentence: sentence(b.sentence) };
        if (b.kind === "claimList") return { kind: "claimList", sentences: b.sentences.map(sentence) };
        return b;
      }),
    })),
    cases: snapshot.cases.map((c) => ({
      ref: c.ref,
      summary: c.publicSummary,
      status: c.status,
      statusLabel: STAFF_STATUS_LABELS[c.status] ?? c.status,
    })),
  };
}

export { LEAD_TEXT_MAX, sourcesButtonName } from "./labels";

/** The lead's text as paragraphs (blank lines separate them; single line breaks stay inside a paragraph). */
export function leadParagraphs(text: string | null | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "Your progress on the built environment" / "How you consulted persons with disabilities for this report". */
export function leadLabel(key: SectionKey, heading: string): string {
  if (key === "consultations") return "How you consulted persons with disabilities for this report";
  return `Your progress on ${heading.charAt(0).toLowerCase()}${heading.slice(1)}`;
}

/** "in 2026" for a calendar year, otherwise "from Jan 1, 2026 to Mar 31, 2026" (after "Feedback received"). */
export function receivedPhrase(p: ReportPeriod): string {
  const label = reportPeriodLabel(p);
  return /^\d{4}$/.test(label) ? `in ${label}` : `from ${label}`;
}

// ---------------------------------------------------------------- the "Report checks" list

export type CheckState = "passed" | "missing" | "to_write";

export interface CheckView {
  id: string;
  label: string;
  citation: string;
  state: CheckState;
  /** The section this check is about (its index in ReportView.sections): the check ticks as that section fills in. */
  section: number;
}

export interface ChecksView {
  /** Required checks (ACR s.14 headings and General's contents). */
  required: CheckView[];
  /** Warnings: the parts the lead still has to write (and any order note). */
  toWrite: CheckView[];
  /** Required checks that fail. */
  failing: number;
  /** checkProgressReport's passes(). */
  passes: boolean;
}

function sectionOf(id: string, sections: readonly Pick<SectionView, "key">[]): number {
  const find = (key: string) => Math.max(0, sections.findIndex((s) => s.key === key));
  const area = /^(?:R2|W):(.+)$/.exec(id)?.[1];
  if (area && area !== "consultations" && area !== "order") return find(`area:${area}`);
  if (id === "R3" || id === "W:consultations") return find("consultations");
  if (id === "R4" || id === "R4:body") return find("feedback");
  return find("general");
}

/** The stored checkProgressReport results, grouped for the checklist. */
export function checksView(results: readonly CheckResult[], sections: readonly Pick<SectionView, "key">[]): ChecksView {
  const view = (r: CheckResult): CheckView => ({
    id: r.id,
    label: r.label,
    citation: r.citation,
    state: r.ok ? "passed" : r.severity === "error" ? "missing" : "to_write",
    section: sectionOf(r.id, sections),
  });
  const required = results.filter((r) => r.severity === "error").map(view);
  const toWrite = results.filter((r) => r.severity === "warning" && !r.ok).map(view);
  return { required, toWrite, failing: required.filter((c) => c.state !== "passed").length, passes: passes([...results]) };
}

/** The checklist's first line: "All required checks pass" only when nothing required fails and nothing is blocked. */
export function checksSummary(c: Pick<ChecksView, "passes" | "failing">, blockers: number): string {
  if (c.passes && blockers === 0) return "All required checks pass";
  const n = c.failing + blockers;
  return `${n} required ${n === 1 ? "check fails" : "checks fail"}`;
}

/** "7 parts still need your text" / "Every part has its text". */
export function toWriteLine(toWrite: number): string {
  if (toWrite === 0) return "Every part has its text";
  return `${toWrite} ${toWrite === 1 ? "part still needs" : "parts still need"} your text`;
}

// ---------------------------------------------------------------- status, regulator notice

export type ReportState = "draft" | "signed_off" | "published";

export function reportState(r: { status: string; publishedAt: Date | string | null }): ReportState {
  if (r.status !== "signed_off") return "draft";
  return r.publishedAt ? "published" : "signed_off";
}

export const REPORT_STATE_LABELS: Record<ReportState, string> = {
  draft: "Draft",
  signed_off: "Signed off",
  published: "Published",
};

/** Who an org notifies after publishing (ACR s.16 and the sector regulations), by orgs.regulator. */
export const REGULATOR_NAMES: Record<string, string> = {
  accessibility_commissioner: "the Accessibility Commissioner",
  crtc: "the CRTC",
  cta: "the Canadian Transportation Agency",
};

/** ACR s.16: notify the regulator within 48 hours after publishing. AccessLoop only reminds (domain §1.4). */
export const REGULATOR_NOTICE_HOURS = 48;

export function regulatorNoticeDue(publishedAt: Date): Date {
  return new Date(publishedAt.getTime() + REGULATOR_NOTICE_HOURS * 3_600_000);
}
