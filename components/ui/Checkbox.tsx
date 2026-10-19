import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { FieldError, errorFrame, fieldIds } from "./Field";

type CheckboxInput = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "children" | "className">;

interface CheckboxProps extends CheckboxInput {
  id: string;
  /** Visible label; it is the checkbox's whole accessible name, so keep hints out of it. */
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Fill the height of its grid row (CheckboxGroup's two columns), so tiles side by side end on one line. */
  stretch?: boolean;
  className?: string;
}

/**
 * A single checkbox as a whole clickable row (label, hint and padding all toggle it).
 * Native input with accent-color, so it stays correct in forced-colors mode and with zoom.
 */
export function Checkbox({ id, label, hint, error, stretch, className, ...input }: CheckboxProps) {
  const ids = fieldIds(id);
  const describedBy = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx(stretch ? "flex flex-col gap-2" : "grid content-start gap-2", errorFrame(Boolean(error)), className)}>
      {error ? <FieldError id={ids.error}>{error}</FieldError> : null}
      {/* stretch: the tile grows to the row's height; content-start keeps its label and hint at the top. */}
      <div className={cx("al-choice al-transition", stretch && "flex-1 content-start")}>
        <input
          type="checkbox"
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          {...input}
        />
        <label htmlFor={id}>{label}</label>
        {hint ? (
          <div id={ids.hint} className="al-choice-hint">
            {hint}
          </div>
        ) : null}
      </div>
    </div>
  );
}
