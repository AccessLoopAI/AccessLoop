"use client";

// Shown when a page or a nested layout throws (the database is down, a query failed). It renders inside the
// root layout, so the skip link, the one status region and the "Get help" link stay. It never shows the error
// itself (it could hold data): plain words and a way to try again. Staff pages have their own, inside the
// staff shell (app/(staff)/app/error.tsx). Under /o/{orgSlug} the same page (app/o/[orgSlug]/error.tsx) knows the
// organization and shows its other ways to give feedback (Phase 7 T4.1).
import { RotateCw } from "lucide-react";
import { OrgContactList, OrgPageLink } from "@/components/layout/OrgContacts";
import { useOrgContact } from "@/components/layout/OrgContext";
import { ReporterShell } from "@/components/layout/ReporterShell";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";

export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  const org = useOrgContact();
  return (
    <ReporterShell orgName={org?.name} orgSlug={org?.slug}>
      <PageHeader
        title="Something went wrong"
        focusOnMount
        description="We could not load this page just now. Anything you already sent is safe."
      />
      <div className="grid justify-items-start gap-[var(--stack)]">
        <p className="max-w-[var(--measure)]">
          {org
            ? "Try again in a moment. If it keeps happening, you can reach the organization another way."
            : "Try again in a moment. If it keeps happening, the Get help page explains other ways to reach the organization."}
        </p>
        <Button onClick={() => retry()} iconStart={<Icon icon={RotateCw} />}>
          Try again
        </Button>
        {org ? (
          <section aria-labelledby="other-ways" className="grid gap-4">
            <h2 id="other-ways">Other ways to reach {org.name}</h2>
            <OrgContactList org={org} />
            <OrgPageLink org={org} />
          </section>
        ) : null}
      </div>
    </ReporterShell>
  );
}
