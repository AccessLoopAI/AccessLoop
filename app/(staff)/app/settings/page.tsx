import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs } from "@/db/schema";
import { MapPin } from "lucide-react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireStaff } from "@/lib/auth/staff";
import { FeedbackProcessHelper } from "./FeedbackProcessHelper";
import { SettingsForm } from "./SettingsForm";

// Org settings (lead only; CLAUDE.md "Routes"; domain §1.3 ACR s.9(1), §1.4 s.14(1)(b) and s.14(2)). orgs is not
// tenant-scoped, so it is read with `db`, by the signed-in member's own org id only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const staff = await requireStaff(["lead"]);
  const [org] = await db
    .select({
      slug: orgs.slug,
      feedbackDesignateTitle: orgs.feedbackDesignateTitle,
      contactMailingAddress: orgs.contactMailingAddress,
      contactPhone: orgs.contactPhone,
      contactEmail: orgs.contactEmail,
      retestOfferText: orgs.retestOfferText,
      planAreas: orgs.planAreas,
      entityClass: orgs.entityClass,
    })
    .from(orgs)
    .where(eq(orgs.id, staff.orgId))
    .limit(1);
  if (!org) notFound();

  return (
    <>
      <PageHeader
        title="Settings"
        description="What the law asks you to publish about your feedback process. AccessLoop uses it on your public pages, in emails to people who give feedback, and in your progress report."
        // Phase 7 T4.5: the places people report about, each with a QR poster (/app/settings/locations).
        actions={
          <ButtonLink href="/app/settings/locations" variant="secondary" iconStart={<Icon icon={MapPin} />}>
            Locations and posters
          </ButtonLink>
        }
      />
      <SettingsForm
        orgSlug={org.slug}
        initial={{
          feedbackDesignateTitle: org.feedbackDesignateTitle,
          contactMailingAddress: org.contactMailingAddress,
          contactPhone: org.contactPhone,
          contactEmail: org.contactEmail,
          retestOfferText: org.retestOfferText ?? "",
          planAreas: org.planAreas,
          entityClass: org.entityClass,
        }}
      />
      <FeedbackProcessHelper staff={{ orgId: staff.orgId, role: "lead" }} org={{ ...org, name: staff.orgName }} />
    </>
  );
}
