import type { QrDrawing } from "@/lib/locations/qr";
import { cx } from "./cx";

/**
 * A QR code drawn on the server (lib/locations/qr.ts): black modules on white with the quiet zone, in every theme
 * and in forced-colors mode (`.al-qr`: a reader needs dark on light, so the code never takes the theme's colours).
 * It is an image with a name (`label`, e.g. "QR code for the report form"); the address it opens must also be
 * printed next to it as text, for people who can't scan (the poster does). Never a link or a button.
 */
export function QrCode({ drawing, label, className }: { drawing: QrDrawing; label: string; className?: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${drawing.size} ${drawing.size}`}
      shapeRendering="crispEdges"
      className={cx("al-qr block h-auto w-full", className)}
      data-qr-text={drawing.text}
    >
      <rect width={drawing.size} height={drawing.size} fill="#fff" />
      <path d={drawing.path} fill="#000" />
    </svg>
  );
}
