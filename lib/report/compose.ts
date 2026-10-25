// The draft's structure (docs/domain.md §7 step 7) and its checks (§7 step 6, lib/report/headings.ts):
//   General        from org settings: designate title, mailing address, phone, email, how to ask for alternate formats
//   <plan area>    one h2 per area of the org's plan (canonical ACA text, ACA order): the lead's text (a placeholder
//                  while empty) and the cited "Feedback received in this area: N"
//   Consultations  the lead's text (a placeholder while empty)
//   Feedback       the generated, cited claims
// Placeholders are warnings, not heading failures. The settings are frozen into the content when the draft is built,
// so later checks of this draft use the same settings (a settings change needs a new draft). Pure and client-safe.
import { AREA_HEADINGS, PRIORITY_AREAS, REQUIRED_FIXED_HEADINGS, checkProgressReport, passes, type CheckResult, type DraftSection, type OrgReportSettings, type PriorityArea } from "./headings";
import { reportPeriodLabel } from "./period";
import { exportBlockers, type ExportBlocker } from "./validate";
import type { PhraseMeta, ReportBlock, ReportClaim, ReportContent, ReportPeriod, ReportSection, ReportSentence, ReportSettings, ReportSnapshot, SectionKey, SnapshotCase } from "./types";

/** The h3s of the Feedback section. Plain headings: never wrap them in a named region (demo.spec "Feedback" region). */
export const FEEDBACK_SUBHEADINGS = {
  outcome: "What happened to the feedback",
  followup: "How we followed up",
  consideration: "How feedback was taken into consideration",
} as const;

/** The plan areas a draft has sections for: the org's areas, once each, in ACA s.5 order. */
export function planAreasOf(areas: readonly PriorityArea[]): PriorityArea[] {
  const set = new Set(areas);
  return PRIORITY_AREAS.filter((a) => set.has(a));
}

/** The settings a draft is built from (orgs row + the public form's address). */
export function reportSettings(
  org: { name: string; slug: string; planAreas: readonly PriorityArea[]; feedbackDesignateTitle: string; contactMailingAddress: string; contactPhone: string; contactEmail: string },
  formUrl: string,
): ReportSettings {
  return {
    orgName: org.name,
    slug: org.slug,
    planAreas: planAreasOf(org.planAreas),
    feedbackDesignateTitle: org.feedbackDesignateTitle.trim(),
    contactMailingAddress: org.contactMailingAddress.trim(),
    contactPhone: org.contactPhone.trim(),
    contactEmail: org.contactEmail.trim(),
    formUrl,
  };
}

/** What lib/report/headings.ts checks the draft against. */
export function checkSettings(s: ReportSettings): OrgReportSettings {
  return {
    planAreas: s.planAreas,
    feedbackDesignateTitle: s.feedbackDesignateTitle,
    contactMailingAddress: s.contactMailingAddress,
    contactPhone: s.contactPhone,
    contactEmail: s.contactEmail,
  };
}

/** The General section (ACR s.14(2)): the org's own words and contact details, verbatim. */
export function generalSentences(s: ReportSettings, period: ReportPeriod): string[] {
  const label = reportPeriodLabel(period);
  return [
    /^\d{4}$/.test(label) ? `This report covers feedback received in ${label}.` : `This report covers feedback received from ${label}.`,
    `${/^the\s/i.test(s.feedbackDesignateTitle) ? "" : "The "}${s.feedbackDesignateTitle} receives feedback on behalf of ${s.orgName}.`,
    "To give feedback, or to ask for this report or a description of our feedback process in an alternate format " +
      "(print, large print, braille, audio, or an electronic format that works with assistive technology), contact us " +
      `by mail at ${s.contactMailingAddress}, by phone at ${s.contactPhone}, or by email at ${s.contactEmail}.`,
    `You can also give feedback online at ${s.formUrl}, and you can stay anonymous.`,
  ];
}

/** The hint shown in a section the lead still has to write (and the label of its text box). */
export function leadPrompt(key: SectionKey): string {
  if (key === "consultations") return "Describe how you consulted persons with disabilities in preparing this report (ACA s.71(4)).";
  if (key.startsWith("area:")) {
    const area = key.slice("area:".length) as PriorityArea;
    return `Describe your progress on ${AREA_HEADINGS[area].canonical.charAt(0).toLowerCase()}${AREA_HEADINGS[area].canonical.slice(1)} in this period.`;
  }
  return "";
}

/**
 * Put the validated sentences into the §7.7 structure. `claims` say where each sentence goes; `sentences` are
 * chooseSentences' output for the same claims.
 */
export function buildContent(
  settings: ReportSettings,
  period: ReportPeriod,
  claims: readonly ReportClaim[],
  sentences: readonly ReportSentence[],
  phrase: Omit<PhraseMeta, "fallbacks">,
): ReportContent {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const placed = (place: ReportClaim["place"]) =>
    claims.filter((c) => c.place === place).map((c) => byId.get(c.claimId)).filter((s): s is ReportSentence => !!s);
  const claimBlocks = (list: ReportSentence[]): ReportBlock[] => list.map((sentence) => ({ kind: "claim", sentence }));

  const sections: ReportSection[] = [
    { key: "general", heading: REQUIRED_FIXED_HEADINGS.general, level: 2, blocks: generalSentences(settings, period).map((text) => ({ kind: "org", text })) },
  ];
  for (const a of settings.planAreas) {
    sections.push({ key: `area:${a}`, heading: AREA_HEADINGS[a].canonical, level: 2, blocks: [{ kind: "lead" }, ...claimBlocks(placed(`area:${a}`))] });
  }
  sections.push({ key: "consultations", heading: REQUIRED_FIXED_HEADINGS.consultations, level: 2, blocks: [{ kind: "lead" }] });

  const feedback: ReportBlock[] = [...claimBlocks(placed("feedback:intro"))];
  const outcome = placed("feedback:outcome");
  if (outcome.length) feedback.push({ kind: "subheading", text: FEEDBACK_SUBHEADINGS.outcome }, ...claimBlocks(outcome));
  const followup = placed("feedback:followup");
  if (followup.length) feedback.push({ kind: "subheading", text: FEEDBACK_SUBHEADINGS.followup }, ...claimBlocks(followup));
  const consideration = placed("feedback:consideration");
  if (consideration.length) {
    const cases = consideration.filter((s) => s.id.startsWith("C:F_CASE:"));
    const others = consideration.filter((s) => !s.id.startsWith("C:F_CASE:"));
    feedback.push({ kind: "subheading", text: FEEDBACK_SUBHEADINGS.consideration }, ...claimBlocks(others));
    if (cases.length) feedback.push({ kind: "claimList", sentences: cases });
  }
  sections.push({ key: "feedback", heading: REQUIRED_FIXED_HEADINGS.feedback, level: 2, blocks: feedback });

  return { version: 1, settings, sections, phrase: { ...phrase, fallbacks: sentences.filter((s) => s.fallback).length } };
}

/** The lead's text for a section ("" when none). `areaText` is keyed by priority area. */
export function leadTextFor(key: SectionKey, areaText: Readonly<Record<string, string>>, consultationsText: string | null): string {
  if (key === "consultations") return consultationsText ?? "";
  if (key.startsWith("area:")) return areaText[key.slice("area:".length)] ?? "";
  return "";
}

/** The draft as lib/report/headings.ts reads it: one entry per h2, its plain text, and whether it is a placeholder. */
export function toDraftSections(
  content: Pick<ReportContent, "sections">,
  areaText: Readonly<Record<string, string>>,
  consultationsText: string | null,
): DraftSection[] {
  return content.sections.map((s) => {
    const lead = leadTextFor(s.key, areaText, consultationsText).trim();
    const parts: string[] = [];
    for (const b of s.blocks) {
      if (b.kind === "org") parts.push(b.text);
      else if (b.kind === "lead") {
        if (lead) parts.push(lead);
      } else if (b.kind === "claim") parts.push(b.sentence.text);
      else if (b.kind === "claimList") parts.push(...b.sentences.map((x) => x.text));
    }
    const writable = s.blocks.some((b) => b.kind === "lead");
    return { heading: s.heading, level: s.level, text: parts.join(" "), ...(writable ? { placeholder: !lead } : {}) };
  });
}

export interface ReportChecks {
  /** checkProgressReport over the draft (store as reports.heading_check). */
  results: CheckResult[];
  /** Every required (error-level) check passes. */
  passes: boolean;
  /** Sections the lead still has to write (plan areas and Consultations). */
  toWrite: number;
  /** Sentences without sources or blocked by the validator: they block sign-off and export. */
  blockers: ExportBlocker[];
  /** passes, nothing left to write, no blockers (docs/decisions.md: sign-off needs all three). */
  canSignOff: boolean;
}

/** The live checklist of a draft (domain §7 step 6), from the settings frozen in its content. */
export function reportChecks(content: ReportContent, areaText: Readonly<Record<string, string>>, consultationsText: string | null): ReportChecks {
  const draft = toDraftSections(content, areaText, consultationsText);
  const results = checkProgressReport(draft, checkSettings(content.settings));
  const toWrite = draft.filter((d) => d.placeholder).length;
  const blockers = exportBlockers(content);
  const ok = passes(results);
  return { results, passes: ok, toWrite, blockers, canSignOff: ok && toWrite === 0 && blockers.length === 0 };
}

/** The snapshot cases behind a sentence (the union of its facts' cases), in snapshot order: its Sources list. */
export function sentenceSources(sentence: Pick<ReportSentence, "factIds">, snapshot: Pick<ReportSnapshot, "facts" | "cases">): SnapshotCase[] {
  const ids = new Set(snapshot.facts.filter((f) => sentence.factIds.includes(f.id)).flatMap((f) => f.caseIds));
  return snapshot.cases.filter((c) => ids.has(c.id));
}

/** Every case the report's sentences cite, in snapshot order: the rows of /verify's "Records" table (domain §8). */
export function citedCaseIds(content: Pick<ReportContent, "sections">, snapshot: Pick<ReportSnapshot, "facts" | "cases">): string[] {
  const cited = new Set<string>();
  for (const sec of content.sections) {
    for (const b of sec.blocks) {
      const list = b.kind === "claim" ? [b.sentence] : b.kind === "claimList" ? b.sentences : [];
      for (const s of list) for (const f of snapshot.facts) if (s.factIds.includes(f.id)) for (const id of f.caseIds) cited.add(id);
    }
  }
  return snapshot.cases.filter((c) => cited.has(c.id)).map((c) => c.id);
}
