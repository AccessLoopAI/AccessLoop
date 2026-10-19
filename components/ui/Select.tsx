import type { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";
import { Field, type FieldShared, type InputWidth } from "./Field";
import { Icon } from "./Icon";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type SelectOnly = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "className">;

const WIDTH: Record<InputWidth, string> = { full: "w-full", medium: "w-full max-w-[32ch]", short: "w-full max-w-[16ch]" };

/**
 * Native <select> (never a custom listbox). The chevron is an aria-hidden icon in currentColor,
 * so it survives forced-colors mode. Pass `options` or <option> children.
 */
export function Select({
  options,
  placeholderOption,
  children,
  className,
  selectWidth = "full",
  ...props
}: SelectOnly & {
  options?: SelectOption[];
  /** A first, empty option such as "Choose a team". Its value is "". */
  placeholderOption?: string;
  children?: ReactNode;
  className?: string;
  selectWidth?: InputWidth;
}) {
  return (
    <span className={cx("relative block", WIDTH[selectWidth])}>
      <select {...props} className={cx("al-control al-transition", className)}>
        {placeholderOption !== undefined ? <option value="">{placeholderOption}</option> : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink">
        <Icon icon={ChevronDown} size="1.25em" />
      </span>
    </span>
  );
}

export function SelectField({
  id,
  label,
  hint,
  error,
  required,
  labelHeading,
  className,
  ...select
}: FieldShared & SelectOnly & {
  options?: SelectOption[];
  placeholderOption?: string;
  children?: ReactNode;
  selectWidth?: InputWidth;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required} labelHeading={labelHeading} className={className}>
      {(a11y) => <Select {...select} {...a11y} />}
    </Field>
  );
}
