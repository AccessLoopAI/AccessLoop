import { cx } from "./cx";

/**
 * "Step 2 of 4" as real text, with a decorative segmented bar. Never auto-advances. `inHeading`: the step's own
 * heading already says "Step 2 of 4" to screen readers (a visually hidden prefix, where focus lands after a step
 * change), so this visible copy is hidden from them and the words are not read twice.
 */
export function StepIndicator({
  current,
  total,
  inHeading,
  className,
}: {
  current: number;
  total: number;
  inHeading?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("grid gap-2", className)} aria-hidden={inHeading || undefined}>
      <p className="text-small font-bold text-ink-muted">
        Step {current} of {total}
      </p>
      <div aria-hidden="true" className="al-stepbar flex max-w-[20rem] gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            data-done={i < current || undefined}
            className={cx(
              "h-1.5 flex-1 rounded-pill border border-transparent",
              i < current ? "bg-primary" : "bg-border",
            )}
          />
        ))}
      </div>
    </div>
  );
}
