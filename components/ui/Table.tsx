import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./cx";

interface TableProps {
  /** Unique on the page: the scroll region is labelled by the caption (`${id}-caption`). */
  id: string;
  /** Every table has a caption. It also names the scroll region, so keep it unique on the page. */
  caption: ReactNode;
  /** Hide the caption visually when a heading right above already says the same thing. */
  captionHidden?: boolean;
  /** Extra line under the caption (e.g. "16 cases, newest first"). */
  description?: ReactNode;
  density?: "comfortable" | "compact";
  children: ReactNode;
  className?: string;
}

/**
 * A real <table> inside a focusable, labelled scroll region: wide tables scroll inside the region,
 * never the page (reflow at 320px, axe scrollable-region-focusable). Build rows with THead/TBody/Tr/Th/Td.
 * Region names must not collide with the e2e region names (see components/ui/README.md).
 */
export function Table({ id, caption, captionHidden, description, density = "comfortable", children, className }: TableProps) {
  const captionId = `${id}-caption`;
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      tabIndex={0}
      className={cx(
        "al-table-scroll max-w-full overflow-x-auto rounded-lg border border-border bg-surface",
        density === "compact" ? "[--cell-py:0.5rem]" : "[--cell-py:0.875rem]",
        className,
      )}
    >
      {/* relative: screen-reader-only text inside cells (VisuallyHidden is position:absolute) is positioned in the
          table, inside this scroll region, so it can never widen the page at 320px. */}
      <table id={id} className="relative w-full border-collapse text-left text-body tabular-nums">
        {/* The caption is as wide as the table: on a phone, where the table scrolls sideways, its lines wrap within
            the visible part of the scroll region (the page gutters, the region's border and the caption's padding). */}
        <caption id={captionId} className={cx(captionHidden ? "sr-only" : "px-4 pt-4 pb-3 text-left")}>
          <span className="block max-w-[calc(100vw_-_5rem)] font-bold text-ink">{caption}</span>
          {description ? (
            <span className="mt-0.5 block max-w-[calc(100vw_-_5rem)] text-small font-normal text-ink-muted">{description}</span>
          ) : null}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-y border-border bg-surface-sunken">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border">{children}</tbody>;
}

export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx("align-middle", className)}>{children}</tr>;
}

type ThProps = Omit<ThHTMLAttributes<HTMLTableCellElement>, "scope"> & {
  /** "col" for header-row cells, "row" for the first cell of a body row. */
  scope?: "col" | "row" | "colgroup" | "rowgroup";
  numeric?: boolean;
};

export function Th({ scope = "col", numeric, className, children, ...rest }: ThProps) {
  const isCol = scope === "col" || scope === "colgroup";
  return (
    <th
      scope={scope}
      className={cx(
        "px-4 py-[var(--cell-py)]",
        isCol ? "text-small font-bold text-ink-muted whitespace-nowrap" : "font-bold text-ink",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({ numeric, className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cx("px-4 py-[var(--cell-py)] text-ink", numeric && "text-right tabular-nums", className)} {...rest}>
      {children}
    </td>
  );
}
