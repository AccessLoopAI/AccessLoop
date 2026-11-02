// What the daily job does for one case today (app/api/cron/daily; docs/archive/phase7-prompt.md T3 item 12; docs/domain.md
// §3 re-test ethics, §10). Pure: a case row's few fields plus its events in, a plan out. lib/cron/run.ts loads the
// cases, then carries out each part in its own short transaction with the case row locked, planning that case again
// on its fresh state there; the frozen state machine and the email rules (lib/email/case-emails.ts) check once more.
//   (a) expire_retest for a round open 60+ days (only when CRON_EXPIRE_RETEST=1: domain §10, "no job expires re-tests
//       before demo day");
//   (b) the one reminder email of a re-test round, a week after the request, to a reporter who gave an email and has
//       had no reminder this round (from the lead or from an earlier run);
//   (c) one alert to the assigned owner when a case is past its due date (cases.due_at, decision D8) or has had no
//       fix logged for 30+ days (the dashboard's "Needs attention" rule, lib/metrics), once per stretch in "assigned".
import { messagesSent, reminderSentAt, reporterGaveEmail } from "@/lib/cases/messages";
import { attentionReasons } from "@/lib/metrics/predicates";
import { replayCase, type MetricEvent } from "@/lib/metrics/replay";
import { RETEST_EXPIRY_DAYS } from "@/lib/state-machine";
import type { CaseStatus } from "@/lib/status";

/** The one reminder of a round goes this many days after its re-test request (the lead may send it sooner). */
export const RETEST_REMINDER_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

export type OwnerAlertKind = "stalled" | "overdue";

/** The email template of each owner alert (lib/email/templates.ts). */
export const OWNER_ALERT_TEMPLATE = { stalled: "owner_stalled", overdue: "owner_overdue" } as const;

export interface DailyCaseInput {
  id: string;
  ref: string;
  status: CaseStatus;
  retestRound: number;
  assignedTo: string | null;
  /** cases.due_at (decision D8). Undefined where it is not read yet: then no case is ever "overdue". */
  dueAt?: Date | null;
  /** The case's events (any order). */
  events: readonly MetricEvent[];
}

export interface DailyCasePlan {
  expire: boolean;
  remind: boolean;
  ownerAlert: OwnerAlertKind | null;
}

export interface DailyPlanOptions {
  /** CRON_EXPIRE_RETEST=1. */
  expireRetest: boolean;
}

const NOTHING: DailyCasePlan = { expire: false, remind: false, ownerAlert: null };

/** When the case's current round was requested: its retest_requested event (or the latest one), or null. */
export function roundRequestedAt(events: readonly MetricEvent[], round: number): Date | null {
  const requests = [...events].filter((e) => e.type === "retest_requested").sort((a, b) => a.seq - b.seq);
  const ofRound = requests.filter((e) => e.payload.round === round);
  return (ofRound.length ? ofRound : requests).at(-1)?.createdAt ?? null;
}

/** What the job should do for this case at `now`. */
export function planDailyCase(c: DailyCaseInput, now: Date, options: DailyPlanOptions): DailyCasePlan {
  if (c.status === "retest_open") {
    const requestedAt = roundRequestedAt(c.events, c.retestRound);
    if (!requestedAt) return NOTHING;
    const age = now.getTime() - requestedAt.getTime();
    // The same test plan() applies to expire_retest (frozen lib/state-machine.ts).
    const expire = options.expireRetest && age >= RETEST_EXPIRY_DAYS * DAY_MS;
    const remind =
      !expire &&
      age >= RETEST_REMINDER_AFTER_DAYS * DAY_MS &&
      reporterGaveEmail(c.events) &&
      reminderSentAt(c.events, c.retestRound) === null;
    return { expire, remind, ownerAlert: null };
  }

  if (c.status === "assigned" && c.assignedTo) {
    const replayed = replayCase({ id: c.id, ref: c.ref, events: c.events });
    const since = replayed.assignedSince;
    if (!since) return NOTHING;
    const alertedSince = (kind: OwnerAlertKind) =>
      messagesSent(c.events, OWNER_ALERT_TEMPLATE[kind]).some((e) => e.createdAt.getTime() >= since.getTime());
    if (c.dueAt && c.dueAt.getTime() <= now.getTime() && !alertedSince("overdue")) {
      return { expire: false, remind: false, ownerAlert: "overdue" };
    }
    // An owner who was told the due date passed is not told again that the case is stalled.
    const stalled = attentionReasons(replayed, now).some((h) => h.reason === "stalled");
    if (stalled && !alertedSince("stalled") && !alertedSince("overdue")) {
      return { expire: false, remind: false, ownerAlert: "stalled" };
    }
  }
  return NOTHING;
}
