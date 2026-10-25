import { cx } from "./cx";
import { VisuallyHidden } from "./VisuallyHidden";

interface HashChipProps {
  /** Full hex hash (64 chars for sha256). */
  hash: string;
  /** What the hash is, for screen readers: "Record hash", "Previous record". */
  label?: string;
  /** How many leading characters to show. */
  length?: number;
  /** muted: a record the check could not vouch for (after a broken link) or one written after the report. */
  tone?: "default" | "success" | "danger" | "muted";
  /** Inside a drawing that is aria-hidden as a whole (the evidence chain): no screen-reader text, no tooltip. */
  decorative?: boolean;
  className?: string;
}

const TONE = {
  default: "bg-surface-sunken text-ink border-border",
  success: "bg-success-bg text-success border-success-border",
  danger: "bg-danger-bg text-danger border-danger",
  muted: "bg-surface text-ink-muted border-border-strong border-dashed",
} as const;

/** A short hash chip: sighted users see the first characters; screen readers get the full value. */
export function HashChip({ hash, label = "Hash", length = 8, tone = "default", decorative, className }: HashChipProps) {
  return (
    <span
      title={decorative ? undefined : hash}
      data-tone={tone}
      className={cx(
        "al-chip inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-small font-bold tracking-wide",
        TONE[tone],
        className,
      )}
      translate="no"
    >
      <span aria-hidden="true">
        {hash.slice(0, length)}
        {hash.length > length ? "…" : ""}
      </span>
      {decorative ? null : <VisuallyHidden>{`${label}: ${hash}`}</VisuallyHidden>}
    </span>
  );
}
