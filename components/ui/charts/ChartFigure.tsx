"use client";

import { useState, type ReactNode } from "react";
import { Table as TableIcon } from "lucide-react";
import { Button } from "../Button";
import { cx } from "../cx";
import { Icon } from "../Icon";
import { VisuallyHidden } from "../VisuallyHidden";

export interface ChartFigureProps {
  /** Unique on the page: the heading gets `${id}-title`. */
  id: string;
  /** The chart's h2 ("The loop funnel"). Keep it clear of the e2e names in components/ui/README.md. */
  title: string;
  /** One or two plain sentences under the title: what is counted, and the takeaway in words. */
  description?: ReactNode;
  /** The picture: ONE <svg aria-hidden="true"> with no links, no tabindex, no <title>/<desc> (domain §10). */
  chart: ReactNode;
  /** The same data as a real <table> (components/ui/Table): ALWAYS in the DOM; its cells hold the links. */
  table: ReactNode;
  /** The takeaway in words beside the picture on wide screens (above the table on phones). Real text, not a duplicate. */
  aside?: ReactNode;
  /** Extra content under the chart and table (a note, a source). */
  footer?: ReactNode;
  testId?: string;
  className?: string;
}

/**
 * The ONLY chart pattern (docs/domain.md §10). The SVG is decoration for sighted mouse users; the data table next
 * to it is always in the DOM and exposed to screen readers. From md up, the table is visually hidden until "Show as
 * table" is pressed (aria-pressed), or until keyboard focus enters it (so a focused link is never invisible). Below
 * md (phones, and 200%+ zoom) the table is shown and the picture is not. Clicking a bar repeats a table link.
 */
export function ChartFigure({ id, title, description, chart, table, aside, footer, testId, className }: ChartFigureProps) {
  const [tableShown, setTableShown] = useState(false);
  const titleId = `${id}-title`;
  return (
    <div
      id={id}
      data-testid={testId}
      data-table-shown={tableShown || undefined}
      className={cx("al-card al-chart relative flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-[var(--card-pad)]", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="grid min-w-0 max-w-[60ch] flex-1 basis-[20rem] gap-1">
          <h2 id={titleId} className="text-card-title font-sans font-bold tracking-normal">
            {title}
          </h2>
          {description ? <div className="text-small text-ink-muted">{description}</div> : null}
        </div>
        <Button
          variant="secondary"
          aria-pressed={tableShown}
          onClick={() => setTableShown((v) => !v)}
          iconStart={<Icon icon={TableIcon} size="1.15em" />}
          className="al-chart-toggle shrink-0 aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:shadow-[inset_0_0_0_1px_var(--primary)] aria-pressed:hover:bg-primary-soft"
        >
          Show as table
          <VisuallyHidden>{` (${title})`}</VisuallyHidden>
        </Button>
      </div>
      {aside ? (
        <div className="grid items-center gap-x-10 gap-y-4 xl:grid-cols-[minmax(0,42.5rem)_minmax(0,1fr)]">
          <div className="al-chart-plot">{chart}</div>
          <div className="min-w-0">{aside}</div>
        </div>
      ) : (
        <div className="al-chart-plot">{chart}</div>
      )}
      <div className="al-chart-data">{table}</div>
      {footer ? <div className="text-small text-ink-muted">{footer}</div> : null}
    </div>
  );
}
