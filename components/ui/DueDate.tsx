import { AlarmClock, CalendarClock, CalendarDays } from "lucide-react";
import { zonedNoon } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import type { DueState } from "@/lib/metrics/queue";
import { cx } from "./cx";
import { Icon } from "./Icon";

/**
 * A case's due date in a staff queue (the inbox, My work) and on the case page (decision D8). The state is in words,
 * never colour alone: "Overdue" (bold, the danger colour, an alarm clock), "Due today" (bold), "Due Nov 3, 2026".
 * Under it, in muted text, the date an overdue case was due, or how many days are left. Build `state` with
 * dueState() from lib/metrics/queue.ts: only an assigned case has one; with { kind: "none" } this renders nothing.
 */
export function DueDate({ state, className }: { state: DueState; className?: string }) {
  if (state.kind === "none") return null;
  const date = (
    <time dateTime={state.on} className="whitespace-nowrap">
      {formatDate(zonedNoon(state.on))}
    </time>
  );
  const head =
    state.kind === "overdue" ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-bold text-danger" data-due="overdue">
        <Icon icon={AlarmClock} />
        <span>Overdue</span>
      </span>
    ) : state.kind === "today" ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-bold text-ink" data-due="today">
        <Icon icon={CalendarClock} />
        <span>Due today</span>
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink" data-due="upcoming">
        <Icon icon={CalendarDays} />
        <span>Due {date}</span>
      </span>
    );
  const detail =
    state.kind === "overdue" ? (
      <>
        Was due {date} ({state.days === 1 ? "1 day ago" : `${state.days} days ago`})
      </>
    ) : state.kind === "upcoming" ? (
      state.days === 1 ? (
        "Tomorrow"
      ) : (
        `In ${state.days} days`
      )
    ) : null;
  return (
    <span className={cx("grid gap-0.5", className)}>
      {head}
      {detail ? <span className="text-small text-ink-muted">{detail}</span> : null}
    </span>
  );
}
