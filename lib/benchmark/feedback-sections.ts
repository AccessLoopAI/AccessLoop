// The Feedback-section benchmark (docs/archive/phase7-prompt.md T6 item 3; data/benchmark/README.md): what published progress
// reports' Feedback sections cover, scored on seven elements, and what a draft built by AccessLoop covers. Pure and
// client-safe: the CSV text comes in as a string (lib/benchmark/load.ts reads the file on the server). Only rows a
// person checked (`verified_by_human` = true) ever reach a number; with none, the card is hidden.
import type { ReportContent } from "@/lib/report/types";

/** The seven elements, in the CSV's column order. */
export const BENCHMARK_ELEMENTS = [
  {
    key: "total_count",
    label: "How much feedback you received",
    source: "ESDC guidance (recommended)",
  },
  {
    key: "by_area",
    label: "Feedback by area of the Accessible Canada Act",
    source: "ESDC guidance (recommended)",
  },
  {
    key: "by_channel",
    label: "Feedback by how it reached you",
    source: "ESDC guidance (recommended)",
  },
  {
    key: "areas_without_feedback",
    label: "Areas that got no feedback",
    source: "ESDC guidance (recommended)",
  },
  {
    key: "how_considered",
    label: "How feedback was taken into consideration",
    source: "ACA s.71(5) (required)",
  },
  {
    key: "process_changes",
    label: "Changes to your feedback process",
    source: "ESDC guidance (recommended)",
  },
  {
    key: "reporters_confirmed_fixes",
    label: "Whether the people who reported barriers confirmed the fixes",
    source: "AccessLoop (not in the ESDC guidance)",
  },
] as const;

export type BenchmarkElement = (typeof BENCHMARK_ELEMENTS)[number]["key"];
export const BENCHMARK_ELEMENT_KEYS: readonly BenchmarkElement[] = BENCHMARK_ELEMENTS.map((e) => e.key);

export const ESDC_GUIDANCE_URL =
  "https://www.canada.ca/en/employment-social-development/programs/accessible-canada-regulations-guidance/progress-reports/preparing.html";

export const BENCHMARK_HEADER = [
  "source_id",
  "organization",
  "year",
  "report_url",
  ...BENCHMARK_ELEMENT_KEYS,
  "read_by",
  "notes",
  "verified_by_human",
  "verified_by",
  "verified_on",
] as const;

export type ElementValue = "yes" | "partly" | "no" | "unknown";
const ELEMENT_VALUES: readonly ElementValue[] = ["yes", "partly", "no", "unknown"];

export interface BenchmarkRow {
  sourceId: string;
  organization: string;
  year: string;
  reportUrl: string;
  elements: Record<BenchmarkElement, ElementValue>;
  readBy: "review" | "review+agent" | "human";
  notes: string;
  verifiedByHuman: boolean;
  verifiedBy: string;
  verifiedOn: string;
}

/**
 * RFC 4180 CSV: comma-separated, fields optionally in double quotes ("" inside quotes is one "), CRLF or LF line
 * ends. Returns the records; blank lines are skipped. Throws on an unterminated quote.
 */
export function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  let i = 0;
  const src = text.replace(/^﻿/, "");
  const endRecord = () => {
    record.push(field);
    field = "";
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
      i++;
    } else if (ch === ",") {
      record.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      endRecord();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (quoted) throw new Error("unterminated quoted field");
  if (field !== "" || record.length > 0) endRecord();
  return records;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9-]{3,40}$/;

/**
 * Parse and check data/benchmark/feedback-sections.csv. Any problem refuses the WHOLE file (`ok: false`, with
 * text-free messages naming the row and column), so a half-checked file never feeds a number.
 */
export function parseBenchmarkCsv(text: string): { ok: true; rows: BenchmarkRow[] } | { ok: false; errors: string[] } {
  let records: string[][];
  try {
    records = parseCsv(text);
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : "unreadable CSV"] };
  }
  const [header, ...body] = records;
  if (!header || header.join(",") !== BENCHMARK_HEADER.join(",")) {
    return { ok: false, errors: ["the header row is not the one data/benchmark/README.md lists"] };
  }
  const errors: string[] = [];
  const rows: BenchmarkRow[] = [];
  const seen = new Set<string>();
  body.forEach((cells, index) => {
    const line = index + 2;
    if (cells.length !== BENCHMARK_HEADER.length) {
      errors.push(`line ${line}: expected ${BENCHMARK_HEADER.length} columns, found ${cells.length}`);
      return;
    }
    const get = (col: (typeof BENCHMARK_HEADER)[number]) => cells[BENCHMARK_HEADER.indexOf(col)].trim();
    const sourceId = get("source_id");
    if (!ID.test(sourceId)) errors.push(`line ${line}: source_id must be lowercase letters, digits and hyphens`);
    else if (seen.has(sourceId)) errors.push(`line ${line}: source_id ${sourceId} appears twice`);
    seen.add(sourceId);
    const reportUrl = get("report_url");
    if (!/^https:\/\/\S+$/.test(reportUrl)) errors.push(`line ${line}: report_url must be an https address`);
    const elements = {} as Record<BenchmarkElement, ElementValue>;
    for (const key of BENCHMARK_ELEMENT_KEYS) {
      const v = get(key) as ElementValue;
      if (!ELEMENT_VALUES.includes(v)) errors.push(`line ${line}: ${key} must be yes, partly, no or unknown`);
      elements[key] = v;
    }
    const readBy = get("read_by");
    if (readBy !== "review" && readBy !== "review+agent" && readBy !== "human") {
      errors.push(`line ${line}: read_by must be review, review+agent or human`);
    }
    const verified = get("verified_by_human");
    if (verified !== "true" && verified !== "false") errors.push(`line ${line}: verified_by_human must be true or false`);
    const verifiedByHuman = verified === "true";
    const verifiedBy = get("verified_by");
    const verifiedOn = get("verified_on");
    if (verifiedByHuman) {
      for (const key of BENCHMARK_ELEMENT_KEYS) {
        if (elements[key] === "unknown") errors.push(`line ${line}: a verified row has no unknown values (${key})`);
      }
      if (!verifiedBy) errors.push(`line ${line}: a verified row needs verified_by`);
      if (!DAY.test(verifiedOn) || Number.isNaN(Date.parse(`${verifiedOn}T12:00:00Z`))) {
        errors.push(`line ${line}: a verified row needs verified_on as YYYY-MM-DD`);
      }
    }
    rows.push({
      sourceId,
      organization: get("organization"),
      year: get("year"),
      reportUrl,
      elements,
      readBy: readBy as BenchmarkRow["readBy"],
      notes: get("notes"),
      verifiedByHuman,
      verifiedBy,
      verifiedOn,
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, rows };
}

/** How many of the seven elements a row covers fully (`yes` only). */
export function rowScore(row: Pick<BenchmarkRow, "elements">): number {
  return BENCHMARK_ELEMENT_KEYS.filter((k) => row.elements[k] === "yes").length;
}

/** The middle value (the mean of the two middle values for an even count); null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface BenchmarkSummary {
  /** Reports a person checked: the only ones counted. */
  reports: number;
  /** Median of their scores (out of 7). */
  median: number;
  /** For each element, how many of the checked reports cover it fully. */
  covered: Record<BenchmarkElement, number>;
}

/** The published side of the comparison, from verified rows only; null (card hidden) when none is verified. */
export function benchmarkSummary(rows: readonly BenchmarkRow[]): BenchmarkSummary | null {
  const verified = rows.filter((r) => r.verifiedByHuman);
  const m = median(verified.map(rowScore));
  if (m === null) return null;
  const covered = Object.fromEntries(
    BENCHMARK_ELEMENT_KEYS.map((k) => [k, verified.filter((r) => r.elements[k] === "yes").length]),
  ) as Record<BenchmarkElement, number>;
  return { reports: verified.length, median: m, covered };
}

/** Every generated sentence id of a report (claims and claim lists, every section). */
function sentenceIds(content: Pick<ReportContent, "sections">): Set<string> {
  const ids = new Set<string>();
  for (const section of content.sections) {
    for (const block of section.blocks) {
      if (block.kind === "claim") ids.add(block.sentence.id);
      else if (block.kind === "claimList") for (const s of block.sentences) ids.add(s.id);
    }
  }
  return ids;
}

/**
 * Which elements a report built by AccessLoop covers, read from its stored content (lib/report claim ids,
 * lib/report/claims.ts CLAIM): the total sentence says how much came in and through which channels; the
 * "Feedback received in this area: N" sentences give the areas, zeros included, so an area with none is stated;
 * one sentence per fixed case says what was done; the outcome sentence always says how many fixes the person who
 * reported them confirmed. AccessLoop never drafts changes to the feedback process, so a draft never covers it.
 */
export function draftCoverage(content: Pick<ReportContent, "sections" | "settings">): Record<BenchmarkElement, boolean> {
  const ids = sentenceIds(content);
  const has = (id: string) => ids.has(id);
  const areaIds = [...ids].filter((id) => id.startsWith("C:F_AREA:"));
  const plan = content.settings.planAreas;
  return {
    total_count: has("C:F_TOTAL"),
    by_area: areaIds.length > 0,
    by_channel: has("C:F_TOTAL"),
    areas_without_feedback: plan.length > 0 && plan.every((a) => has(`C:F_AREA:${a}`)),
    how_considered: [...ids].some((id) => id.startsWith("C:F_CASE:")),
    process_changes: false,
    reporters_confirmed_fixes: has("C:F_OUTCOME"),
  };
}

/** A median as words: "3", "3.5". */
export function medianLabel(m: number): string {
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}
