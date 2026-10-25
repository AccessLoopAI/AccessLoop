import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cx } from "./cx";
import { Icon, type Glyph } from "./Icon";
import { VisuallyHidden } from "./VisuallyHidden";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const TONE: Record<NoticeTone, { box: string; title: string; icon: Glyph; prefix: string }> = {
  info: { box: "bg-info-bg border-info-border", title: "text-info", icon: Info, prefix: "Information: " },
  success: { box: "bg-success-bg border-success-border", title: "text-success", icon: CircleCheck, prefix: "Success: " },
  warning: { box: "bg-warning-bg border-warning-border", title: "text-warning", icon: TriangleAlert, prefix: "Warning: " },
  danger: { box: "bg-danger-bg border-danger-border", title: "text-danger", icon: CircleAlert, prefix: "Important: " },
};

interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  /** "p" (default) keeps the outline clean; use a heading level only when the notice starts a section. */
  titleAs?: 2 | 3 | 4 | "p";
  children?: ReactNode;
  className?: string;
}

/**
 * An inline message that stays on the page. It is NOT a live region (the page has exactly one, the
 * StatusRegion); to announce a change, also call useAnnounce(). Tone is icon + title + colour.
 */
export function Notice({ tone = "info", title, titleAs = "p", children, className }: NoticeProps) {
  const t = TONE[tone];
  const H = titleAs === "p" ? "p" : (`h${titleAs}` as const);
  return (
    <div
      data-tone={tone}
      className={cx("al-notice flex gap-3 rounded-lg border border-l-[6px] p-4 text-ink sm:gap-4 sm:p-5", t.box, className)}
    >
      <span className={cx("mt-[0.15em]", t.title)}>
        <Icon icon={t.icon} size="1.35em" />
      </span>
      <div className="grid min-w-0 gap-1">
        {title ? (
          <H className={cx("font-sans text-body font-bold tracking-normal", t.title)}>{title}</H>
        ) : (
          <VisuallyHidden>{t.prefix}</VisuallyHidden>
        )}
        {children ? <div className="max-w-[var(--measure)]">{children}</div> : null}
      </div>
    </div>
  );
}
