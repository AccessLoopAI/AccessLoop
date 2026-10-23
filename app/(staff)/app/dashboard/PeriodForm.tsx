import Form from "next/form";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { CUSTOM_PERIOD_ERRORS, PERIOD_CHOICES, PERIOD_CHOICE_LABELS, type DashboardPeriod } from "@/lib/metrics";

/**
 * The dashboard's period selector (docs/domain.md §10): a GET form (next/form: a client-side navigation with
 * JavaScript, a normal page load without it), native radios and native date inputs. Nothing happens until "Show
 * this period" is pressed (WCAG 3.2.2); RouteFocus then moves focus to the h1. A custom period that does not work
 * keeps what was typed and says why on the date fields.
 */
export function PeriodForm({ current }: { current: DashboardPeriod }) {
  const problem = current.problem ? CUSTOM_PERIOD_ERRORS[current.problem] : null;
  const startError = problem && (current.problem === "order" || !current.start) ? problem : undefined;
  const endError = problem && current.problem === "missing" && current.start && !current.end ? problem : undefined;
  return (
    <Form action="/app/dashboard" className="min-w-0">
      <SegmentedControl
        id="period"
        name="period"
        legend="Period"
        defaultValue={current.choice}
        options={PERIOD_CHOICES.map((value) => ({
          value,
          label: PERIOD_CHOICE_LABELS[value],
          reveals:
            value === "custom" ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <TextField
                  id="period-start"
                  name="start"
                  type="date"
                  label="Start date"
                  defaultValue={current.start}
                  error={startError}
                  inputWidth="medium"
                />
                <TextField
                  id="period-end"
                  name="end"
                  type="date"
                  label="End date"
                  defaultValue={current.end}
                  error={endError}
                  inputWidth="medium"
                />
              </div>
            ) : undefined,
        }))}
        after={
          <Button type="submit" variant="secondary">
            Show this period
          </Button>
        }
      />
    </Form>
  );
}
