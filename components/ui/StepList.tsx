import type { ReactNode } from "react";
import { cx } from "./cx";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * A process the reader follows in order (the path a report takes on /trust): numbered discs joined by a rail.
 * Use it only for a real sequence. The number is drawn in the disc (decorative) and also read as "Step N:" at the
 * start of each step's h3, so screen readers get the order even where a styled list loses its numbering.
 */
export function StepList({ children, className }: { children: ReactNode; className?: string }) {
  return <ol className={cx("m-0 grid list-none gap-0 p-0", className)}>{children}</ol>;
}

interface StepListItemProps {
  n: number;
  title: ReactNode;
  children?: ReactNode;
}

export function StepListItem({ n, title, children }: StepListItemProps) {
  return (
    <li className="group relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 pb-10 last:pb-0 sm:gap-x-5">
      <span
        aria-hidden="true"
        className="absolute top-[3.25rem] bottom-2 left-[calc(1.375rem-1px)] w-0.5 bg-border-strong group-last:hidden"
      />
      <span
        aria-hidden="true"
        className="relative flex size-11 items-center justify-center rounded-pill border-2 border-primary bg-surface-raised font-display text-h4 font-bold text-primary"
      >
        {n}
      </span>
      <div className="grid min-w-0 content-start gap-3 pt-1.5">
        <h3>
          <VisuallyHidden>{`Step ${n}: `}</VisuallyHidden>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}
