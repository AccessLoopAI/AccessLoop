import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Disclosure } from "@/components/ui/Disclosure";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import { telHref } from "@/lib/org-settings";
import type { PublicOrg } from "@/lib/orgs";

/** What a reporter page may show about the organization: public by law (ACR s.9(1), s.9(3), s.14(2)). */
export type OrgContact = Pick<
  PublicOrg,
  "slug" | "name" | "feedbackDesignateTitle" | "contactPhone" | "contactEmail" | "contactMailingAddress"
>;

/** Only the public fields, so a page never hands the org's id (or anything else) to a client component. */
export function orgContact(org: OrgContact): OrgContact {
  return {
    slug: org.slug,
    name: org.name,
    feedbackDesignateTitle: org.feedbackDesignateTitle,
    contactPhone: org.contactPhone,
    contactEmail: org.contactEmail,
    contactMailingAddress: org.contactMailingAddress,
  };
}

/** The organization's own feedback page (/p/{slug}), named like its h1 (as the footer names it). */
export function orgPageLabel(orgName: string): string {
  return `${orgName}: accessibility feedback`;
}

/** "Ask for the Accessibility Lead." (the settings title may already start with "the"). */
function askFor(org: OrgContact): string {
  return `Ask for the ${org.feedbackDesignateTitle.replace(/^the\s+/i, "")}.`;
}

/**
 * Phone, email and mail (ACR s.9(3)), with the person to ask for. The phone and email links are 44px targets (they
 * stand alone, not inside a sentence); a long email wraps anywhere at 320px.
 */
export function OrgContactList({ org, className }: { org: OrgContact; className?: string }) {
  return (
    <div className={cx("grid gap-3", className)}>
      <p>
        You can also give feedback to {org.name} by phone, email or mail. {askFor(org)}
      </p>
      <dl className="m-0 grid items-baseline gap-x-4 gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="font-bold">Phone</dt>
        <dd className="m-0">
          <a href={telHref(org.contactPhone)} className="inline-flex min-h-11 items-center">
            {org.contactPhone}
          </a>
        </dd>
        <dt className="font-bold">Email</dt>
        <dd className="m-0 wrap-anywhere">
          <a href={`mailto:${org.contactEmail}`} className="inline-flex min-h-11 max-w-full items-center">
            {org.contactEmail}
          </a>
        </dd>
        <dt className="font-bold">Mail</dt>
        <dd className="m-0 whitespace-pre-line">{org.contactMailingAddress}</dd>
      </dl>
    </div>
  );
}

/** The link to the organization's feedback page, as a standalone 44px row. */
export function OrgPageLink({ org }: { org: Pick<OrgContact, "slug" | "name"> }) {
  return (
    <p>
      <a href={`/p/${org.slug}`} className="inline-flex min-h-11 items-center gap-2 font-bold">
        <span>{orgPageLabel(org.name)}</span>
        <Icon icon={ArrowRight} />
      </a>
    </p>
  );
}

/**
 * "Other ways to reach {org}" (Phase 7 T4.1): a closed disclosure with the organization's phone, email and mail, and a
 * link to its feedback page. On the report form (every step), the receipt, /r/{code} and /check when the org is
 * known. Closed content is `hidden`, so it adds one Tab stop until opened.
 */
export function OtherWaysToReach({ org, intro, className }: { org: OrgContact; intro?: ReactNode; className?: string }) {
  return (
    // A long organization name wraps on a phone: its lines start at the left, like the text around it (a button
    // centres its text by default).
    <Disclosure summary={`Other ways to reach ${org.name}`} className={cx("[&>button]:text-left", className)} panelClassName="grid gap-4">
      {intro}
      <OrgContactList org={org} />
      <OrgPageLink org={org} />
    </Disclosure>
  );
}
