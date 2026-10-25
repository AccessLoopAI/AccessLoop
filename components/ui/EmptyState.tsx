import type { ReactNode } from "react";
import { cx } from "./cx";
import { LoopMark } from "./LoopRing";

interface EmptyStateProps {
  title: string;
  titleLevel?: 2 | 3;
  /** Say what will appear here and how to make it appear. */
  children?: ReactNode;
  /** One action that fills the space (a ButtonLink). */
  action?: ReactNode;
  className?: string;
}

/** An empty list or page: an invitation to act, not a mood. */
export function EmptyState({ title, titleLevel = 2, children, action, className }: EmptyStateProps) {
  const H = `h${titleLevel}` as const;
  return (
    <div
      className={cx(
        "al-card flex flex-col items-start gap-4 rounded-lg border border-dashed border-border-strong bg-surface p-[var(--card-pad)] sm:flex-row sm:items-center sm:gap-6",
        className,
      )}
    >
      <span className="text-ink-muted">
        <LoopMark size={56} />
      </span>
      <div className="grid min-w-0 gap-2">
        <H className="font-sans text-h3 font-bold tracking-normal">{title}</H>
        {children ? <div className="max-w-[var(--measure)] text-ink-muted">{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
