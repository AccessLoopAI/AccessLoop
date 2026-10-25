import type { ReactNode } from "react";
import { cx } from "./cx";

interface QuoteProps {
  /** The quoted words, exactly as the source has them (legal text: copy it from docs/domain.md §1, never paraphrase). */
  children: ReactNode;
  /** Where the words come from: the link text names the source ("Accessible Canada Regulations, section 19"). */
  source: { href: string; label: string };
  className?: string;
}

/**
 * A quotation set apart from the page's own words (the ACR s.19 retention rule on /trust): `<figure>` with a
 * `<blockquote cite>` and a `<figcaption>` that links the source. Curly quotation marks are added around the words,
 * so the quote is marked in text, not by the rule on its left alone. The source link stands on its own line, so it
 * gets a 44px target like any link that is not inside a sentence.
 */
export function Quote({ children, source, className }: QuoteProps) {
  return (
    <figure className={cx("m-0 grid gap-2 border-l-4 border-primary py-1 pl-5", className)}>
      <blockquote cite={source.href} className="m-0 font-display text-lead">
        <p>&ldquo;{children}&rdquo;</p>
      </blockquote>
      <figcaption className="text-small">
        <a href={source.href} className="inline-flex min-h-11 items-center">
          {source.label}
        </a>
      </figcaption>
    </figure>
  );
}
