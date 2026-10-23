import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Pencil, Printer } from "lucide-react";
import { ActionFeedbackProvider } from "@/components/ui/ActionFeedback";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { requireStaff } from "@/lib/auth/staff";
import { locationKindLabel } from "@/lib/locations/input";
import { listLocations } from "@/lib/locations/store";
import { AddLocationForm } from "./LocationForms";

// Locations and QR posters (lead only; Phase 7 T4.5, D8 `org_locations`). The lead names the places, phone lines,
// websites and documents people may report about, and prints a poster for each: its QR code opens
// /o/{slug}/report?loc={id} with "Where did it happen?" filled in (domain §4). Read and written only through withOrg
// for the signed-in lead's own org (lib/locations/store.ts). Owners and auditors: 404.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Locations and posters" };

export default async function LocationsPage() {
  const staff = await requireStaff(["lead"]);
  const locations = await listLocations(staff.orgId);
  const inUse = locations.filter((l) => l.active).length;

  return (
    <>
      <p className="mb-4">
        <Link href="/app/settings" className="inline-flex min-h-11 items-center gap-1.5 font-bold">
          <Icon icon={ArrowLeft} size="1em" />
          <span>Settings</span>
        </Link>
      </p>
      <PageHeader
        title="Locations and posters"
        description="Name the places people may tell you about: a branch, a phone line, a website or a form. Print a poster for each one. Its QR code opens your report form with the place already filled in, and the person can change it."
      />
      <ActionFeedbackProvider testId="locations-result">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-start lg:gap-10">
          <section aria-labelledby="locations-list-title" className="grid min-w-0 gap-4">
            <h2 id="locations-list-title" className="text-h3">
              Your locations
            </h2>
            {locations.length === 0 ? (
              <EmptyState title="No locations yet" titleLevel={3}>
                Add the first one with the form. Each location gets its own poster, ready to print.
              </EmptyState>
            ) : (
              <Table
                id="locations"
                caption="Locations"
                captionHidden
                description={`${inUse} in use${locations.length > inUse ? `, ${locations.length - inUse} retired` : ""}`}
              >
                <THead>
                  <Tr>
                    <Th>Location</Th>
                    <Th>Form starts with</Th>
                    <Th>Status</Th>
                    <Th>
                      <VisuallyHidden>Actions</VisuallyHidden>
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {locations.map((l) => (
                    <Tr key={l.id}>
                      <Th scope="row" className="min-w-48">
                        <span className="block">{l.name}</span>
                        {l.detail ? <span className="block text-small font-normal text-ink-muted">{l.detail}</span> : null}
                      </Th>
                      <Td className="min-w-40">{locationKindLabel(l.kind)}</Td>
                      <Td>
                        {l.active ? (
                          <span className="font-bold">In use</span>
                        ) : (
                          <span className="text-ink-muted">Retired</span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-2">
                          <ButtonLink
                            href={`/app/settings/locations/${l.id}/poster`}
                            variant="secondary"
                            iconStart={<Icon icon={Printer} />}
                          >
                            Poster<VisuallyHidden>{` for ${l.name}`}</VisuallyHidden>
                          </ButtonLink>
                          <ButtonLink href={`/app/settings/locations/${l.id}`} variant="quiet" iconStart={<Icon icon={Pencil} />}>
                            Edit<VisuallyHidden>{` ${l.name}`}</VisuallyHidden>
                          </ButtonLink>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </section>
          <Card as="section" id="add-location" title="Add a location" tone="raised">
            <AddLocationForm />
          </Card>
        </div>
      </ActionFeedbackProvider>
    </>
  );
}
