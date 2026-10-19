"use client";

import { useEffect, useId, useRef } from "react";
import { CircleAlert } from "lucide-react";
import { Icon } from "./Icon";

export interface ErrorSummaryItem {
  /** "#field-id": the link moves focus to the field. */
  href: string;
  message: string;
}

interface ErrorSummaryProps {
  errors: ErrorSummaryItem[];
  title?: string;
  /** Focus the summary when errors appear (default). Turn off only on demo pages. */
  focusOnMount?: boolean;
  /**
   * Focus again whenever this changes while errors show, e.g. the action state's `at` after a second failed
   * submit (the summary may stay mounted between the two).
   */
  focusKey?: string | number;
}

/**
 * Shown at the top of a form after a failed submit. It takes focus when errors appear (also when it is always
 * rendered and starts empty) and again on each new `focusKey`, so a screen reader reads it; each line links
 * to its field. Repeat each message on the field itself (Field `error`).
 */
export function ErrorSummary({ errors, title = "There is a problem", focusOnMount = true, focusKey }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = `error-summary-${useId().replace(/:/g, "")}`;
  const hasErrors = errors.length > 0;
  useEffect(() => {
    if (focusOnMount && hasErrors) ref.current?.focus();
  }, [focusOnMount, focusKey, hasErrors]);
  if (errors.length === 0) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="al-notice rounded-lg border-2 border-danger bg-danger-bg p-5 text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <h2 id={titleId} className="flex items-center gap-2 font-sans text-h3 font-bold tracking-normal text-danger">
        <Icon icon={CircleAlert} />
        <span>{title}</span>
      </h2>
      <ul className="mt-3 grid list-none gap-1 p-0">
        {errors.map((e) => (
          <li key={e.href + e.message}>
            <a
              href={e.href}
              className="inline-flex min-h-11 items-center font-bold text-danger underline decoration-2 underline-offset-4 hover:text-danger"
              onClick={(ev) => {
                // Focus the field itself (not only scroll to it), so typing can start right away.
                const target = document.getElementById(e.href.replace(/^#/, ""));
                if (target) {
                  ev.preventDefault();
                  target.focus();
                  target.scrollIntoView({ block: "center" });
                }
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
