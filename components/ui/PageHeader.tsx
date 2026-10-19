import type { ReactNode } from "react";
import { cx } from "./cx";
import { Heading } from "./Heading";

interface PageHeaderProps {
  /** Small context line above the title (org name, "Step 2 of 4", a case ref). Sentence case, never all caps. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Primary page actions, right-aligned on wide screens. */
  actions?: ReactNode;
  /** Status badge, dates and other facts under the title. */
  meta?: ReactNode;
  /** 1 on every page (exactly one h1). 2 only for a header inside a page (e.g. the design page demo). */
  level?: 1 | 2;
  /** Focus the title on mount (pages reached by a submit, like the receipt). */
  focusOnMount?: boolean;
  /** Use the large display size (landing and reporter pages). */
  display?: boolean;
  id?: string;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  level = 1,
  focusOnMount,
  display,
  id,
  className,
}: PageHeaderProps) {
  return (
    <header className={cx("al-page-header mb-[var(--stack)] grid gap-3", className)}>
      {eyebrow ? <p className="text-small font-bold text-ink-muted">{eyebrow}</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-[var(--measure)] grow basis-[28rem]">
          <Heading level={level} id={id} focusOnMount={focusOnMount} focusable className={display ? "text-display" : undefined}>
            {title}
          </Heading>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
      {meta ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-small text-ink-muted">{meta}</div> : null}
      {description ? <div className="max-w-[var(--measure)] text-lead text-pretty text-ink">{description}</div> : null}
    </header>
  );
}
