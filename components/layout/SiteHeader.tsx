import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { LifeBuoy } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { LoopMark } from "@/components/ui/LoopRing";
import { StickyHeaderOffset } from "./StickyHeaderOffset";

interface SiteHeaderProps {
  variant?: "reporter" | "staff";
  /** Who the page is for (the org the reporter is writing to, or the staff member's org). */
  orgName?: ReactNode;
  /** Primary navigation (StaffNav). Rendered as the header's second row, under the brand and the utility items. */
  nav?: ReactNode;
  /** Utility items (signed-in name, sign-out form). "Get help" is always appended LAST, at the end of the top row. */
  utility?: ReactNode;
  /** Sticky from 64rem up (staff). Never sticky on small screens or at high zoom. */
  sticky?: boolean;
  /**
   * Where "Get help" goes: /help, or /help?org={slug} on a page about one organization (ReporterShell), so /help can
   * show that organization's other ways to give feedback. Same text and same place on every page either way.
   */
  helpHref?: string;
}

// Inside the header the focus ring uses the chrome colours (the staff header is dark in both themes).
const CHROME_FOCUS = { "--focus": "var(--chrome-focus)", "--focus-halo": "var(--chrome-focus-halo)" } as CSSProperties;

/**
 * The header of every page. Its top row ends with the same "Get help" link to /help, in the same place on every
 * page (WCAG 3.2.6 consistent help): brand and organization on the left, then the utility items and "Get help" on
 * the right. Do not add a second "Get help" anywhere else on a page. With `nav` (staff pages), the navigation is a
 * second row of tabs under it, so the header never wraps into an uneven shape however many sections a role has.
 *
 * Phones (below sm): the organization sits under the brand, with no separator rule; on reporter pages "Get help"
 * stays at the right of the brand's line; on staff pages the signed-in person, "Sign out" and "Get help" share one
 * line under the organization. Nothing is reordered (no CSS order): DOM, Tab and visual order stay the same.
 */
export function SiteHeader({ variant = "reporter", orgName, nav, utility, sticky = false, helpHref = "/help" }: SiteHeaderProps) {
  const staff = variant === "staff";
  const width = staff ? "max-w-[90rem]" : "max-w-[72rem]";
  return (
    <header
      data-sticky-header={sticky || undefined}
      data-print-hide
      className={cx(
        "al-chrome z-40 border-b border-chrome-border bg-chrome-bg text-chrome-ink",
        sticky && "lg:sticky lg:top-0",
      )}
      style={CHROME_FOCUS}
    >
      <div
        className={cx(
          "mx-auto flex w-full flex-wrap items-start gap-x-6 gap-y-1 px-4 sm:items-center sm:px-6",
          width,
          staff ? "py-2" : "py-3",
        )}
      >
        {/* flex-1 on phones: the brand group shares its line with a short utility group (the reporter's "Get help")
            instead of filling it and pushing "Get help" to a line of its own. */}
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1 sm:min-w-0 sm:flex-initial">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 rounded-sm text-chrome-ink no-underline hover:text-chrome-ink hover:no-underline"
          >
            <LoopMark size={30} className={staff ? "text-chrome-ink" : "text-primary"} />
            <span className="font-display text-[1.3125rem] leading-none font-bold tracking-[-0.01em]">AccessLoop</span>
          </Link>
          {orgName ? (
            <p className="flex basis-full items-center pb-1 text-ui font-bold text-balance text-chrome-muted sm:min-h-11 sm:basis-auto sm:border-l sm:border-chrome-border sm:pb-0 sm:pl-3">
              {orgName}
            </p>
          ) : null}
        </div>
        <div
          className={cx(
            "ml-auto flex items-center gap-y-1",
            // Staff phones: the person, "Sign out" and "Get help" on one full-width line (the name wraps within its
            // words; at 320px the buttons move under the name instead of widening the page).
            "flex-wrap",
            staff && utility ? "basis-full justify-end gap-x-3 sm:basis-auto sm:gap-x-5" : "gap-x-5",
          )}
        >
          {utility}
          <HelpLink href={helpHref} />
        </div>
      </div>
      {nav ? (
        <div className="border-t border-chrome-border">
          <div className={cx("mx-auto w-full px-4 sm:px-6", width)}>{nav}</div>
        </div>
      ) : null}
      {sticky ? <StickyHeaderOffset /> : null}
    </header>
  );
}

/** The consistent help link. Same text, same page (/help), same position on every page. */
function HelpLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-sm text-ui font-bold text-chrome-ink underline decoration-1 underline-offset-4 hover:text-chrome-ink hover:decoration-2"
    >
      <Icon icon={LifeBuoy} size="1.15em" />
      <span>Get help</span>
    </Link>
  );
}
