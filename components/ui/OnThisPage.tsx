import { cx } from "./cx";

export interface OnThisPageItem {
  /** "#section-id" of an h2 (or the section that holds it) on the same page. */
  href: `#${string}`;
  label: string;
}

interface OnThisPageProps {
  items: OnThisPageItem[];
  /** Id of the nav; its visible heading gets `${id}-title` and names the landmark. */
  id?: string;
  className?: string;
}

/**
 * The contents of a long reading page (/trust, /accessibility): a navigation landmark named by its visible
 * heading "On this page", with one link per section in reading order (WCAG 2.4.5 multiple ways, 2.4.1). Each link is
 * a 44px-tall row, not an inline text link. Two columns from sm. Never put "Get help" here: the header has the only one.
 */
export function OnThisPage({ items, id = "on-this-page", className }: OnThisPageProps) {
  const titleId = `${id}-title`;
  return (
    <nav id={id} aria-labelledby={titleId} className={cx("border-l-4 border-border-strong py-1 pl-5", className)}>
      <h2 id={titleId} className="font-sans text-body font-bold tracking-normal">
        On this page
      </h2>
      <ol className="m-0 mt-1 grid list-none gap-x-8 p-0 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.href}>
            <a href={item.href} className="inline-flex min-h-11 items-center py-1">
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
