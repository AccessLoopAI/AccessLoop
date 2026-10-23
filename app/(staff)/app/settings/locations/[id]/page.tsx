import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { ActionFeedbackProvider } from "@/components/ui/ActionFeedback";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireStaff } from "@/lib/auth/staff";
import { locationKindLabel, locationPrefill } from "@/lib/locations/input";
import { getLocation } from "@/lib/locations/store";
import { EditLocationForm } from "../LocationForms";

// One location (lead only; Phase 7 T4.5): its name, the form's starting answer, the detail, and whether it is in use.
// Looked up inside the signed-in lead's org only: an unknown id or another org's location is a 404.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit location" };

type Props = { params: Promise<{ id: string }> };

export default async function EditLocationPage({ params }: Props) {
  const staff = await requireStaff(["lead"]);
  const location = await getLocation(staff.orgId, (await params).id);
  if (!location) notFound();
  const prefill = locationPrefill(location);

  return (
    <>
      <p className="mb-4">
        <Link href="/app/settings/locations" className="inline-flex min-h-11 items-center gap-1.5 font-bold">
          <Icon icon={ArrowLeft} size="1em" />
          <span>All locations</span>
        </Link>
      </p>
      <PageHeader
        title={`Edit ${location.name}`}
        description="Changes apply to every poster already printed for this location: its QR code stays the same."
        actions={
          <ButtonLink href={`/app/settings/locations/${location.id}/poster`} variant="secondary" iconStart={<Icon icon={Printer} />}>
            Open its poster
          </ButtonLink>
        }
      />
      <ActionFeedbackProvider testId="locations-result">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,48rem)_minmax(16rem,22rem)] lg:items-start lg:gap-10">
          <Card as="section" id="location-details" title="Details" tone="raised" className="min-w-0">
            <EditLocationForm
              initial={{
                id: location.id,
                name: location.name,
                kind: location.kind,
                detail: location.detail ?? "",
                active: location.active,
              }}
            />
          </Card>
          <Card as="section" id="location-form-view" title="What the form fills in" tone="inset">
            {location.active ? (
              <dl className="m-0 grid gap-4">
                <div className="grid gap-1">
                  <dt className="text-small font-bold text-ink-muted">Where did it happen?</dt>
                  <dd className="m-0">{locationKindLabel(prefill.locationKind)}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="text-small font-bold text-ink-muted">Where exactly?</dt>
                  <dd className="m-0 wrap-anywhere">{prefill.locationDetail}</dd>
                </div>
              </dl>
            ) : (
              <p>Nothing: this location is retired, so its posters open the report form empty.</p>
            )}
            <p className="mt-4 text-small text-ink-muted">The person can change both answers before they send the report.</p>
          </Card>
        </div>
      </ActionFeedbackProvider>
    </>
  );
}
