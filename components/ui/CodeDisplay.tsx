import type { ReactNode } from "react";
import { cx } from "./cx";

interface CodeDisplayProps {
  /** e.g. "7K3M-9Q2D-XW4H-B8RT". Shown in Atkinson Hyperlegible Mono (0 and O, 1 and I look different). */
  code: string;
  /** Text above the code ("Your receipt code"). */
  label?: ReactNode;
  /** Put data-testid="receipt-code" here: the element's text is EXACTLY the code (no spaces, no line breaks). */
  "data-testid"?: string;
  /** id of the element that holds the code (e.g. so a "Copy code" fallback can select it). */
  codeId?: string;
  /**
   * Two groups of eight on two lines (the receipt, /help's example: Phase 7 T4.4), larger at every width. The
   * hyphen between the groups stays in the text (clipped to no width), so the element's text is still exactly the code.
   */
  halves?: boolean;
  /** A line under the code: the receipt's spelled-out reading. */
  reading?: ReactNode;
  className?: string;
  /** Actions under the code ("Copy code", "Download as a text file"). */
  children?: ReactNode;
}

/** One group of four or more, with each hyphen muted and a line-break opportunity after it. */
function Groups({ groups }: { groups: string[] }) {
  return (
    <>
      {groups.map((g, i) => (
        <span key={i}>
          {g}
          {i < groups.length - 1 ? (
            <>
              <span className="text-ink-muted">-</span>
              <wbr />
            </>
          ) : null}
        </span>
      ))}
    </>
  );
}

/**
 * The receipt code as a ticket: big, letter-spaced, monospaced. Groups are plain inline spans with
 * <wbr> after each hyphen, so innerText stays exactly the code and it can still wrap at 320px. Below sm it is set
 * a little smaller and tighter (text-code-narrow), so it stays on one line on a common 360-430px phone. With
 * `halves`, the two groups of eight sit on two lines: the middle hyphen is clipped out of sight (`.al-code-joint`, a
 * 1px inline-block pulled back by 1px, so it is still in innerText, a copied selection and what screen readers read;
 * WebKit leaves a zero-width one out of innerText, and `sr-only` is absolutely positioned, which makes it a block and
 * puts line breaks around it in innerText) and the line break is a CSS one
 * (`.al-code-break`), never a <br> (it would add a line break to the text).
 */
export function CodeDisplay({ code, label, className, children, codeId, halves, reading, ...rest }: CodeDisplayProps) {
  const groups = code.split("-");
  const mid = Math.ceil(groups.length / 2);
  return (
    <div
      className={cx(
        "al-code relative grid gap-4 rounded-xl border-2 border-dashed border-border-strong bg-surface-raised p-[var(--card-pad)] shadow-1",
        className,
      )}
    >
      {label ? <p className="font-bold text-ink">{label}</p> : null}
      <p className="m-0">
        <span
          {...rest}
          id={codeId}
          translate="no"
          className={cx(
            "font-mono font-bold text-ink [font-variant-ligatures:none] select-all",
            halves
              ? "text-code tracking-[0.14em]"
              : "text-code-narrow tracking-[0.08em] sm:text-code sm:tracking-[0.14em]",
          )}
        >
          {halves && groups.length > 1 ? (
            <>
              <span>
                <Groups groups={groups.slice(0, mid)} />
              </span>
              <span className="al-code-joint">-</span>
              <span aria-hidden="true" className="al-code-break" />
              <span>
                <Groups groups={groups.slice(mid)} />
              </span>
            </>
          ) : (
            <Groups groups={groups} />
          )}
        </span>
      </p>
      {reading ? <div className="max-w-[var(--measure)] text-small text-ink-muted">{reading}</div> : null}
      {/* Buttons are never printed (the printed receipt is the code, the reference and how to check). */}
      {children ? (
        <div data-print-hide className="flex flex-wrap gap-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
