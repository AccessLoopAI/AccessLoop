import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { LoopMark } from "@/components/ui/LoopRing";

/**
 * On every page (reporter, staff, error pages): how AccessLoop handles a report, and its own accessibility notes
 * (with the way to report a problem with this site). Same names and order everywhere (WCAG 3.2.3, 3.2.4); /help
 * links them by the same names. Never "Get help": the header has the only one.
 */
const SITE_LINKS = [
  { href: "/trust", label: "Privacy and AI" },
  { href: "/accessibility", label: "Accessibility" },
];

interface SiteFooterProps {
  /** Links before the site links (the reporter shell's "Check your report"). Never "Get help". */
  links?: { href: string; label: string }[];
  children?: ReactNode;
  wide?: boolean;
}

export function SiteFooter({ links = [], children, wide = false }: SiteFooterProps) {
  const all = [...links, ...SITE_LINKS];
  return (
    <footer data-print-hide className="mt-auto border-t border-border">
      <div
        className={cx(
          "mx-auto flex w-full flex-col gap-4 px-4 py-8 text-small text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6",
          wide ? "max-w-[90rem]" : "max-w-[72rem]",
        )}
      >
        <p className="flex max-w-[60ch] items-center gap-3">
          <LoopMark size={22} className="text-ink-muted" />
          <span>
            {children ?? "AccessLoop helps organizations meet their Accessible Canada Act feedback obligations."}
            {/* The seeded organizations and people carry no "(fictional)" in their names, so the page says it once here. */}
            <span className="block">The organizations in this prototype are made up.</span>
          </span>
        </p>
        {all.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-x-5 p-0">
            {all.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="inline-flex min-h-11 items-center">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </footer>
  );
}
