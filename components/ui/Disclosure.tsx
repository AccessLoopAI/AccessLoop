"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "./cx";
import { Icon } from "./Icon";

interface DisclosureProps {
  /** The button text, e.g. "What is this?" or "Sources for this sentence (3 records)". */
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /**
   * inline   = a link-like button ("What is this?")
   * block    = a full-width row with a border (FAQ-style sections)
   * footnote = a small pill that sits inside a sentence; its hit area is still 44x44px
   */
  variant?: "inline" | "block" | "footnote";
  /** Id of the panel (aria-controls). Generated when omitted. */
  panelId?: string;
  panelClassName?: string;
  className?: string;
  onToggle?: (open: boolean) => void;
}

/**
 * A <button aria-expanded> that shows and hides the content right after it. The content is
 * `hidden` while closed, so it is out of the accessibility tree and the Tab order too.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  variant = "inline",
  panelId,
  panelClassName,
  className,
  onToggle,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const autoId = useId();
  const id = panelId ?? `disclosure-${autoId.replace(/:/g, "")}`;
  const Wrapper = variant === "footnote" ? "span" : "div";

  const button = cx(
    "al-transition inline-flex items-center gap-1.5 font-bold text-link",
    variant === "inline" &&
      "min-h-11 -mx-1 rounded-sm px-1 underline decoration-1 underline-offset-4 hover:text-link-hover hover:decoration-2",
    variant === "block" &&
      "min-h-[var(--control-h)] w-full justify-between rounded-md border border-border-strong bg-surface-raised px-4 py-2 text-left text-ink hover:border-ink",
    variant === "footnote" &&
      "al-hit-44 mx-0.5 rounded-pill border border-border-strong bg-surface-raised px-2 py-0 align-baseline text-small leading-snug text-link hover:border-link",
  );

  return (
    <Wrapper className={cx("al-disclosure", className)} data-open={open || undefined}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        className={button}
        onClick={() => {
          setOpen((o) => !o);
          onToggle?.(!open);
        }}
      >
        <span>{summary}</span>
        <Icon
          icon={ChevronDown}
          size="1em"
          strokeWidth={2.5}
          className={cx("motion-safe:transition-transform motion-safe:duration-150", open && "rotate-180")}
        />
      </button>
      <Wrapper
        id={id}
        hidden={!open}
        className={cx(
          variant === "footnote" ? "mt-2 block" : "mt-3",
          variant === "block" && "px-1",
          "max-w-[var(--measure)]",
          panelClassName,
        )}
      >
        {children}
      </Wrapper>
    </Wrapper>
  );
}
