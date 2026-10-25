// Geometry for the hand-built dashboard charts (docs/domain.md §10). Presentation only: scales, ticks and mark
// shapes. Every value drawn comes from lib/metrics; nothing here counts cases. Pure and client-safe.

/** Round to 2 decimals so the SVG path strings stay short and stable between server and client. */
export const px = (n: number) => Number(n.toFixed(2));

/**
 * A bar whose data end is rounded (radius r) and whose baseline end is square (marks grow from one baseline).
 * "up": a column (x, y = top-left, the top is the data end); "right": a horizontal bar (the right end is the data end).
 */
export function barPath(x: number, y: number, w: number, h: number, r: number, dir: "up" | "right"): string {
  if (w <= 0 || h <= 0) return "";
  if (dir === "up") {
    const k = Math.min(r, w / 2, h);
    return [
      `M${px(x)} ${px(y + h)}`,
      `L${px(x)} ${px(y + k)}`,
      `Q${px(x)} ${px(y)} ${px(x + k)} ${px(y)}`,
      `L${px(x + w - k)} ${px(y)}`,
      `Q${px(x + w)} ${px(y)} ${px(x + w)} ${px(y + k)}`,
      `L${px(x + w)} ${px(y + h)}`,
      "Z",
    ].join(" ");
  }
  const k = Math.min(r, h / 2, w);
  return [
    `M${px(x)} ${px(y)}`,
    `L${px(x + w - k)} ${px(y)}`,
    `Q${px(x + w)} ${px(y)} ${px(x + w)} ${px(y + k)}`,
    `L${px(x + w)} ${px(y + h - k)}`,
    `Q${px(x + w)} ${px(y + h)} ${px(x + w - k)} ${px(y + h)}`,
    `L${px(x)} ${px(y + h)}`,
    "Z",
  ].join(" ");
}

/**
 * A count axis: a clean top value and its gridline ticks (whole numbers only; 1, 2 or 5 times a power of ten).
 * Never below 1, so an all-zero chart still has a scale.
 */
export function countScale(max: number): { top: number; ticks: number[] } {
  const m = Math.max(1, Math.ceil(max));
  if (m <= 5) return { top: m, ticks: Array.from({ length: m + 1 }, (_, i) => i) };
  const raw = m / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((s) => s * pow).find((s) => s >= raw) ?? 10 * pow;
  const top = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += step) ticks.push(t);
  return { top, ticks };
}

/** "Verified by reporter" -> ["Verified by", "reporter"]: a stage label on at most two lines of about `max` characters. */
export function twoLines(label: string, max = 12): [string] | [string, string] {
  if (label.length <= max) return [label];
  const words = label.split(" ");
  let first = "";
  for (const w of words) {
    const next = first ? `${first} ${w}` : w;
    if (next.length > max && first) break;
    first = next;
  }
  const rest = label.slice(first.length).trim();
  return rest ? [first, rest] : [first];
}
