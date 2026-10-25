"use client";

// After a client-side navigation (a link, or a server action that redirects, such as "Sign in as …"), the
// element that had focus is gone and focus falls to <body>. Move it to the new page's h1, so keyboard and
// screen-reader users start at the top of the new page (CLAUDE.md: "After every step change or submit, move
// focus to the new heading"). Mounted once in the root layout, so it survives the navigation. The first render
// is skipped: a fresh page load keeps the browser's own focus (and the skip link first in the Tab order).
// PageHeader renders the h1 with tabindex -1, and every shell renders <main id="main" tabIndex={-1}>.
// A change of the query string alone is a navigation too (the inbox's "Clear filters", a dashboard number that
// opens the filtered inbox from the inbox): the link that had focus may be gone, so focus moves the same way.
// app/layout.tsx wraps this in <Suspense> (useSearchParams).
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export function RouteFocus() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;
  const last = useRef(url);
  useEffect(() => {
    if (last.current === url) return;
    last.current = url;
    const target = document.querySelector<HTMLElement>('main h1[tabindex="-1"]') ?? document.getElementById("main");
    target?.focus();
  }, [url]);
  return null;
}
