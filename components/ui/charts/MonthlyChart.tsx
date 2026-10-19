"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Table, TBody, THead, Td, Th, Tr } from "../Table";
import { ChartFigure } from "./ChartFigure";
import { CountLink, type ChartValue } from "./CountLink";
import { barPath, countScale, px } from "./geometry";

export interface MonthPair {
  /** "2026-03" */
  month: string;
  /** "Mar" (the axis). */
  short: string;
  /** "Mar 2026" (the table on phones). */
  shortLabel: string;
  /** "March 2026" (the table). */
  label: string;
  received: ChartValue;
  verified: ChartValue;
}

interface MonthlyChartProps {
  id: string;
  title: string;
  description?: ReactNode;
  tableCaption: string;
  months: MonthPair[];
  /** Column headers and legend: "Received", "Verified by reporter". */
  receivedLabel: string;
  verifiedLabel: string;
  testId?: string;
  className?: string;
}

const W = 600;
const LEFT = 30; // tick labels
const TOP = 44; // the legend
const PLOT = 150;
const BASE = TOP + PLOT;
const H = BASE + 30; // month labels

/**
 * Received vs verified per month (domain §10): a pair of columns per month on ONE count axis (same unit, never a
 * second scale). Received is the indigo column on the left, verified the green column on the right; the legend
 * names both, so colour is never the only key. Decorative SVG; the table carries the data.
 */
export function MonthlyChart({ id, title, description, tableCaption, months, receivedLabel, verifiedLabel, testId, className }: MonthlyChartProps) {
  const router = useRouter();
  const n = Math.max(1, months.length);
  const { top, ticks } = countScale(Math.max(0, ...months.flatMap((m) => [m.received.count, m.verified.count])));
  const band = (W - LEFT) / n;
  const bar = Math.max(3, Math.min(18, (band - 10) / 2));
  const y = (v: number) => BASE - (v / top) * PLOT;
  // Label every month while they fit (about 34 units each), else every 2nd, 3rd, ...
  const every = Math.max(1, Math.ceil(34 / band));

  const column = (v: ChartValue, x: number, tone: "received" | "verified", key: string) => {
    if (v.count <= 0) return null;
    const href = v.href;
    return (
      <path
        key={key}
        d={barPath(x, y(v.count), bar, BASE - y(v.count), 4, "up")}
        className="al-mark"
        data-tone={tone === "verified" ? "verified" : undefined}
        data-clickable={href ? "" : undefined}
        onClick={href ? () => router.push(href) : undefined}
      />
    );
  };

  const chart = (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" className="al-chart-svg w-full" style={{ maxWidth: W }}>
      {/* Legend: a swatch beside each name (text in ink, never in the series colour). */}
      <g>
        <rect x={LEFT} y={6} width={14} height={14} rx={3} className="al-mark" />
        <text x={LEFT + 22} y={18} className="al-chart-label" fontSize={14}>
          {receivedLabel}
        </text>
        <rect x={LEFT + 120} y={6} width={14} height={14} rx={3} className="al-mark" data-tone="verified" />
        <text x={LEFT + 142} y={18} className="al-chart-label" fontSize={14}>
          {verifiedLabel}
        </text>
      </g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={LEFT} x2={W} y1={px(y(t)) + 0.5} y2={px(y(t)) + 0.5} className={t === 0 ? "al-chart-axis" : "al-chart-grid"} />
          <text x={LEFT - 8} y={px(y(t)) + 5} textAnchor="end" className="al-chart-tick" fontSize={13}>
            {t}
          </text>
        </g>
      ))}
      {months.map((m, i) => {
        const cx = LEFT + band * i + band / 2;
        return (
          <g key={m.month}>
            {column(m.received, cx - bar - 1, "received", "r")}
            {column(m.verified, cx + 1, "verified", "v")}
            {i % every === 0 ? (
              <text x={px(cx)} y={BASE + 22} textAnchor="middle" className="al-chart-label" fontSize={13}>
                {m.short}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );

  const table = (
    <Table id={`${id}-table`} caption={tableCaption} captionHidden density="compact">
      <THead>
        <Tr>
          <Th>Month</Th>
          <Th numeric className="whitespace-normal!">
            {receivedLabel}
          </Th>
          <Th numeric className="whitespace-normal!">
            {verifiedLabel}
          </Th>
        </Tr>
      </THead>
      <TBody>
        {months.map((m) => (
          <Tr key={m.month}>
            <Th scope="row" className="whitespace-nowrap">
              {/* Phones: "Sep 2026", so the three columns fit at 390 px; wider screens (and the hidden table) say it in full. */}
              <span className="sm:hidden">{m.shortLabel}</span>
              <span className="hidden sm:inline">{m.label}</span>
            </Th>
            <Td numeric>
              <CountLink value={m.received} />
            </Td>
            <Td numeric>
              <CountLink value={m.verified} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );

  return <ChartFigure id={id} title={title} description={description} chart={chart} table={table} testId={testId} className={className} />;
}
