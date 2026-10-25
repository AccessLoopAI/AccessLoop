import type { HTMLAttributes } from "react";
import { Archive, CircleDot, ListFilter, MessageCircleQuestionMark, Wrench } from "lucide-react";
import { STAFF_STATUS_LABELS, reporterStatusLabel, type CaseStatus } from "@/lib/status";
import { cx } from "./cx";
import { Icon, type Glyph } from "./Icon";
import { LoopClosedIcon, LoopOpenIcon } from "./LoopRing";

const ICON: Record<CaseStatus, Glyph> = {
  new: CircleDot,
  triaged: ListFilter,
  assigned: Wrench,
  retest_open: MessageCircleQuestionMark,
  verified: LoopClosedIcon,
  fixed_unverified: LoopOpenIcon,
  closed: Archive,
};

const TONE: Record<CaseStatus, string> = {
  new: "bg-status-new-bg text-status-new-fg",
  triaged: "bg-status-triaged-bg text-status-triaged-fg",
  assigned: "bg-status-assigned-bg text-status-assigned-fg",
  retest_open: "bg-status-retest-open-bg text-status-retest-open-fg",
  verified: "bg-status-verified-bg text-status-verified-fg shadow-1",
  fixed_unverified: "bg-status-fixed-unverified-bg text-status-fixed-unverified-fg",
  closed: "bg-status-closed-bg text-status-closed-fg",
};

interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  status: CaseStatus;
  /** "staff" = domain §3 staff label; "reporter" = what the reporter sees on /r/[code]. */
  wording?: "staff" | "reporter";
  /** For reporter wording of closed cases: "Closed: {reason in plain words}". */
  closedReason?: string | null;
  size?: "md" | "lg";
  /** Play the one-time arrival transition (the verified moment). Nothing moves under reduced motion. */
  celebrate?: boolean;
  /**
   * A second copy of a status shown elsewhere in the same place, for another screen width (the case tables show
   * it at the top of the Summary cell on phones, where the Status column is hidden). It carries no data-status, so the one
   * `[data-status]` element stays the real badge. Hide one of the two at every width.
   */
  copy?: boolean;
}

/**
 * Case status as icon + text + colour (never colour alone). The text content is EXACTLY the label,
 * so a parent (or this element) can carry data-testid="case-status" and e2e can use toHaveText().
 */
export function StatusBadge({
  status,
  wording = "staff",
  closedReason,
  size = "md",
  celebrate,
  copy,
  className,
  ...rest
}: StatusBadgeProps) {
  const label = wording === "staff" ? STAFF_STATUS_LABELS[status] : reporterStatusLabel(status, closedReason);
  return (
    <span
      data-status={copy ? undefined : status}
      data-celebrate={celebrate || undefined}
      className={cx(
        "al-badge inline-flex max-w-full gap-[0.45em] border border-transparent font-bold",
        // lg (the reporter's status on /r/): a long label can wrap at phone width ("Fixed and confirmed by you").
        // Then it is a rounded block with balanced lines and the icon on the first line, not a squeezed pill; the
        // text stays at the lead size (reporter type is never below 18px).
        size === "lg"
          ? "items-start rounded-lg px-3 py-1.5 text-lead sm:items-center sm:rounded-pill sm:px-4"
          : // md: one line from sm (a table column grows to fit it, so "Waiting for the reporter to check" never
            // stacks into a four-line blob). On a phone it may wrap; rounded-lg is a pill on one line and a soft
            // rectangle on two, with balanced lines and the icon on the first.
            "items-start rounded-lg px-3 py-1 text-small sm:items-center sm:whitespace-nowrap",
        TONE[status],
        className,
      )}
      {...rest}
    >
      <Icon icon={ICON[status]} size="1.15em" strokeWidth={2.25} className="mt-[0.175em] sm:mt-0" />
      <span className="text-balance">{label}</span>
    </span>
  );
}
