"use client";

import { useEffect } from "react";

/**
 * Keeps `--header-h` (app/globals.css) equal to the sticky header's real height, so `scroll-padding-top` always
 * clears it and focus is never hidden under it (WCAG 2.4.11), even when a long organization or person name makes
 * the header wrap. Without JavaScript the CSS fallback (the two-row staff header) applies. Rendered by SiteHeader
 * only when it is sticky; the header is sticky from 64rem up only, which is the only place the value is used.
 */
export function StickyHeaderOffset() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("[data-sticky-header]");
    if (!header || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--header-h", `${header.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-h");
    };
  }, []);
  return null;
}
