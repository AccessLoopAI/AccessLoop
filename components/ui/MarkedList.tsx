import type { ReactNode } from "react";
import { Check, CircleDashed, TriangleAlert } from "lucide-react";
import { cx } from "./cx";
import { Icon, type Glyph } from "./Icon";

/** What every item of the list is: built and checked, not done yet, or a known problem. */
export type ListMark = "done" | "not-yet" | "known-issue";

const MARKS: Record<ListMark, { icon: Glyph; tone: string }> = {
  done: { icon: Check, tone: "text-success" },
  "not-yet": { icon: CircleDashed, tone: "text-ink-muted" },
  "known-issue": { icon: TriangleAlert, tone: "text-warning" },
};

interface MarkedListProps {
  mark: ListMark;
  /** One entry per item; each is a sentence or a short block (a bold lead-in plus text). */
  items: { key: string; content: ReactNode }[];
  className?: string;
}

/**
 * A list whose marker says what kind of items it holds (the /accessibility page's "built in", "not tested yet" and
 * "problems we know about"). The icon is decorative and the same for every item: the list's heading carries the
 * meaning in words, never the icon or its colour alone.
 */
export function MarkedList({ mark, items, className }: MarkedListProps) {
  const m = MARKS[mark];
  return (
    <ul data-mark={mark} className={cx("m-0 grid list-none gap-4 p-0", className)}>
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
          <span className={cx("pt-[0.2em]", m.tone)}>
            <Icon icon={m.icon} size="1.25em" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">{item.content}</div>
        </li>
      ))}
    </ul>
  );
}
