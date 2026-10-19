// Shared by Button (a <button>) and ButtonLink (an <a>), so the two always look the same.
// Not a component file: it holds no "use client", so server components can import it too.
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "chrome";
export type ButtonSize = "md" | "lg";

// The focus halo as a ring utility: Tailwind composes --tw-ring-shadow with --tw-shadow (shadow-1, the pressed
// answer's inset shadow), so the halo and the elevation show together. A plain box-shadow halo (the base
// layer's :focus-visible) loses to those utilities. The 3px outline itself still comes from the base layer.
const BASE =
  "al-btn al-transition inline-flex items-center justify-center gap-2.5 rounded-md border-2 font-sans font-bold " +
  "leading-tight text-center no-underline select-none cursor-pointer max-w-full " +
  "focus-visible:ring-[7px] focus-visible:ring-[color:var(--focus-halo)] " +
  "hover:no-underline active:translate-y-px " +
  "disabled:cursor-not-allowed disabled:active:translate-y-0 " +
  "aria-disabled:cursor-progress aria-disabled:active:translate-y-0";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary border-transparent shadow-1 hover:bg-primary-hover hover:text-on-primary " +
    "disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none disabled:border-border",
  secondary:
    "bg-surface-raised text-ink border-border-strong hover:border-ink hover:bg-surface-sunken hover:text-ink " +
    "disabled:text-ink-muted disabled:border-border",
  quiet:
    "bg-transparent text-link border-transparent underline underline-offset-4 decoration-1 " +
    "hover:bg-primary-soft hover:text-link-hover hover:underline disabled:text-ink-muted",
  danger:
    "bg-danger text-on-danger border-transparent shadow-1 hover:bg-danger-hover hover:text-on-danger " +
    "disabled:bg-surface-sunken disabled:text-ink-muted disabled:shadow-none disabled:border-border",
  // Inside the header (the chrome): an outlined button in the header's own colours, the same in both themes
  // (the content-area secondary was a white block on the ink staff header in light mode). The edge is chrome-muted
  // (4.5:1 or more on chrome-bg); chrome-border alone is too faint to read as a button.
  chrome:
    "bg-transparent text-chrome-ink border-chrome-muted hover:bg-chrome-border hover:border-chrome-ink hover:text-chrome-ink " +
    "disabled:text-chrome-muted",
};

// Heights come from the personality tokens: 52/56px on the reporter side, 44/48px on the staff side.
const SIZES: Record<ButtonSize, string> = {
  md: "min-h-[var(--control-h)] px-[var(--control-px)] py-2 text-[length:var(--control-font)]",
  lg: "min-h-[var(--control-h-lg)] px-[calc(var(--control-px)*1.25)] py-2.5 text-[length:calc(var(--control-font)*1.06)]",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  return cx(BASE, VARIANTS[variant], SIZES[size], fullWidth ? "w-full" : "min-w-11", className);
}
