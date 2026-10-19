"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";

export type HeadingLevel = 1 | 2 | 3 | 4;

interface HeadingProps {
  level: HeadingLevel;
  children: ReactNode;
  id?: string;
  className?: string;
  /** Move focus here when the component mounts (receipt page, a new step, a submit result). */
  focusOnMount?: boolean;
  /**
   * Move focus here whenever this value changes after the first render (e.g. the step number of a
   * multi-step form). Combine with focusOnMount to also focus on the first render.
   */
  focusKey?: string | number;
  /** Make the heading focusable by script (tabIndex -1) without focusing it now. */
  focusable?: boolean;
  ref?: Ref<HTMLHeadingElement>;
}

/**
 * A heading that can receive focus after a step change or submit (CLAUDE.md: "move focus to the new
 * heading"). It is never in the Tab order (tabIndex -1). Typography comes from app/globals.css base styles.
 */
export function Heading({ level, children, id, className, focusOnMount, focusKey, focusable, ref }: HeadingProps) {
  const inner = useRef<HTMLHeadingElement | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    if (isFirst ? focusOnMount : focusKey !== undefined) {
      inner.current?.focus();
    }
  }, [focusKey, focusOnMount]);

  const setRef = (el: HTMLHeadingElement | null) => {
    inner.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as { current: HTMLHeadingElement | null }).current = el;
  };

  const Tag = `h${level}` as const;
  const canFocus = focusOnMount || focusKey !== undefined || focusable;
  return (
    <Tag ref={setRef} id={id} tabIndex={canFocus ? -1 : undefined} className={className}>
      {children}
    </Tag>
  );
}
