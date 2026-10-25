// FROZEN. ACR SOR/2021-241 s.14 progress-report rule checker. Pure, deterministic, no AI.
// Reference text: docs/domain.md §1.4. Heading strings for (a),(c),(d) are verbatim from the regulation.

export const PRIORITY_AREAS = [
  "employment", "built_environment", "ict", "communication_other",
  "procurement", "programs_services", "transportation",
] as const;
export type PriorityArea = (typeof PRIORITY_AREAS)[number];

/** Canonical heading text (ACA s.5 wording) + accepted aliases, all compared case-insensitively. */
export const AREA_HEADINGS: Record<PriorityArea, { canonical: string; aliases: string[]; acaPara: string }> = {
  employment: { canonical: "Employment", aliases: [], acaPara: "5(a)" },
  built_environment: { canonical: "The built environment", aliases: ["Built environment"], acaPara: "5(b)" },
  ict: { canonical: "Information and communication technologies",
    aliases: ["Information and communication technologies (ICT)", "ICT"], acaPara: "5(c)" },
  communication_other: { canonical: "Communication, other than information and communication technologies",
    aliases: ["Communication other than ICT", "Communication, other than ICT", "Communication"], acaPara: "5(c.1)" },
  procurement: { canonical: "The procurement of goods, services and facilities",
    aliases: ["Procurement of goods, services and facilities", "Procurement"], acaPara: "5(d)" },
  programs_services: { canonical: "The design and delivery of programs and services",
    aliases: ["Design and delivery of programs and services", "Programs and services"], acaPara: "5(e)" },
  transportation: { canonical: "Transportation", aliases: [], acaPara: "5(f)" },
};

export const REQUIRED_FIXED_HEADINGS = { general: "General", consultations: "Consultations", feedback: "Feedback" } as const;

export interface DraftSection {
  heading: string;
  level: number;         // must be 2 for required headings
  text: string;          // plain text of the section body (sentences joined)
  placeholder?: boolean; // true while the lead still has to write this section
}

export interface OrgReportSettings {
  planAreas: PriorityArea[];
  feedbackDesignateTitle: string;
  contactMailingAddress: string;
  contactPhone: string;
  contactEmail: string;
}

export interface CheckResult {
  id: string;
  ok: boolean;
  severity: "error" | "warning";
  label: string;        // plain-language, shown in the checklist
  citation: string;     // e.g. "ACR s.14(1)(a)"
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[“”"]/g, "").trim();

function find(sections: DraftSection[], names: string[]): DraftSection | undefined {
  const wanted = names.map(norm);
  return sections.find((s) => wanted.includes(norm(s.heading)));
}

export function checkProgressReport(sections: DraftSection[], org: OrgReportSettings): CheckResult[] {
  const out: CheckResult[] = [];
  const headingRule = (id: string, label: string, citation: string, names: string[]) => {
    const s = find(sections, names);
    out.push({ id, ok: !!s && s.level === 2, severity: "error", citation,
      label: s && s.level !== 2 ? `${label} (must be a level-2 heading)` : label });
    return s;
  };

  // R1
  const general = headingRule("R1", 'Has the heading "General"', "ACR s.14(1)(a)", [REQUIRED_FIXED_HEADINGS.general]);
  // R2 — one per plan area
  for (const area of org.planAreas) {
    const h = AREA_HEADINGS[area];
    const s = headingRule(`R2:${area}`, `Has a heading for "${h.canonical}"`, `ACR s.14(1)(b); ACA s.${h.acaPara}`,
      [h.canonical, ...h.aliases]);
    if (s?.placeholder) out.push({ id: `W:${area}`, ok: false, severity: "warning", citation: "ACR s.14(1)(b)",
      label: `"${h.canonical}" still needs your progress text` });
  }
  // R3
  const consult = headingRule("R3", 'Has the heading "Consultations"', "ACR s.14(1)(c)", [REQUIRED_FIXED_HEADINGS.consultations]);
  if (consult?.placeholder) out.push({ id: "W:consultations", ok: false, severity: "warning", citation: "ACA s.71(4)",
    label: "Describe how you consulted persons with disabilities for this report" });
  // R4
  const feedback = headingRule("R4", 'Has the heading "Feedback"', "ACR s.14(1)(d)", [REQUIRED_FIXED_HEADINGS.feedback]);
  if (feedback && !feedback.text.trim()) out.push({ id: "R4:body", ok: false, severity: "error", citation: "ACA s.71(5)",
    label: "Feedback section describes the feedback received and how it was taken into consideration" });

  // R5 — "General" contents
  const g = general ? norm(general.text) : "";
  const contains = (v: string) => !!v.trim() && g.includes(norm(v));
  out.push({ id: "R5:title", ok: contains(org.feedbackDesignateTitle), severity: "error", citation: "ACR s.14(2)",
    label: "General names the position title of the person who receives feedback" });
  out.push({ id: "R5:mail", ok: contains(org.contactMailingAddress), severity: "error", citation: "ACR s.14(2)",
    label: "General gives a mailing address" });
  out.push({ id: "R5:phone", ok: contains(org.contactPhone), severity: "error", citation: "ACR s.14(2)",
    label: "General gives a telephone number" });
  out.push({ id: "R5:email", ok: contains(org.contactEmail), severity: "error", citation: "ACR s.14(2)",
    label: "General gives an email address" });
  out.push({ id: "R5:formats", ok: /alternat(e|ive) format|large print|braille|audio/.test(g), severity: "error",
    citation: "ACR s.14(2)(a)-(b)", label: "General explains how to ask for this report or the feedback process in another format" });

  // Warning only: order (the regulation lists headings but does not mandate order)
  const idx = (s?: DraftSection) => (s ? sections.indexOf(s) : -1);
  if (general && feedback && idx(general) > idx(feedback)) {
    out.push({ id: "W:order", ok: false, severity: "warning", citation: "ACR s.14(1)",
      label: '"General" usually comes first' });
  }
  return out;
}

export const passes = (results: CheckResult[]) => results.every((r) => r.ok || r.severity === "warning");
