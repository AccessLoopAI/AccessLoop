import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * A plain bulleted list of short points in reading text (/trust, /accessibility). A native `<ul>` with visible
 * discs in the primary colour (the marker is CSS, so screen readers still announce a list and its length).
 * Children are `<li>` elements. For a list whose marker carries a meaning (done, not yet, known problem), use
 * MarkedList; for a real sequence, StepList.
 */
export function BulletList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx("m-0 grid list-disc gap-2 pl-7 marker:text-primary", className)}>{children}</ul>;
}
