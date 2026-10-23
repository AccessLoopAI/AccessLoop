// The dashboard's period selector (docs/domain.md §10 "This year / Last 90 days / Custom, as native date inputs"):
// a plain GET form, so it works without JavaScript. Query: ?period=year|90d|custom&start=YYYY-MM-DD&end=YYYY-MM-DD.
// Unknown or invalid values fall back to "This year", never an error page; a custom period that does not work says
// why (the form shows it on the date fields). Pure and client-safe.
import { isIsoDate } from "@/lib/dates";
import { customPeriod, last90Days, periodLabel, thisYear, type Period } from "./period";

export const PERIOD_CHOICES = ["year", "90d", "custom"] as const;
export type PeriodChoice = (typeof PERIOD_CHOICES)[number];

export const PERIOD_CHOICE_LABELS: Record<PeriodChoice, string> = {
  year: "This year",
  "90d": "Last 90 days",
  custom: "Custom dates",
};

export type CustomPeriodProblem = "missing" | "order";

export const CUSTOM_PERIOD_ERRORS: Record<CustomPeriodProblem, string> = {
  missing: "Enter a start date and an end date.",
  order: "The start date must be on or before the end date.",
};

export interface DashboardPeriod {
  /** The option the form shows as chosen (a custom period that does not work stays "custom", with its error). */
  choice: PeriodChoice;
  /** The period the numbers are for. */
  period: Period;
  /** "Jan 1, 2026 to Dec 31, 2026". */
  label: string;
  /** What the date fields show: the typed values, or the period's own dates. */
  start: string;
  end: string;
  /** Why the custom dates were not used ("This year" is shown instead), or null. */
  problem: CustomPeriodProblem | null;
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function first(input: Params, key: string): string {
  const v = input instanceof URLSearchParams ? input.get(key) : input[key];
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

/** Read the dashboard's period from its search params (at `now`, the server's time). */
export function parseDashboardPeriod(input: Params, now: Date): DashboardPeriod {
  const raw = first(input, "period");
  const choice: PeriodChoice = (PERIOD_CHOICES as readonly string[]).includes(raw) ? (raw as PeriodChoice) : "year";
  const year = thisYear(now);
  const done = (c: PeriodChoice, period: Period, problem: CustomPeriodProblem | null = null, typed?: { start: string; end: string }) => ({
    choice: c,
    period,
    label: periodLabel(period),
    start: typed?.start ?? period.start,
    end: typed?.end ?? period.end,
    problem,
  });
  if (choice === "90d") return done("90d", last90Days(now));
  if (choice === "custom") {
    const start = first(input, "start");
    const end = first(input, "end");
    const typed = { start: isIsoDate(start) ? start : "", end: isIsoDate(end) ? end : "" };
    if (!typed.start || !typed.end) return done("custom", year, "missing", typed);
    const custom = customPeriod(typed.start, typed.end);
    if (!custom) return done("custom", year, "order", typed);
    return done("custom", custom);
  }
  return done("year", year);
}

/** The dashboard URL for a period choice (what the form submits; used by tests and links). */
export function dashboardHref(choice: PeriodChoice, custom?: Period): string {
  if (choice === "year") return "/app/dashboard";
  if (choice === "90d") return "/app/dashboard?period=90d";
  const q = new URLSearchParams({ period: "custom", start: custom?.start ?? "", end: custom?.end ?? "" });
  return `/app/dashboard?${q.toString()}`;
}
