import type { ReactNode } from "react";
import { Checkbox } from "./Checkbox";
import { cx } from "./cx";
import { FieldError, errorFrame, fieldIds } from "./Field";

export interface CheckboxOption {
  value: string;
  /** The checkbox's accessible name. Keep it short and unique within the group. */
  label: ReactNode;
  hint?: ReactNode;
}

interface CheckboxGroupProps {
  /** Unique on the page; option ids are `${id}-${index}` (link an ErrorSummary line to `${id}-0`). */
  id: string;
  /** Every checkbox shares this name, so FormData.getAll(name) lists the ticked values. */
  name: string;
  /** The question. It is the group's accessible name (getByRole("group", { name })). */
  legend: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: CheckboxOption[];
  /** Uncontrolled: the values ticked at first. */
  defaultValues?: readonly string[];
  /** "two" lays the rows out in two columns when there is room. */
  columns?: "one" | "two";
  className?: string;
}

/**
 * Several checkboxes answering one question ("Choose all that apply"): a <fieldset> + <legend> around Checkbox rows.
 * The group's hint and error are linked to the fieldset with aria-describedby, so they are read with the question.
 */
export function CheckboxGroup({ id, name, legend, hint, error, options, defaultValues = [], columns = "one", className }: CheckboxGroupProps) {
  const ids = fieldIds(id);
  const describedBy = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean).join(" ") || undefined;
  return (
    <fieldset
      id={id}
      aria-describedby={describedBy}
      className={cx("m-0 grid min-w-0 content-start gap-3 border-0 p-0", errorFrame(Boolean(error)), className)}
    >
      <legend className="al-question float-left w-full p-0">{legend}</legend>
      {hint ? (
        <div id={ids.hint} className="max-w-[var(--measure)] text-small text-ink-muted">
          {hint}
        </div>
      ) : null}
      {error ? <FieldError id={ids.error}>{error}</FieldError> : null}
      <div className={cx("grid gap-3", columns === "two" && "md:grid-cols-2")}>
        {options.map((opt, i) => (
          <Checkbox
            key={opt.value}
            id={`${id}-${i}`}
            name={name}
            value={opt.value}
            label={opt.label}
            hint={opt.hint}
            defaultChecked={defaultValues.includes(opt.value)}
            stretch={columns === "two"}
          />
        ))}
      </div>
    </fieldset>
  );
}
