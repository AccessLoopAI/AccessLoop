// The body of a progress report as a publication (docs/domain.md §7 steps 7 and 9), shared by the staff draft
// (/app/reports/[id]) and the public page (/p/[orgSlug]/reports/[id]). Built only from components/ui primitives.
//   - one <section aria-labelledby> + <h2> per section, the h2 text exactly the stored heading ("General", an area's
//     canonical ACA heading, "Consultations", "Feedback"), so each section is a region named by its heading;
//   - h3 sub-headings inside Feedback are plain headings, NEVER regions (their text says "feedback", and demo.spec
//     needs exactly one region whose name contains "Feedback");
//   - every generated sentence is a SourceNote (footnote button + "Sources" list);
//   - the lead's text (or its text box) comes from the page through `lead`.
// Server component: `lead` may return client components (the draft's text boxes).
import type { CSSProperties, ReactNode } from "react";
import { SourceNote, SourcesProvider } from "@/components/ui/SourceNote";
import { leadParagraphs, type ReportView, type SectionView } from "@/lib/report/view";

export function sectionDomId(key: string): string {
  return `section-${key.replace(/[^a-z0-9]+/gi, "-")}`;
}

interface ReportBodyProps {
  view: ReportView;
  /** What a section's lead block shows: the text, a placeholder, or the lead's text box. */
  lead: (section: SectionView) => ReactNode;
  /** Staff pages: each source ref links to its case. */
  caseLinkBase?: string;
  /** Staff pages: the ACR/ACA reason under each heading. */
  showCitations?: boolean;
}

export function ReportBody({ view, lead, caseLinkBase, showCitations }: ReportBodyProps) {
  return (
    <SourcesProvider records={view.cases.map((c) => ({ ref: c.ref, summary: c.summary, statusLabel: c.statusLabel, status: c.status }))} linkBase={caseLinkBase}>
      <div className="al-report">
        {view.sections.map((s, i) => {
          const id = sectionDomId(s.key);
          return (
            <section key={s.key} aria-labelledby={`${id}-title`} id={id} className="al-report-section" style={{ "--i": i } as CSSProperties}>
              <header className="al-report-section-head">
                <h2 id={`${id}-title`}>{s.heading}</h2>
                {showCitations ? <p className="al-report-cite">{s.citation}</p> : null}
              </header>
              {s.blocks.map((b, j) => {
                if (b.kind === "org") return <p key={j} className="al-report-p">{b.text}</p>;
                if (b.kind === "lead") return <div key={j}>{lead(s)}</div>;
                if (b.kind === "subheading") return <h3 key={j} className="al-report-h3">{b.text}</h3>;
                if (b.kind === "claim") return <SourceNote key={b.sentence.id} text={b.sentence.text} sources={b.sentence.sources} blocked={b.sentence.blocked} />;
                return (
                  <ul key={j} className="al-report-list">
                    {b.sentences.map((x) => (
                      <li key={x.id}>
                        <SourceNote text={x.text} sources={x.sources} blocked={x.blocked} />
                      </li>
                    ))}
                  </ul>
                );
              })}
            </section>
          );
        })}
      </div>
    </SourcesProvider>
  );
}

/** The lead's text as the published report shows it, or (on a draft) a placeholder saying what is still to write. */
export function LeadText({ text, hint, draft }: { text: string; hint: string; draft: boolean }) {
  const paras = leadParagraphs(text);
  if (paras.length) {
    return (
      <div className="al-lead-text">
        {paras.map((p, i) => (
          <p key={i} className="al-report-p whitespace-pre-line">
            {p}
          </p>
        ))}
      </div>
    );
  }
  if (!draft) return null;
  return (
    <div className="al-lead-placeholder">
      <p>
        <strong>Still to write.</strong> {hint}
      </p>
    </div>
  );
}
