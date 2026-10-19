import type { ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { VisuallyHidden } from "./VisuallyHidden";

interface DeadlineBannerProps {
  /** "Progress report due June 1, 2027". */
  what: string;
  /** "225 days", "today", "3 days ago": shown large at the end of the line. */
  when: string;
  /** A line under it (which deliverable, for which kind of organization). */
  detail?: ReactNode;
  /** "soon" (30 days or fewer) and "past" use the warning tone; the words say it too. */
  urgency?: "calm" | "soon" | "past";
  testId?: string;
  className?: string;
}

/**
 * The dashboard's deadline line (docs/domain.md §1.5, §10): the next deliverable and the days left, as one
 * sentence ("Progress report due June 1, 2027: 225 days"; the colon is for screen readers, the layout shows the
 * gap). Not a live region and not a Notice: it is a fact about the calendar, not a message.
 */
export function DeadlineBanner({ what, when, detail, urgency = "calm", testId, className }: DeadlineBannerProps) {
  return (
    <div
      data-urgency={urgency}
      className={cx(
        "al-card al-deadline flex items-start gap-4 rounded-lg border border-border bg-surface px-5 py-4 sm:items-center sm:gap-5",
        className,
      )}
    >
      <span className="al-deadline-icon grid size-11 shrink-0 place-items-center rounded-pill bg-accent-soft text-accent-ink">
        <Icon icon={CalendarClock} size="1.35em" />
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p data-testid={testId} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <span className="text-lead font-bold text-balance text-ink">{what}</span>
          <VisuallyHidden>: </VisuallyHidden>
          <span className="al-deadline-count font-display text-h2 font-semibold text-ink">{when}</span>
        </p>
        {detail ? <p className="text-small text-ink-muted">{detail}</p> : null}
      </div>
    </div>
  );
}
