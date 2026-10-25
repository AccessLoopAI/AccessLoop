import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireStaff } from "@/lib/auth/staff";
import { getLocation } from "@/lib/locations/store";
import { posterAddress } from "@/lib/locations/poster";
import { qrDrawing } from "@/lib/locations/qr";
import { getPublicOrg } from "@/lib/orgs";
import { LocationPoster } from "./LocationPoster";
import { PrintPosterButton } from "./PrintPosterButton";

// A location's poster (lead only; Phase 7 T4.5). The QR code is drawn here on the server (lib/locations/qr.ts, the
// `qrcode` package: no QR service, no script) and opens /o/{slug}/report?loc={id}, the address printed under it.
// "Print poster" prints the poster alone (print styles in app/globals.css). Another org's location, an unknown id,
// owners and auditors: 404.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Poster" };

type Props = { params: Promise<{ id: string }> };

export default async function PosterPage({ params }: Props) {
  const staff = await requireStaff(["lead"]);
  const location = await getLocation(staff.orgId, (await params).id);
  if (!location) notFound();
  const org = await getPublicOrg(staff.orgSlug);
  if (!org) notFound();
  const address = posterAddress(org.slug, location.id);
  const drawing = address.url ? qrDrawing(address.url) : null;

  return (
    <>
      <div data-print-hide>
        <p className="mb-4">
          <Link href="/app/settings/locations" className="inline-flex min-h-11 items-center gap-1.5 font-bold">
            <Icon icon={ArrowLeft} size="1em" />
            <span>All locations</span>
          </Link>
        </p>
        <PageHeader
          title={`Poster for ${location.name}`}
          description="Print it and put it up where people meet this place, at eye level for someone sitting and standing. The code opens your report form with the place already filled in."
          actions={
            <>
              {drawing ? <PrintPosterButton /> : null}
              <ButtonLink href={`/app/settings/locations/${location.id}`} variant="secondary" iconStart={<Icon icon={Pencil} />}>
                Edit location
              </ButtonLink>
            </>
          }
        />
        <div className="mb-8 grid max-w-[var(--measure)] gap-4">
          {!address.url ? (
            <Notice tone="warning" title="We can't draw the code yet">
              This site&rsquo;s public address isn&rsquo;t set, so the code would not know where to send people. Ask whoever runs
              AccessLoop to set it.
            </Notice>
          ) : address.localOnly ? (
            <Notice tone="warning" title="Phones can't open this code yet">
              It opens an address on this computer only. Print posters from your live AccessLoop site, so the code opens your
              real report form.
            </Notice>
          ) : null}
          {!location.active ? (
            <Notice tone="warning" title="This location is retired">
              Its code opens your report form without the place filled in. Put it back in use to fill it in again.
            </Notice>
          ) : null}
        </div>
      </div>
      <LocationPoster org={org} name={location.name} detail={location.detail} url={address.url} drawing={drawing} />
    </>
  );
}
