// Which staff tab is current (pure, so tests can check it). Not a component file: no "use client".

export interface StaffNavItem {
  href: string;
  label: string;
  /**
   * Path prefixes of the pages that belong to this tab's section without being under its href, e.g. a case page
   * ("/app/cases/BAR-0001") is part of the lead's Inbox and of the owner's My work (the case page's back link).
   */
  section?: string[];
}

/**
 * The current tab for `pathname`: "page" for the tab whose own page (or a page under it) is shown; else "true"
 * for the tab whose section the page belongs to (a case page: aria-current="page" would claim the tab IS this
 * page); else none. A tab's own page always wins, so /app/cases/new marks only "Log feedback".
 */
export function staffNavCurrent(items: StaffNavItem[], pathname: string): { index: number; kind: "page" | "true" } | null {
  const own = items.findIndex((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  if (own >= 0) return { index: own, kind: "page" };
  const section = items.findIndex((item) => item.section?.some((prefix) => pathname.startsWith(prefix)));
  return section >= 0 ? { index: section, kind: "true" } : null;
}
