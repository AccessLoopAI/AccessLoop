// The organization's feedback-process description (ACA s.70(1), ACR s.9; docs/domain.md §1.3), generated from its
// settings: who receives feedback, every way to give it, anonymous allowed, acknowledgement in the same way, other
// formats on request. ONE component for the public page /p/{org} and the preview on /app/settings, so the lead
// previews exactly what the public reads. A named region ("How to give feedback"); `id` makes its heading id.
import type { ReactNode } from "react";
import { MessageSquarePlus } from "lucide-react";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/Icon";
import { cx } from "@/components/ui/cx";
import { PROCESS_LINES, processIntro, type FeedbackProcessSettings } from "@/lib/feedback-process";
import { telHref } from "@/lib/org-settings";

export const PROCESS_DESCRIPTION_TITLE = "How to give feedback";

interface Props {
  org: FeedbackProcessSettings;
  /** The section's id; its heading is `${id}-title`. */
  id?: string;
  headingLevel?: 2 | 3;
  className?: string;
  /** Shown under the heading (the Settings preview says it is a preview). */
  note?: ReactNode;
}

export function FeedbackProcessDescription({ org, id = "give-feedback", headingLevel = 2, className, note }: Props) {
  const H = `h${headingLevel}` as const;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cx("al-card grid gap-5 rounded-lg border border-border bg-surface p-[var(--card-pad)]", className)}
    >
      <H id={`${id}-title`}>{PROCESS_DESCRIPTION_TITLE}</H>
      {note}
      <p>{processIntro(org)}</p>
      <div>
        <ButtonLink href={`/o/${org.slug}/report`} size="lg" iconStart={<Icon icon={MessageSquarePlus} />}>
          Report a barrier online
        </ButtonLink>
      </div>
      {/* The phone and email links are 44px targets (they stand alone, not inside a sentence); items-baseline keeps
          each label on the same line as its link's text. */}
      <dl className="grid items-baseline gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className="font-bold">By phone</dt>
        <dd className="m-0">
          <a href={telHref(org.contactPhone)} className="inline-flex min-h-11 items-center">
            {org.contactPhone}
          </a>
        </dd>
        <dt className="font-bold">By email</dt>
        <dd className="m-0 wrap-anywhere">
          <a href={`mailto:${org.contactEmail}`} className="inline-flex min-h-11 max-w-full items-center">
            {org.contactEmail}
          </a>
        </dd>
        <dt className="font-bold">By mail</dt>
        <dd className="m-0 whitespace-pre-line">{org.contactMailingAddress}</dd>
      </dl>
      <ul className="grid list-disc gap-2 pl-6">
        <li>{PROCESS_LINES.anonymous}</li>
        <li>{PROCESS_LINES.acknowledgement}</li>
        <li>{PROCESS_LINES.formats}</li>
      </ul>
    </section>
  );
}
