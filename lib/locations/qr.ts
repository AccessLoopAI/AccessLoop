// A QR code drawn as one SVG path on the server (Phase 7 T4.5; the `qrcode` package, human decision N1). Nothing is
// sent to a QR service and no script runs in the browser: the poster page renders the path into its own <svg>
// (components/ui/QrCode.tsx). Server-only by use (it is pure, so unit tests check it directly).
import QRCode from "qrcode";

/** The light border every reader needs around the code, in modules (the QR standard asks for 4). */
export const QR_QUIET_ZONE = 4;

export interface QrDrawing {
  /** The text the code holds (the address it opens). */
  text: string;
  /** Width and height in modules, quiet zone included: the SVG's viewBox is `0 0 size size`. */
  size: number;
  /** The dark modules as one path (one rectangle per run of dark modules in a row), offset by the quiet zone. */
  path: string;
  /** QR version (1-40): how big the grid is for this text. */
  version: number;
}

/**
 * Draw `text` as a QR code. Error correction "M" (about 15% of the code can be damaged or dirty and it still reads):
 * a poster on a door gets scratched, and M keeps a long address at a size phones read from an arm's length.
 */
export function qrDrawing(text: string): QrDrawing {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const parts: string[] = [];
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && qr.modules.get(row, col)) col++;
      parts.push(`M${start + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h${col - start}v1h-${col - start}z`);
    }
  }
  return { text, size: n + QR_QUIET_ZONE * 2, path: parts.join(""), version: qr.version };
}
