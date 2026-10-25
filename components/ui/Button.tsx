"use client";

import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-styles";
import { Icon } from "./Icon";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Icon element before the label, e.g. iconStart={<Icon icon={Send} />}. */
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  /**
   * Work in progress. The label (and so the accessible name) stays the same, a spinner appears,
   * aria-disabled is set and further clicks do nothing (no double submit). Focus stays on the button.
   * For type="submit" inside a <form action={fn}>, pending is read from useFormStatus() automatically.
   * Announce progress through useAnnounce() (StatusRegion), never by changing the label.
   */
  pending?: boolean;
}

/**
 * The only <button> in the app. type defaults to "button"; pass type="submit" for form submits.
 * Use `disabled` only when the action is truly unavailable; prefer showing an error after submit.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  iconStart,
  iconEnd,
  pending: pendingProp,
  type = "button",
  className,
  onClick,
  ...rest
}: ButtonProps) {
  const form = useFormStatus();
  const pending = pendingProp ?? (type === "submit" && form.pending);

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (pending) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
  }

  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      aria-disabled={pending || undefined}
      data-pending={pending || undefined}
      data-variant={variant}
      onClick={handleClick}
      {...rest}
    >
      {pending ? <Icon icon={LoaderCircle} className="animate-spin" /> : iconStart}
      <span>{children}</span>
      {iconEnd}
    </button>
  );
}
