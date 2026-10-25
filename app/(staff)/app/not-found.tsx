import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { PageHeader } from "@/components/ui/PageHeader";

// 404 inside the staff area, rendered within the staff shell (so the header, nav and Sign out stay).
// Used for unknown refs, cases in another org, and pages a role may not open (owners get 404, never 403).
export const metadata: Metadata = { title: "Page not found" };

export default function StaffNotFound() {
  return (
    <>
      <PageHeader
        title="We can't find this page"
        description="It may not exist, it may belong to another organization, or your role may not open it."
      />
      <ButtonLink href="/app" variant="secondary">
        Go to your start page
      </ButtonLink>
    </>
  );
}
