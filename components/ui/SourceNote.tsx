"use client";

// A generated report sentence with its footnote-style sources (docs/domain.md §7 step 9, CLAUDE.md "Generated
// reports"): the sentence, then a <button aria-expanded> named exactly "Sources for this sentence (N records)" that
// opens an in-page list named "Sources" (case refs and lead-approved public summaries). The visible button text IS
// its accessible name (no aria-label). In a wide report column the button and its card sit in the margin beside the
// sentence; in a narrow one they drop under it (CSS container query in app/globals.css, `.al-sourced`). The DOM order
// is always sentence, button, card. A closed card is `hidden` and its list is not even rendered, so a sentence that
// cites every case of the period (hundreds on a busy org) costs nothing until it is opened.
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { BookMarked } from "lucide-react";
import { noSummaryWords, sourcesButtonName } from "@/lib/report/labels";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { RedactedText } from "./RedactedText";

/** One record a sentence cites. */
export interface SourceRecord {
  ref: string;
  /** The lead-approved public summary (null: not reviewed yet when the report was built). */
  summary: string | null;
  /** The case's staff status label when the report was built. */
  statusLabel: string;
  /** Its status key then ("closed", ...): a closed case with no summary says so instead of "Waiting for review". */
  status?: string;
}

interface SourcesValue {
  records: readonly SourceRecord[];
  /** Staff pages: each ref links to its case ("Open BAR-0012") at linkBase + ref. Public pages: plain text. */
  linkBase?: string;
}

const SourcesContext = createContext<SourcesValue>({ records: [] });

/** Holds a report's records once; every SourceNote inside refers to them by index. */
export function SourcesProvider({ records, linkBase, children }: SourcesValue & { children: ReactNode }) {
  return <SourcesContext.Provider value={{ records, linkBase }}>{children}</SourcesContext.Provider>;
}

/** How many refs the print-only "Sources:" line spells out before "and N more". */
const PRINT_REFS = 12;
/** Lists longer than this scroll inside the card. */
const SCROLL_AFTER = 8;

interface SourceNoteProps {
  /** The sentence, as stored (plain text). */
  text: string;
  /** Indexes into the provider's records. */
  sources: readonly number[];
  /** The validator refused even this sentence's template: say so (staff only; sign-off is blocked). */
  blocked?: boolean;
  className?: string;
}

export function SourceNote({ text, sources, blocked, className }: SourceNoteProps) {
  const { records, linkBase } = useContext(SourcesContext);
  const [open, setOpen] = useState(false);
  const uid = useId().replace(/:/g, "");
  const panelId = `sources-${uid}`;
  const labelId = `sources-${uid}-label`;
  const cited = sources.map((i) => records[i]).filter((r): r is SourceRecord => !!r);
  const n = cited.length;
  const scroll = n > SCROLL_AFTER;
  const printRefs = cited.slice(0, PRINT_REFS).map((r) => r.ref).join(", ");

  return (
    <div className={cx("al-sourced", className)} data-open={open || undefined}>
      <p className="al-sourced-text">
        {text}
        {blocked ? <span className="al-sourced-blocked"> (This sentence did not pass the sentence checks, so sign-off is blocked.)</span> : null}
      </p>
      <div className="al-sourced-note">
        <button type="button" aria-expanded={open} aria-controls={panelId} className="al-footnote al-hit-44" onClick={() => setOpen((o) => !o)}>
          <Icon icon={BookMarked} size="1.05em" />
          <span>{sourcesButtonName(n)}</span>
        </button>
        <div id={panelId} hidden={!open} className="al-source-card">
          <p id={labelId} className="al-subhead">
            Sources
          </p>
          {!open ? null : n === 0 ? (
            <p className="mt-1">No records: this sentence counts none, so there is nothing to list.</p>
          ) : (
            <ul
              aria-labelledby={labelId}
              className={cx("al-source-list", scroll && "al-source-list-scroll")}
              // A list that scrolls must be reachable by keyboard (axe scrollable-region-focusable); on staff pages
              // its links already are.
              tabIndex={scroll && !linkBase ? 0 : undefined}
            >
              {cited.map((r) => (
                <li key={r.ref} className="al-source">
                  {linkBase ? (
                    <a href={`${linkBase}${encodeURIComponent(r.ref)}`} className="al-source-ref">
                      <span className="al-source-open">Open </span>
                      {r.ref}
                    </a>
                  ) : (
                    <span className="al-source-ref">{r.ref}</span>
                  )}
                  {r.summary ? <RedactedText as="span" text={r.summary} className="al-source-summary" /> : <span className="al-source-summary text-ink-muted">{noSummaryWords(r.status)}</span>}
                  <span className="al-source-status">{r.statusLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {/* Print only (display: none on screen, so it is out of the accessibility tree there). */}
      <p className="al-print-sources">
        Sources: {n === 0 ? "none" : printRefs}
        {n > PRINT_REFS ? ` and ${n - PRINT_REFS} more (all are listed in the plain-text version)` : ""}
      </p>
    </div>
  );
}
