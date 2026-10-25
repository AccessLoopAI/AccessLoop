import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";
import { orgPageLabel } from "./OrgContacts";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

interface ReporterShellProps {
  /** The organization the person is reporting to; shown in the header. */
  orgName?: string;
  /**
   * With `orgName`: the page is about this organization (its form, a receipt, /r/{code}, /check or /help for it).
   * The footer then links its feedback page /p/{orgSlug} (Phase 7 T4.1), and "Get help" and "Check your report"
   * carry `?org=` so those pages can show the organization's other ways to give feedback.
   */
  orgSlug?: string;
  /** "form" = one calm centred column (about 60ch); "wide" = landing and help layouts. */
  width?: "form" | "wide";
  children: ReactNode;
}

/** The query that tells /help and /check which organization the person came from (a public slug, never data). */
export function orgQuery(orgSlug: string | undefined): string {
  return orgSlug ? `?org=${encodeURIComponent(orgSlug)}` : "";
}

/**
 * Footer links on every public page, before SiteFooter's own "Privacy and AI" and "Accessibility". Never "Get help".
 * "Check your report" is named like the page it opens (its h1); the organization's page likewise.
 */
function reporterFooterLinks(orgName: string | undefined, orgSlug: string | undefined) {
  const links = [{ href: `/check${orgQuery(orgSlug)}`, label: "Check your report" }];
  if (orgName && orgSlug) links.push({ href: `/p/${orgSlug}`, label: orgPageLabel(orgName) });
  return links;
}

/** Public pages: warm paper, 20px type, one centred column, nothing that moves unless asked. */
export function ReporterShell({ orgName, orgSlug, width = "form", children }: ReporterShellProps) {
  const slug = orgName ? orgSlug : undefined;
  return (
    <div data-personality="reporter" className="flex min-h-dvh flex-col">
      <SiteHeader variant="reporter" orgName={orgName} helpHref={`/help${orgQuery(slug)}`} />
      <main id="main" tabIndex={-1} className="flex-1">
        <div
          className={cx(
            "mx-auto w-full px-4 sm:px-6",
            width === "form" ? "max-w-[44rem] py-10 sm:py-16" : "max-w-[72rem] py-10 sm:py-14",
          )}
        >
          {children}
        </div>
      </main>
      <SiteFooter links={reporterFooterLinks(orgName, slug)} />
    </div>
  );
}
