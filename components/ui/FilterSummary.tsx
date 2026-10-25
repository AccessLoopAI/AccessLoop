import type { ReactNode } from "react";
import { X } from "lucide-react";
import { ButtonLink } from "./ButtonLink";
import { cx } from "./cx";
import { Icon } from "./Icon";

interface FilterSummaryProps {
  /** Unique on the page: the section is labelled by its heading (`${id}-title`). */
  id: string;
  /** The heading (default "Filters"). Never a name the e2e tests use for another element (README). */
  title?: string;
  /** 2 on a page (the inbox); 3 inside a section that already has an h2 (the design page). */
  titleLevel?: 2 | 3;
  /** One line above the list, e.g. "Showing 7 of 17 cases that match all of these:". */
  summary: ReactNode;
  /** The active filters in plain words, one per item. */
  items: string[];
  /** Where "Clear filters" goes (the unfiltered page). */
  clearHref: string;
  clearLabel?: string;
  className?: string;
}

/**
 * The filters a list is narrowed by, written out as text, with one link that clears them all (the inbox reached
 * from a dashboard number). Not a live region: the page reloads on a new filter and focus goes to the h1.
 */
export function FilterSummary({
  id,
  title = "Filters",
  titleLevel = 2,
  summary,
  items,
  clearHref,
  clearLabel = "Clear filters",
  className,
}: FilterSummaryProps) {
  const titleId = `${id}-title`;
  const H = `h${titleLevel}` as const;
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cx("al-card grid gap-3 rounded-lg border border-border bg-surface-sunken p-[var(--card-pad)]", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="grid min-w-0 gap-1">
          <H id={titleId} className="al-subhead">
            {title}
          </H>
          <p className="text-ink">{summary}</p>
        </div>
        <ButtonLink href={clearHref} variant="secondary" iconStart={<Icon icon={X} />}>
          {clearLabel}
        </ButtonLink>
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li
            key={item}
            className="al-chip max-w-full rounded-pill border border-border-strong bg-surface px-3 py-1 text-small text-ink wrap-anywhere"
          >
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
