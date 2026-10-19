import type { ChangeEvent, ReactNode } from "react";
import { cx } from "./cx";
import { FieldError, errorFrame, fieldIds } from "./Field";
import { Heading } from "./Heading";

export interface RadioOption {
  value: string;
  /** The radio's accessible name. Keep it short and unique within the group. */
  label: ReactNode;
  hint?: ReactNode;
  /** Shown under the option only while it is selected (pure CSS, works without JS). */
  conditional?: ReactNode;
  disabled?: boolean;
}

interface RadioGroupProps {
  /** Unique on the page; option ids are `${id}-${index}`. */
  id: string;
  name: string;
  /** The question. It is the group's accessible name (getByRole("group", { name })). */
  legend: ReactNode;
  /** Render the legend text as a heading inside the <legend> (the step's question). */
  legendHeading?: { level: 2 | 3; focusOnMount?: boolean; focusKey?: string | number };
  /**
   * With `legendHeading`: text the heading reads before the question (the report form's visually hidden "Step 2 of
   * 4: "). The group stays named by the question alone (aria-labelledby on the question's text).
   */
  headingPrefix?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: RadioOption[];
  /** Controlled value (pair with onChange) ... */
  value?: string;
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  /** ... or uncontrolled. */
  defaultValue?: string;
  /**
   * "inline" lays short options (Yes / No) side by side when there is room; "grid" puts several one-word options
   * (Email, Phone, Mail, In person, Other) two to a row from sm and three from lg. Keep "stacked" for options with
   * hints or with conditional content (it would open under one narrow column).
   */
  layout?: "stacked" | "inline" | "grid";
  className?: string;
}

/**
 * Radio buttons in a <fieldset> + <legend>. Each option is a whole clickable row; hints are linked
 * with aria-describedby (outside the label, so names stay exact). Arrow keys move between options natively.
 */
export function RadioGroup({
  id,
  name,
  legend,
  legendHeading,
  headingPrefix,
  hint,
  error,
  options,
  value,
  onChange,
  defaultValue,
  layout = "stacked",
  className,
}: RadioGroupProps) {
  const ids = fieldIds(id);
  const groupDescribedBy = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean).join(" ") || undefined;
  const controlled = value !== undefined;
  return (
    <fieldset
      id={id}
      aria-labelledby={legendHeading && headingPrefix ? `${id}-question` : undefined}
      aria-describedby={groupDescribedBy}
      className={cx("al-radio-group m-0 grid min-w-0 content-start gap-3 border-0 p-0", errorFrame(Boolean(error)), className)}
    >
      {/* float + full width turns the legend into a normal grid item, so the grid gap spaces it. */}
      <legend className={cx("float-left w-full p-0", legendHeading ? "font-bold" : "al-question")}>
        {legendHeading ? (
          <Heading
            level={legendHeading.level}
            focusOnMount={legendHeading.focusOnMount}
            focusKey={legendHeading.focusKey}
            focusable
          >
            {headingPrefix ? (
              <>
                {headingPrefix}
                <span id={`${id}-question`}>{legend}</span>
              </>
            ) : (
              legend
            )}
          </Heading>
        ) : (
          legend
        )}
      </legend>
      {hint ? (
        <div id={ids.hint} className="max-w-[var(--measure)] text-small text-ink-muted">
          {hint}
        </div>
      ) : null}
      {error ? <FieldError id={ids.error}>{error}</FieldError> : null}
      <div
        className={cx(
          "grid gap-3",
          layout === "inline" && "sm:grid-flow-col sm:auto-cols-fr",
          layout === "grid" && "sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {options.map((opt, i) => {
          const optId = `${id}-${i}`;
          const hintId = opt.hint ? `${optId}-hint` : undefined;
          return (
            <div key={opt.value} className="al-choice-item">
              <div className="al-choice al-transition">
                <input
                  type="radio"
                  id={optId}
                  name={name}
                  value={opt.value}
                  disabled={opt.disabled}
                  aria-describedby={hintId}
                  {...(controlled
                    ? { checked: value === opt.value, onChange: (e: ChangeEvent<HTMLInputElement>) => onChange?.(opt.value, e) }
                    : { defaultChecked: defaultValue === opt.value, onChange: onChange ? (e: ChangeEvent<HTMLInputElement>) => onChange(opt.value, e) : undefined })}
                />
                <label htmlFor={optId}>{opt.label}</label>
                {opt.hint ? (
                  <div id={hintId} className="al-choice-hint">
                    {opt.hint}
                  </div>
                ) : null}
              </div>
              {opt.conditional ? <div className="al-conditional">{opt.conditional}</div> : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
