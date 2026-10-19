import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./button-styles";

interface ButtonLinkProps {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  className?: string;
  /** Renders a plain <a download> (e.g. "Download as a text file") instead of a Next <Link>. */
  download?: string | boolean;
  /** Plain <a> for routes that must not be prefetched or that are handled outside the app router. */
  plain?: boolean;
  "data-testid"?: string;
}

/** A link that looks like a button. It navigates; if it changes data, use a <form> with a Button. */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  fullWidth,
  iconStart,
  iconEnd,
  className,
  download,
  plain,
  ...rest
}: ButtonLinkProps) {
  const cls = buttonClasses({ variant, size, fullWidth, className });
  const inner = (
    <>
      {iconStart}
      <span>{children}</span>
      {iconEnd}
    </>
  );
  if (download !== undefined || plain) {
    return (
      <a href={href} download={download === true ? "" : download || undefined} className={cls} data-variant={variant} {...rest}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} data-variant={variant} {...rest}>
      {inner}
    </Link>
  );
}
