import type { ReactNode } from "react";
import { cx } from "./cx";

type CardTag = "div" | "section" | "article" | "aside" | "li";

interface CardProps {
  as?: CardTag;
  /**
   * With a title, give the card an id: the title gets `${id}-title` and a section/article/aside is
   * labelled by it (so <Card as="section" id="your-words" title="Your words"> is the region "Your words").
   */
  id?: string;
  title?: ReactNode;
  titleLevel?: 2 | 3 | 4;
  /** Short line under the title. */
  description?: ReactNode;
  /** Right-aligned controls in the card header (links, small buttons). */
  actions?: ReactNode;
  footer?: ReactNode;
  /** default = surface + hairline; raised = lifted (one per view, for the thing that matters); inset = sunken panel. */
  tone?: "default" | "raised" | "inset";
  padding?: "md" | "lg" | "none";
  children?: ReactNode;
  className?: string;
}

const TONE = {
  default: "bg-surface border border-border",
  raised: "bg-surface-raised border border-border shadow-2",
  inset: "bg-surface-sunken border border-transparent",
} as const;

export function Card({
  as: Tag = "div",
  id,
  title,
  titleLevel = 2,
  description,
  actions,
  footer,
  tone = "default",
  padding = "md",
  children,
  className,
}: CardProps) {
  const titleId = id && title ? `${id}-title` : undefined;
  const labelled = titleId && Tag !== "div" && Tag !== "li" ? titleId : undefined;
  const H = `h${titleLevel}` as const;
  const pad = padding === "none" ? "" : padding === "lg" ? "p-[calc(var(--card-pad)*1.25)]" : "p-[var(--card-pad)]";
  return (
    <Tag id={id} aria-labelledby={labelled} className={cx("al-card min-w-0 rounded-lg", TONE[tone], pad, className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? (
              <H id={titleId} className={titleLevel === 2 ? "text-card-title font-sans font-bold tracking-normal" : undefined}>
                {title}
              </H>
            ) : null}
            {description ? <p className="mt-1 text-small text-ink-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="mt-5 border-t border-border pt-4">{footer}</div> : null}
    </Tag>
  );
}
