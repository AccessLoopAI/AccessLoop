// The loop motif as a check state (the "Report checks" list): a closed ring with a tick = passed, a ring with a
// cross = missing, an open ring with the amber dot waiting in its gap = still to write (the loop is still open).
// Decorative only (aria-hidden): the state is always in words next to it. When a draft has just been built, the
// ring and tick draw themselves in step with their section (app/globals.css `[data-building] .al-check-ring`, with
// the row's --i), never under reduced motion. The width and height attributes are a fallback only (the CSS sizes
// every ring: 1.25rem, the summary's 1.625rem, the verdict's up to 3.5rem): without them a missing stylesheet drew the
// ring as a page-wide black disc.
import { cx } from "./cx";

export type CheckRingState = "passed" | "missing" | "to_write";

export function CheckRing({ state, className }: { state: CheckRingState; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
      className={cx("al-check-ring", className)}
      data-state={state}
    >
      <circle className="al-check-ring-track" cx="12" cy="12" r="9.5" pathLength={100} />
      {state === "passed" ? <path className="al-check-ring-mark" d="M7.6 12.4l3.1 3.1 5.8-6.3" pathLength={100} /> : null}
      {state === "missing" ? <path className="al-check-ring-mark" d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" pathLength={100} /> : null}
      {state === "to_write" ? <circle className="al-check-ring-dot" cx="18.7" cy="5.3" r="2.1" /> : null}
    </svg>
  );
}
