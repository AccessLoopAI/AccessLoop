import type { ReactNode } from "react";
import { cx } from "./cx";

interface ReadingSectionProps {
  /** The `#id` an OnThisPage link points to. */
  id: string;
  /** The section's h2 (visible text; OnThisPage may use a shorter label for the same section). */
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * One part of a long reading page (/trust, /accessibility): a `<section id>` with its h2, then the content on the
 * page's stack. Deliberately NOT a named region (no aria-labelledby): a page of a dozen regions is noise for screen
 * reader users, and an unnamed section can never collide with an accessible name the e2e tests rely on
 * (components/ui/README.md "Rules for pages"). The h2 is the way in, from the heading list or OnThisPage.
 */
export function ReadingSection({ id, title, children, className }: ReadingSectionProps) {
  return (
    <section id={id} className={cx("grid gap-4", className)}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
