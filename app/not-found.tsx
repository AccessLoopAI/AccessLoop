import type { Metadata } from "next";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHeader } from "@/components/ui/PageHeader";

// The app-wide 404 (unknown URLs, unknown org slugs, unknown receipt codes, local sign-in off this computer).
// Plain words, no detail about why: a 404 never confirms that something exists.
export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <ReporterShell>
      <PageHeader
        title="We can't find this page"
        description="The link may have a mistake in it, or the page may not be here any more."
      />
      <div className="grid justify-items-start gap-[var(--stack)]">
        <p>If you typed the address, check it and try again. If you followed a link, the page may have moved.</p>
        <ButtonLink href="/" variant="secondary">
          Go to the AccessLoop home page
        </ButtonLink>
      </div>
    </ReporterShell>
  );
}
