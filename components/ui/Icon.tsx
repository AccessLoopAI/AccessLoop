import type { ComponentType } from "react";
import { cx } from "./cx";

/** Props every glyph accepts: lucide-react icons and the custom loop icons in LoopRing.tsx. */
export interface GlyphProps {
  className?: string;
  width?: number | string;
  height?: number | string;
  strokeWidth?: number | string;
  "aria-hidden"?: boolean | "true" | "false";
  focusable?: "true" | "false";
}

export type Glyph = ComponentType<GlyphProps>;

interface IconProps {
  /** A lucide-react icon (import { Wrench } from "lucide-react") or a loop icon from LoopRing.tsx. */
  icon: Glyph;
  /** CSS size; defaults to 1.25em so the icon scales with the text next to it. */
  size?: number | string;
  strokeWidth?: number;
  className?: string;
}

/**
 * Decorative icon. ALWAYS aria-hidden: an icon sits next to visible text that carries the meaning
 * (CLAUDE.md). Uses currentColor, so it follows the text colour and forced-colors mode.
 */
export function Icon({ icon: G, size = "1.25em", strokeWidth = 2, className }: IconProps) {
  return (
    <G
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={cx("al-icon inline-block shrink-0", className)}
    />
  );
}
