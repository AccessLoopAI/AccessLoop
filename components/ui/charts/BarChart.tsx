"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Table, TBody, THead, Td, Th, Tr } from "../Table";
import { ChartFigure } from "./ChartFigure";
import { CountLink, type ChartValue } from "./CountLink";
import { barPath, px } from "./geometry";

export interface BarRow {
  key: string;
  /** The row's name, in full (domain §1.2 headings are long: the label sits above its bar, never truncated). */
  label: string;
  value: ChartValue;
  /** "muted": a row that is not a category of its own ("Not classified yet"), drawn in grey. */
  tone?: "default" | "muted";
}

interface BarChartProps {
  id: string;
  title: string;
  description?: ReactNode;
  tableCaption: string;
  /** Header of the label column ("Priority area", "Channel") and of the count column ("Barriers", "Received"). */
  labelHeader: string;
  countHeader: string;
  rows: BarRow[];
  footer?: ReactNode;
  testId?: string;
  className?: string;
}

const W = 600;
const PITCH = 52;
const BAR = 16;
const VALUE_ROOM = 44;

/**
 * Horizontal bars, one series (domain §10 "Barriers by priority area", "Intake channels"): each label above its bar,
 * the count at the bar's tip, a zero drawn as a short stub so the row still reads as "none". Decorative SVG; the
 * table carries the data.
 */
export function BarChart({ id, title, description, tableCaption, labelHeader, countHeader, rows, footer, testId, className }: BarChartProps) {
  const router = useRouter();
  const max = Math.max(1, ...rows.map((r) => r.value.count));
  const H = Math.max(1, rows.length) * PITCH;
  const len = (v: number) => (v / max) * (W - VALUE_ROOM);

  const chart = (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" className="al-chart-svg w-full" style={{ maxWidth: W }}>
      {rows.map((r, i) => {
        const top = i * PITCH;
        const barY = top + 24;
        const w = len(r.value.count);
        const href = r.value.href;
        return (
          <g key={r.key}>
            <text x={0} y={top + 16} className="al-chart-label" fontSize={14}>
              {r.label}
            </text>
            {r.value.count > 0 ? (
              <path
                d={barPath(0, barY, Math.max(w, 4), BAR, 4, "right")}
                className="al-mark"
                data-tone={r.tone === "muted" ? "muted" : undefined}
                data-clickable={href ? "" : undefined}
                onClick={href ? () => router.push(href) : undefined}
              />
            ) : (
              <rect x={0} y={barY} width={2} height={BAR} className="al-chart-axis-fill" />
            )}
            <text x={px(Math.max(w, 4) + 8)} y={barY + 13} className="al-chart-value" fontSize={14}>
              {r.value.count}
            </text>
          </g>
        );
      })}
    </svg>
  );

  const table = (
    <Table id={`${id}-table`} caption={tableCaption} captionHidden density="compact">
      <THead>
        <Tr>
          <Th>{labelHeader}</Th>
          <Th numeric>{countHeader}</Th>
        </Tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <Tr key={r.key}>
            <Th scope="row">{r.label}</Th>
            <Td numeric>
              <CountLink value={r.value} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );

  return <ChartFigure id={id} title={title} description={description} chart={chart} table={table} footer={footer} testId={testId} className={className} />;
}
