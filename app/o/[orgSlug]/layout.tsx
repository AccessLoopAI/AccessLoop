import type { ReactNode } from "react";
import { OrgContactProvider } from "@/components/layout/OrgContext";
import { orgContact } from "@/components/layout/OrgContacts";
import { getPublicOrg } from "@/lib/orgs";

// Every page under /o/{orgSlug} (the report form and the receipt) is about one organization. This layout renders
// nothing of its own: it hands that organization's public contact details to the error page under it
// (app/o/[orgSlug]/error.tsx), so a failed page can still say how else to reach the organization (Phase 7 T4.1).
// getPublicOrg is cached per request, so the page's own lookup is the same query. An unknown slug gives null (the
// page answers 404 itself).
export const runtime = "nodejs";

export default async function OrgLayout({ children, params }: { children: ReactNode; params: Promise<{ orgSlug: string }> }) {
  const org = await getPublicOrg((await params).orgSlug);
  return <OrgContactProvider org={org ? orgContact(org) : null}>{children}</OrgContactProvider>;
}
