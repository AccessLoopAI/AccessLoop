import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cx } from "./cx";
import { Disclosure } from "./Disclosure";
import { Icon } from "./Icon";
import { ProgressRing } from "./LoopRing";
import { VisuallyHidden } from "./VisuallyHidden";

interface StatProps {
  /** The tile's heading, e.g. "Verified-fix rate". */
  title: string;
  titleLevel?: 2 | 3;
  /** The headline value as text, e.g. "7 / 8", "14 days", "No real-AI summaries yet". */
  value: ReactNode;
  /** Unit or qualifier shown smaller after the value ("days"). */
  unit?: ReactNode;
  /** One line under the value ("7 verified, 1 fixed but not checked"). */
  detail?: ReactNode;
  /** Draw a ring for a fraction (decorative: the value text says the same). */
  ring?: { value: number; max: number };
  /** Definition behind a "What is this?" disclosure. */
  definition?: ReactNode;
  /** Link to the records behind the number (the filtered inbox). */
  href?: string;
  linkLabel?: string;
  /** "headline" makes the tile span two columns in a tile grid. */
  emphasis?: "default" | "headline";
  /** More content under the detail line (a breakdown list with its own links). */
  children?: ReactNode;
  /** data-testid on the tile (e2e/dashboard.spec.ts reads each tile by it). */
  testId?: string;
  className?: string;
}

/**
 * A metric tile: a heading plus text, never an image. Numbers come from lib/metrics only.
 * Use inside an <ul> grid (each tile in an <li>) or a plain grid.
 */
export function Stat({
  title,
  titleLevel = 3,
  value,
  unit,
  detail,
  ring,
  definition,
  href,
  linkLabel = "See the cases",
  emphasis = "default",
  children,
  testId,
  className,
}: StatProps) {
  const H = `h${titleLevel}` as const;
  const isText = typeof value === "string" && !/\d/.test(value);
  return (
    <div
      data-testid={testId}
      className={cx(
        "al-card al-stat flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-5",
        emphasis === "headline" && "shadow-2 sm:col-span-2",
        className,
      )}
    >
      <H className="font-sans text-small font-bold tracking-normal text-ink-muted">{title}</H>
      <div className="flex items-center gap-4">
        {ring ? <ProgressRing value={ring.value} max={ring.max} size={emphasis === "headline" ? 88 : 64} /> : null}
        {/* Proportional figures for a standalone number (tabular digits look loose at this size). */}
        <p data-stat-value="" className={cx("min-w-0", isText ? "text-lead font-bold text-ink" : "font-display text-stat font-semibold text-ink")}>
          {value}
          {/* A real space before the unit, so the text reads "14 days" / "16 of 22", not "14days". */}
          {unit ? (
            <>
              {" "}
              <span className="font-sans text-lead font-bold text-ink-muted">{unit}</span>
            </>
          ) : null}
        </p>
      </div>
      {detail ? <p className="text-small text-ink-muted">{detail}</p> : null}
      {children}
      {/* The footer sits at the bottom of the tile. A tile in the grid has two fixed rows, "What is this?" then the
          link, and a tile with nothing to link keeps that second row empty: wrapped side by side, the narrow tiles'
          rows never lined up (one tile's "What is this?" sat on the others' "See the cases" row). The headline
          tile is wide enough for one row. */}
      {definition || href ? (
        <div
          className={cx(
            "mt-auto pt-1",
            emphasis === "headline" ? "flex flex-wrap items-center justify-between gap-x-4 gap-y-1" : "grid justify-items-start gap-y-1",
          )}
        >
          {definition ? (
            <Disclosure
              summary={
                <>
                  What is this?<VisuallyHidden>{` (${title})`}</VisuallyHidden>
                </>
              }
              panelClassName="text-small text-ink"
              className="text-small"
            >
              {definition}
            </Disclosure>
          ) : null}
          {href ? (
            <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-small font-bold">
              <span>
                {linkLabel}
                <VisuallyHidden>{` for ${title}`}</VisuallyHidden>
              </span>
              <Icon icon={ArrowRight} size="1em" />
            </Link>
          ) : definition && emphasis !== "headline" ? (
            <span aria-hidden="true" className="min-h-11" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
