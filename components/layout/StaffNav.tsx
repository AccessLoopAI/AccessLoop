"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";
import { staffNavCurrent, type StaffNavItem } from "./staff-nav-current";

export type { StaffNavItem };

/**
 * Staff primary navigation: the second row of the staff header, as tabs. The current tab gets aria-current="page"
 * (or "true" for the tab whose section a page belongs to, like a case page under the Inbox) and a visible bar (a
 * shape, not only a colour; app/globals.css keeps the bar in forced-colors mode through the `al-staff-nav` hook).
 */
export function StaffNav({ items }: { items: StaffNavItem[] }) {
  const pathname = usePathname();
  if (items.length === 0) return null;
  const active = staffNavCurrent(items, pathname);
  return (
    <nav aria-label="Staff" className="al-staff-nav min-w-0">
      {/* Phones: an even grid of tabs (four to a row at 390px, three at 320px) instead of a ragged wrap into three
          rows; a long name ("Log feedback") wraps inside its tab. From sm: one row, and sm:-ml-3 lines the first
          tab's text up with the brand above it (the links keep their 12px padding). */}
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(5.25rem,1fr))] p-0 sm:-ml-3 sm:flex sm:flex-wrap sm:gap-x-1">
        {items.map((item, i) => {
          const current = active?.index === i;
          return (
            <li key={item.href} className="grid sm:block">
              <Link
                href={item.href}
                aria-current={current ? active.kind : undefined}
                className={cx(
                  "relative inline-flex min-h-11 items-center justify-center rounded-sm px-1.5 py-1 text-center text-ui-sm leading-tight font-bold no-underline hover:no-underline",
                  "sm:justify-start sm:px-3 sm:py-0 sm:text-left sm:text-ui",
                  current
                    ? "text-chrome-ink after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-pill after:bg-[var(--chrome-focus)] sm:after:inset-x-3"
                    : "text-chrome-muted hover:text-chrome-ink",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
