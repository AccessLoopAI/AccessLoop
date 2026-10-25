import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { CircleAlert } from "lucide-react";
import { cx } from "./cx";
import { Heading } from "./Heading";
import { Icon } from "./Icon";
import { VisuallyHidden } from "./VisuallyHidden";

/** The attributes Field hands to its control. Spread them onto the <input>/<textarea>/<select>. */
export interface ControlA11yProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export interface FieldShared {
  /** Required: the <label for> and the hint/error ids are built from it. Unique on the page. */
  id: string;
  /** Visible label. Never use a placeholder instead. */
  label: ReactNode;
  /** Help text under the label, linked with aria-describedby. */
  hint?: ReactNode;
  /** Error text. Sets aria-invalid and is linked with aria-describedby. Say what to do, not what went wrong. */
  error?: ReactNode;
  /**
   * Marks the control aria-required. We do not set the native `required` attribute (its browser
   * bubbles are inconsistent and vanish); validate on the server and show an ErrorSummary instead.
   * Label optional fields "(optional)" in the label text, as the reporter flow does.
   */
  required?: boolean;
  /**
   * Put the label inside a heading when the field IS the question of the step
   * (e.g. <h2><label>What got in your way?</label></h2>). The heading can take focus after a step change.
   */
  labelHeading?: { level: 1 | 2 | 3; focusOnMount?: boolean; focusKey?: string | number };
  /**
   * With `labelHeading`: text read before the label inside the heading but outside the <label>, so the heading says
   * it and the control's name stays exactly the label (the report form's visually hidden "Step 1 of 4: ").
   */
  headingPrefix?: ReactNode;
  className?: string;
}

export function fieldIds(id: string) {
  return { hint: `${id}-hint`, error: `${id}-error` };
}

function describedBy(id: string, hint: unknown, error: unknown, extra?: string): string | undefined {
  const ids = [hint ? fieldIds(id).hint : null, error ? fieldIds(id).error : null, extra ?? null].filter(Boolean);
  return ids.length ? ids.join(" ") : undefined;
}

/** Error line used by Field, RadioGroup and Checkbox: icon + "Error:" for screen readers + the message. */
export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="flex items-start gap-2 font-bold text-danger">
      <Icon icon={CircleAlert} className="mt-[0.2em]" />
      <span>
        <VisuallyHidden>Error: </VisuallyHidden>
        {children}
      </span>
    </p>
  );
}

/** Wrapper with a left rule that marks a field (or a group) in error, without relying on colour alone. */
export function errorFrame(hasError: boolean): string {
  return hasError ? "border-l-4 border-danger pl-4" : "";
}

/**
 * Label + hint + error + control, wired for assistive technology. The control is a render prop:
 *   <Field id="x" label="..." hint="...">{(a11y) => <TextInput {...a11y} name="x" />}</Field>
 * Most pages use TextField / TextareaField / SelectField instead.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  labelHeading,
  headingPrefix,
  className,
  describedByExtra,
  children,
}: FieldShared & { describedByExtra?: string; children: (control: ControlA11yProps) => ReactNode }) {
  const ids = fieldIds(id);
  const labelEl = (
    <label htmlFor={id} className={cx("block", labelHeading ? "" : "al-question")}>
      {label}
    </label>
  );
  return (
    <div className={cx("al-field grid content-start gap-2", errorFrame(Boolean(error)), className)}>
      {labelHeading ? (
        <Heading
          level={labelHeading.level}
          focusOnMount={labelHeading.focusOnMount}
          focusKey={labelHeading.focusKey}
          focusable
        >
          {headingPrefix}
          {labelEl}
        </Heading>
      ) : (
        labelEl
      )}
      {hint ? (
        <div id={ids.hint} className="max-w-[var(--measure)] text-small text-ink-muted">
          {hint}
        </div>
      ) : null}
      {error ? <FieldError id={ids.error}>{error}</FieldError> : null}
      {children({
        id,
        "aria-describedby": describedBy(id, hint, error, describedByExtra),
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
    </div>
  );
}

export type InputWidth = "full" | "medium" | "short";
const WIDTH: Record<InputWidth, string> = { full: "", medium: "max-w-[32ch]", short: "max-w-[14ch]" };

/** Bare text input (use inside Field). type="date" and the other native types work too. */
export function TextInput({
  className,
  inputWidth = "full",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { inputWidth?: InputWidth }) {
  return <input type="text" {...props} className={cx("al-control al-transition", WIDTH[inputWidth], className)} />;
}

/** Bare textarea (use inside Field). Grows vertically only. */
export function Textarea({ className, rows = 6, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} {...props} className={cx("al-control al-transition", className)} />;
}

type InputOnly = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "required" | "children" | "className">;

export function TextField({
  id,
  label,
  hint,
  error,
  required,
  labelHeading,
  headingPrefix,
  className,
  inputWidth,
  inputClassName,
  ...input
}: FieldShared & InputOnly & { inputWidth?: InputWidth; inputClassName?: string }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} labelHeading={labelHeading} headingPrefix={headingPrefix} className={className}>
      {(a11y) => <TextInput {...input} {...a11y} inputWidth={inputWidth} className={inputClassName} />}
    </Field>
  );
}

type TextareaOnly = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "required" | "children" | "className">;

export function TextareaField({
  id,
  label,
  hint,
  error,
  required,
  labelHeading,
  headingPrefix,
  className,
  textareaClassName,
  ...textarea
}: FieldShared & TextareaOnly & { textareaClassName?: string }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} labelHeading={labelHeading} headingPrefix={headingPrefix} className={className}>
      {(a11y) => <Textarea {...textarea} {...a11y} className={textareaClassName} />}
    </Field>
  );
}
