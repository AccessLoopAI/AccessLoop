import Link from "next/link";
import { VisuallyHidden } from "../VisuallyHidden";

/** One number in a chart: its count, the inbox link to exactly its cases, and the words a link list needs. */
export interface ChartValue {
  count: number;
  /** inboxHref(set.filter); null when there is nothing to open (a zero). */
  href: string | null;
  /** Said after the number by screen readers ("cases reported in March 2026"), so a link list makes sense. */
  sr: string;
}

/**
 * A count in a chart's data table: a link to the filtered inbox (the cases behind it), or plain "0". The visible
 * text is the number alone; the hidden words keep the link's purpose clear out of the table (WCAG 2.4.4) and start
 * with the visible label (2.5.3).
 */
export function CountLink({ value }: { value: ChartValue }) {
  if (!value.href || value.count === 0) {
    return (
      <span>
        {value.count}
        <VisuallyHidden>{` ${value.sr}`}</VisuallyHidden>
      </span>
    );
  }
  return (
    // 44 x 44 px at least (a one-digit count is narrow), the number kept right-aligned with its column.
    <Link href={value.href} className="inline-flex min-h-11 min-w-11 items-center justify-end font-bold">
      <span>
        {value.count}
        <VisuallyHidden>{` ${value.sr}`}</VisuallyHidden>
      </span>
    </Link>
  );
}
