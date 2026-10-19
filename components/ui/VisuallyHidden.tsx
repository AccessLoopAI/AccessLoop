import type { ReactNode } from "react";

/** Text for screen readers only (still read, still translated, never display:none). */
export function VisuallyHidden({ children, as: Tag = "span" }: { children: ReactNode; as?: "span" | "div" | "p" }) {
  return <Tag className="sr-only">{children}</Tag>;
}
