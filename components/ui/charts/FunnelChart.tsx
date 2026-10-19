"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Table, TBody, THead, Td, Th, Tr } from "../Table";
import { ChartFigure } from "./ChartFigure";
import { CountLink, type ChartValue } from "./CountLink";
import { barPath, px, twoLines } from "./geometry";

export interface FunnelStage {
  key: string;
  /** "Fix logged", "Verified by reporter". */
  label: string;
  value: ChartValue;
  /** "verified" draws the last stage in the closed-loop colour (also told by its label and position). */
  tone?: "default" | "verified";
}

interface FunnelChartProps {
  id: string;
  title: string;
  description?: ReactNode;
  tableCaption: string;
  stages: FunnelStage[];
  aside?: ReactNode;
  testId?: string;
  className?: string;
}

const W = 680;
const COL = 76;
const TOP = 40; // room for the count above the tallest column
const PLOT = 150;
const BASE = TOP + PLOT;
const H = BASE + 58; // two lines of stage labels under the baseline

/**
 * The loop funnel (domain §10): one column per stage, in loop order, joined by soft bands that show where cases
 * stop. Counts sit on the caps; the stage names under the baseline. Decorative SVG; the table carries the data.
 */
export function FunnelChart({ id, title, description, tableCaption, stages, aside, testId, className }: FunnelChartProps) {
  const router = useRouter();
  const n = stages.length;
  const gap = n > 1 ? (W - n * COL) / (n - 1) : 0;
  const max = Math.max(1, ...stages.map((s) => s.value.count));
  const geo = stages.map((s, i) => {
    const h = (s.value.count / max) * PLOT;
    return { s, x: i * (COL + gap), h, y: BASE - h };
  });

  const chart = (
    <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false" className="al-chart-svg w-full" style={{ maxWidth: W }}>
      {geo.slice(0, -1).map((g, i) => {
        const next = geo[i + 1];
        return (
          <polygon
            key={`band-${g.s.key}`}
            className="al-chart-band"
            points={`${px(g.x + COL)},${px(g.y)} ${px(next.x)},${px(next.y)} ${px(next.x)},${BASE} ${px(g.x + COL)},${BASE}`}
          />
        );
      })}
      <line x1={0} x2={W} y1={BASE + 0.5} y2={BASE + 0.5} className="al-chart-axis" />
      {geo.map((g) => {
        const href = g.s.value.href;
        const lines = twoLines(g.s.label);
        return (
          <g key={g.s.key}>
            {g.h > 0 ? (
              <path
                d={barPath(g.x, g.y, COL, g.h, 4, "up")}
                className="al-mark"
                data-tone={g.s.tone === "verified" ? "verified" : undefined}
                data-clickable={href ? "" : undefined}
                onClick={href ? () => router.push(href) : undefined}
              />
            ) : null}
            <text x={px(g.x + COL / 2)} y={px(g.y - 12)} textAnchor="middle" className="al-chart-value" fontSize={22}>
              {g.s.value.count}
            </text>
            {lines.map((line, li) => (
              <text key={li} x={px(g.x + COL / 2)} y={BASE + 24 + li * 18} textAnchor="middle" className="al-chart-label" fontSize={14}>
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );

  const table = (
    <Table id={`${id}-table`} caption={tableCaption} captionHidden density="compact">
      <THead>
        <Tr>
          <Th>Stage</Th>
          <Th numeric>Cases</Th>
        </Tr>
      </THead>
      <TBody>
        {stages.map((s) => (
          <Tr key={s.key}>
            <Th scope="row">{s.label}</Th>
            <Td numeric>
              <CountLink value={s.value} />
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );

  return <ChartFigure id={id} title={title} description={description} chart={chart} table={table} aside={aside} testId={testId} className={className} />;
}
