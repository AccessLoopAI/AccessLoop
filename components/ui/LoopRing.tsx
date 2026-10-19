// The loop motif: one ring, used for the brand mark, the case timeline, the dashboard's
// verified-fix-rate ring and the "Verified by reporter" badge icon. An OPEN ring (with a gap) means
// the loop is still open; a CLOSED ring means the person who reported the barrier confirmed the fix.
//
// Every SVG here is decorative (aria-hidden, no <title>, no focus): the same facts are always in
// real text next to it (domain §10 chart pattern). Colours come from CSS classes in app/globals.css,
// so forced-colors mode can swap them for system colours.
import { cx } from "./cx";
import type { GlyphProps } from "./Icon";

const f = (n: number) => Number(n.toFixed(3));

function polar(c: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [f(c + r * Math.cos(a)), f(c + r * Math.sin(a))];
}

/** A clockwise arc on a circle centred at (c, c), from startDeg to endDeg (0deg = 3 o'clock). */
function arcPath(c: number, r: number, startDeg: number, endDeg: number): string {
  const [x0, y0] = polar(c, r, startDeg);
  const [x1, y1] = polar(c, r, endDeg);
  const sweep = (((endDeg - startDeg) % 360) + 360) % 360;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/* ---------------------------------------------------------------- brand mark */

const MARK_GAP_CENTRE = -48; // degrees: the gap sits at about half past one
const MARK_GAP = 66;
const MARK_ARC = arcPath(16, 11, MARK_GAP_CENTRE + MARK_GAP / 2, MARK_GAP_CENTRE - MARK_GAP / 2 + 360);
const MARK_DOT = polar(16, 11, MARK_GAP_CENTRE);

/**
 * The AccessLoop mark: a ring that is not closed yet, and a dot (the person who reported the barrier)
 * waiting in the gap. Only that person closes the loop.
 */
export function LoopMark({ size = 32, className }: { size?: number | string; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx("shrink-0", className)}
    >
      <path d={MARK_ARC} className="al-logo-ring" strokeWidth={3.4} />
      <circle cx={MARK_DOT[0]} cy={MARK_DOT[1]} r={2.9} className="al-logo-dot" />
    </svg>
  );
}

/* ---------------------------------------------------------------- 24px icons (lucide-compatible) */

const ICON_OPEN_ARC = arcPath(12, 9, -45 + 38, -45 - 38 + 360);
const ICON_OPEN_DOT = polar(12, 9, -45);

/** Open loop: "Fixed, not verified by reporter". Same props as a lucide icon; use with <Icon icon={...} />. */
export function LoopOpenIcon({ strokeWidth = 2, ...rest }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" {...rest}>
      <path d={ICON_OPEN_ARC} />
      <circle cx={ICON_OPEN_DOT[0]} cy={ICON_OPEN_DOT[1]} r={1.6} fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Closed loop with a check: "Verified by reporter". */
export function LoopClosedIcon({ strokeWidth = 2, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      <circle cx={12} cy={12} r={9} />
      <path d="M8.25 12.25l2.6 2.6 4.9-5.1" />
    </svg>
  );
}

/* ---------------------------------------------------------------- segmented ring (timeline) */

export type RingStepState = "done" | "current" | "upcoming";

const SEG_GAP = 20; // degrees between segments (round caps eat about 11 of them)

interface SegmentRingProps {
  states: RingStepState[];
  /** Every stage done AND confirmed by the reporter: the gaps close into one ring with a check. */
  closed?: boolean;
  /** Draw the closing stroke once (the verified moment). Ignored under prefers-reduced-motion. */
  animateClose?: boolean;
  size?: number | string;
  className?: string;
}

export function SegmentRing({ states, closed = false, animateClose = false, size = 88, className }: SegmentRingProps) {
  const n = Math.max(states.length, 1);
  const span = 360 / n;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx("al-ring shrink-0", className)}
      data-closed={closed || undefined}
      data-animate-close={(closed && animateClose) || undefined}
    >
      {states.map((state, i) => {
        const start = -90 + i * span + SEG_GAP / 2;
        const end = -90 + (i + 1) * span - SEG_GAP / 2;
        return (
          <path
            key={i}
            d={arcPath(24, 20, start, end)}
            className="al-ring-seg"
            data-state={closed ? "done" : state}
            strokeWidth={state === "upcoming" && !closed ? 2 : 4}
          />
        );
      })}
      {closed ? (
        <>
          <circle
            cx={24}
            cy={24}
            r={20}
            pathLength={100}
            transform="rotate(-90 24 24)"
            className="al-ring-closer"
            strokeWidth={4.5}
          />
          <path d="M16.5 24.5l5 5 10-10.5" pathLength={100} className="al-ring-check" strokeWidth={3.5} />
        </>
      ) : null}
    </svg>
  );
}

/* ---------------------------------------------------------------- progress ring (dashboard tiles) */

interface ProgressRingProps {
  value: number;
  max: number;
  size?: number | string;
  /** Ring thickness in the 48-unit box (5 = the tiles; the dashboard's headline ring uses a finer 3.5). */
  strokeWidth?: number;
  /** Draw the value arc once on mount (the dashboard's headline). Nothing moves under prefers-reduced-motion. */
  animate?: boolean;
  /** Leave the centre free (no check mark) because text sits in it (the headline ring's percent). */
  hollow?: boolean;
  className?: string;
}

/** A fraction drawn as a ring (e.g. verified-fix rate 7 / 8). A full ring turns into the closed loop. */
export function ProgressRing({ value, max, size = 72, strokeWidth = 5, animate, hollow, className }: ProgressRingProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const full = max > 0 && value >= max;
  const r = 24 - strokeWidth / 2 - 2.5;
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cx("al-ring shrink-0", className)}
      data-closed={full || undefined}
      data-animate-draw={animate || undefined}
    >
      <circle cx={24} cy={24} r={r} className="al-ring-track" strokeWidth={strokeWidth} />
      {pct > 0 ? (
        <circle
          cx={24}
          cy={24}
          r={r}
          pathLength={100}
          strokeDasharray={`${f(pct)} 100`}
          transform="rotate(-90 24 24)"
          className="al-ring-value"
          strokeWidth={strokeWidth}
        />
      ) : null}
      {full && !hollow ? <path d="M17 24.5l4.75 4.75 9.5-10" className="al-ring-check" strokeWidth={3.5} /> : null}
    </svg>
  );
}
