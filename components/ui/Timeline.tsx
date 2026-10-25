import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { CaseStatus } from "@/lib/status";
import { cx } from "./cx";
import { Icon } from "./Icon";
import { LoopClosedIcon, SegmentRing, type RingStepState } from "./LoopRing";
import { VisuallyHidden } from "./VisuallyHidden";

/* ================================================================ the loop (5 stages) */

export const LOOP_STAGES = {
  staff: ["Reported", "Triaged", "Assigned", "Fix logged", "Checked by reporter"],
  // Tense-neutral, so each name reads right as done, in progress or not yet ("A team reads it, in progress").
  reporter: ["You send your report", "A team reads it", "Someone works on a fix", "The fix is made", "You check the fix"],
} as const;

export type LoopStageState = RingStepState;

export type LoopWording = "staff" | "reporter";

export interface LoopState {
  current: number;
  closed: boolean;
  unchecked: boolean;
}

const LOOP_CURRENT: Record<LoopWording, Record<Exclude<CaseStatus, "closed">, number>> = {
  // The stage the case is at.
  staff: { new: 0, triaged: 1, assigned: 2, retest_open: 4, fixed_unverified: 4, verified: 4 },
  // The step being worked on: the reporter's own step (sending) is done once the report is in.
  reporter: { new: 1, triaged: 2, assigned: 2, retest_open: 4, fixed_unverified: 4, verified: 4 },
};

/**
 * The ONE case status -> LoopTimeline mapping (spread it into the props). Closed cases have no loop stage: null.
 * staff: new 0, triaged 1, assigned 2, retest_open 4, fixed_unverified 4 unchecked, verified closed.
 * reporter: new 1, triaged 2, assigned 2, retest_open 4, fixed_unverified 4 unchecked, verified closed.
 */
export function loopState(status: CaseStatus, wording: LoopWording = "staff"): LoopState | null {
  if (status === "closed") return null;
  return { current: LOOP_CURRENT[wording][status], closed: status === "verified", unchecked: status === "fixed_unverified" };
}

interface LoopTimelineProps {
  /**
   * Index (0-4) of the stage in progress. Earlier stages are done, later ones upcoming.
   * Use loopState(status, wording) instead of picking it by hand.
   */
  current: number;
  /** The reporter confirmed the fix (status verified): every stage done and the ring closes. */
  closed?: boolean;
  /**
   * The fix is in but the reporter did not check it (status fixed_unverified: "I can't check", opt-out, expired,
   * or no re-test): stages 0-3 done, the last one stays open and says so ("not checked by the reporter").
   * The loop is left open: no stage is in progress.
   */
  unchecked?: boolean;
  wording?: "staff" | "reporter";
  /** Optional detail per stage, e.g. a <time> or "by Facilities team". */
  details?: Array<ReactNode | undefined>;
  /** Replace the stage names (keep five, in loop order). */
  stages?: readonly string[];
  /** Draw the ring closing once (signature moment 1). Ignored under prefers-reduced-motion. */
  animateClose?: boolean;
  /** Text shown under a closed loop. Defaults by wording. */
  closedMessage?: ReactNode;
  /** Heading above the list (rendered as a real heading). Leave out when the page already has one. */
  title?: ReactNode;
  titleLevel?: 2 | 3;
  className?: string;
}

const STATE_TEXT: Record<LoopStageState, string> = { done: "done", current: "in progress", upcoming: "not yet" };

const UNCHECKED_TEXT: Record<LoopWording, string> = { staff: "Not checked by the reporter", reporter: "Not checked by you" };

/**
 * The case loop as an ordered list with a decorative ring beside it. The ring segments mirror the
 * list (done = thick primary, in progress = amber, not yet = a thin grey arc); when the reporter confirms, the gaps
 * close into one ring with a check. State is always in text for screen readers.
 * It lays out horizontally when its container is wide (container query), vertically otherwise.
 */
export function LoopTimeline({
  current,
  closed = false,
  unchecked = false,
  wording = "staff",
  details,
  stages,
  animateClose,
  closedMessage,
  title,
  titleLevel = 2,
  className,
}: LoopTimelineProps) {
  const names = stages ?? LOOP_STAGES[wording];
  const lastIndex = names.length - 1;
  const isUnchecked = unchecked && !closed;
  const states: LoopStageState[] = names.map((_, i) =>
    closed
      ? "done"
      : isUnchecked
        ? i < lastIndex
          ? "done"
          : "upcoming"
        : i < current
          ? "done"
          : i === current
            ? "current"
            : "upcoming",
  );
  const H = `h${titleLevel}` as const;
  const message =
    closedMessage ??
    (wording === "reporter" ? "The loop is closed. You confirmed the fix." : "Loop closed: the reporter confirmed the fix.");

  return (
    <div className={cx("al-loop @container", className)} data-closed={closed || undefined}>
      {title ? <H className="mb-4 font-sans text-card-title font-bold tracking-normal">{title}</H> : null}
      {/* The ring always sits beside the list (smaller in a narrow container), never alone above it. */}
      <div className="flex items-start gap-4 @sm:gap-8 @2xl:items-center">
        <SegmentRing
          states={states}
          closed={closed}
          animateClose={animateClose}
          size={88}
          className="size-14 self-start @sm:size-[88px] @2xl:self-center"
        />
        <ol className="m-0 grid min-w-0 flex-1 list-none gap-0 p-0 @2xl:grid-flow-col @2xl:auto-cols-fr">
          {names.map((name, i) => {
            const state = states[i];
            const last = i === lastIndex;
            const notChecked = isUnchecked && last;
            return (
              <li
                key={name}
                data-state={state}
                aria-current={state === "current" ? "step" : undefined}
                className={cx(
                  "al-loop-step relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 pb-5",
                  // connector: vertical under the marker; horizontal to the next marker in the wide layout
                  !last &&
                    "before:left-[calc(1rem-1px)] before:top-9 before:bottom-1 before:w-0.5 @2xl:before:top-[calc(1rem-1px)] @2xl:before:bottom-auto @2xl:before:left-11 @2xl:before:right-2 @2xl:before:h-0.5 @2xl:before:w-auto",
                  last && "before:hidden",
                  // content-start: the row stretches every li to the tallest stage; without it the auto tracks stretch too
                  // and each label sinks by half its stage's spare height (labels at two or three heights).
                  "@2xl:grid-cols-1 @2xl:content-start @2xl:gap-y-2 @2xl:pr-3 @2xl:pb-0",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "relative z-[1] flex size-8 items-center justify-center rounded-pill border-2 text-small font-bold tabular-nums",
                    state === "done" && "border-primary bg-primary text-on-primary",
                    state === "current" && "border-[var(--ring-current)] bg-surface-raised text-ink shadow-1",
                    state === "upcoming" && "border-dashed border-border-strong bg-surface text-ink-muted",
                    closed && last && "border-success bg-success text-on-primary",
                  )}
                >
                  {state === "done" ? (
                    closed && last ? (
                      <Icon icon={LoopClosedIcon} size="1.1em" strokeWidth={2.5} />
                    ) : (
                      <Icon icon={Check} size="1em" strokeWidth={3} />
                    )
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cx("block font-bold", state === "upcoming" ? "text-ink-muted" : "text-ink")}>
                    {name}
                    <VisuallyHidden>{`, ${notChecked ? UNCHECKED_TEXT[wording].toLowerCase() : STATE_TEXT[state]}`}</VisuallyHidden>
                  </span>
                  {state === "current" ? (
                    <span aria-hidden="true" className="block text-small font-bold text-accent-ink">
                      In progress
                    </span>
                  ) : null}
                  {notChecked ? (
                    <span aria-hidden="true" className="block text-small font-bold text-ink-muted">
                      {UNCHECKED_TEXT[wording]}
                    </span>
                  ) : null}
                  {details?.[i] ? <span className="block text-small text-ink-muted">{details[i]}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {closed ? (
        <p className="mt-5 flex items-center gap-2 font-bold text-success" data-celebrate={animateClose || undefined}>
          <Icon icon={LoopClosedIcon} />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

/* ================================================================ detailed event history */

export interface HistoryEvent {
  id: string;
  /** What happened, in words ("Original viewed by Alex Rivera", "Fix logged"). */
  title: ReactNode;
  /** ISO timestamp for <time dateTime>. */
  at: string;
  /** Human date, e.g. "Oct 19, 2026, 10:42". Format on the server so it is stable. */
  atLabel: string;
  actor?: ReactNode;
  /** Extra text (a redacted note, the fix description). */
  body?: ReactNode;
  /** Trailing element, usually a <HashChip />. */
  aside?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}

// Every event in the history has happened, so every dot is filled (a hollow ring read as "not done yet"). Colour
// marks only the events worth spotting at a glance; the title always says what happened.
const DOT: Record<NonNullable<HistoryEvent["tone"]>, string> = {
  default: "border-border-strong bg-border-strong",
  info: "border-info bg-info",
  success: "border-success bg-success",
  warning: "border-warning bg-warning",
  danger: "border-danger bg-danger",
};

/**
 * The event history of a case as an ordered list (oldest first unless you pass them reversed).
 * Wrap it in a <Card as="section" id="history" title="History"> so it becomes the region "History".
 */
export function HistoryTimeline({ events, className }: { events: HistoryEvent[]; className?: string }) {
  return (
    <ol className={cx("al-history m-0 list-none p-0", className)}>
      {events.map((e, i) => (
        <li key={e.id} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-5 last:pb-0">
          {i < events.length - 1 ? (
            <span aria-hidden="true" className="absolute top-3 bottom-0 left-[calc(0.625rem-1px)] w-0.5 bg-border" />
          ) : null}
          {/* A 12px dot centred on the title's first line and on the thread (forced colours keep its border). */}
          <span
            aria-hidden="true"
            className={cx(
              "al-badge relative mt-[calc((1lh-0.75rem)/2)] size-3 justify-self-center rounded-pill border-2",
              DOT[e.tone ?? "default"],
            )}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-bold text-ink">{e.title}</p>
              {e.aside ? <div className="shrink-0">{e.aside}</div> : null}
            </div>
            <p className="flex flex-wrap gap-x-3 text-small text-ink-muted">
              <time dateTime={e.at}>{e.atLabel}</time>
              {e.actor ? (
                <span>
                  <VisuallyHidden>, </VisuallyHidden>
                  {e.actor}
                </span>
              ) : null}
            </p>
            {e.body ? <div className="mt-1.5 max-w-[var(--measure)] text-ink">{e.body}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
