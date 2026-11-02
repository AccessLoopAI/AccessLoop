// The E1 labelling sheet (issue #21; eval/README.md "New fixtures"): two people label the area of each candidate
// report on their own, then this measures how far they agree before they settle the differences.
//
//   npm run eval:e1 -- sheet   (eval/e1.ts) write eval/fixtures/e1-labelling.csv from eval/fixtures/e1-candidates.json
//                              (refuses to overwrite a sheet that already has a label in it)
//   npm run eval:e1 -- kappa [sheet.csv]   Cohen's kappa on the two primary-area columns, the plain agreement, and the ids
//                              where the two people differ (only rows both of them labelled count)
//
// A label is one area key (eval/score.ts AREAS) or "none" (too vague to file: the AI should abstain). The acceptable
// columns are area keys separated by ";". Nothing here calls an AI or changes the candidates file: once the two
// people agree, a person writes the labels into the candidates and renames the file (eval/README.md).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PRIORITY_AREAS } from "@/lib/report/headings";

/** The E1 candidate reports (eval/fixtures/), run only with `--set visible --draft-check` until their labels are settled. */
export const E1_CANDIDATES_FILE = "e1-candidates.json";
export const SHEET_FILE = "e1-labelling.csv";
export const SHEET_COLUMNS = [
  "id", "lang", "input_mode", "location_kind", "tags", "text",
  "a_primary", "a_acceptable", "b_primary", "b_acceptable", "notes",
] as const;
type Row = Record<(typeof SHEET_COLUMNS)[number], string>;

/** One area key or "none". */
export const LABELS: readonly string[] = [...PRIORITY_AREAS, "none"];

/** RFC 4180: a field is quoted when it holds a comma, a quote or a line break; quotes are doubled. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(field).join(",")).join("\r\n") + "\r\n";
}

/** The inverse of toCsv (also reads what a spreadsheet saves: LF or CRLF, a trailing newline or not, a BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += ch;
  }
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

/**
 * Cohen's kappa for two raters over the same items: (observed agreement - chance agreement) / (1 - chance
 * agreement), chance agreement from each rater's own label shares. 1 = full agreement, 0 = what chance would give.
 */
export function cohensKappa(a: readonly string[], b: readonly string[]): { n: number; agreement: number; kappa: number } {
  if (a.length !== b.length) throw new Error("the two raters must label the same items");
  const n = a.length;
  if (n === 0) return { n, agreement: 0, kappa: 0 };
  const agree = a.filter((x, i) => x === b[i]).length / n;
  const share = (xs: readonly string[], k: string) => xs.filter((x) => x === k).length / n;
  const chance = [...new Set([...a, ...b])].reduce((sum, k) => sum + share(a, k) * share(b, k), 0);
  const kappa = chance === 1 ? 1 : (agree - chance) / (1 - chance);
  return { n, agreement: agree, kappa };
}

interface Candidate {
  id: string;
  lang: string;
  inputMode: string;
  locationKind: string;
  tags: string[];
  text: string;
  expected: { primaryArea: string | null };
}

/** The sheet's rows for the candidates, label columns empty. Refuses candidates that already carry an area. */
export function sheetRows(candidates: readonly Candidate[]): string[][] {
  const labelled = candidates.find((c) => c.expected.primaryArea !== null);
  if (labelled) throw new Error(`${labelled.id} already has an area: the candidates stay unlabelled until both people agree`);
  return [
    [...SHEET_COLUMNS],
    ...candidates.map((c) => [c.id, c.lang, c.inputMode, c.locationKind, c.tags.join(";"), c.text, "", "", "", "", ""]),
  ];
}

/** The labelled rows of a sheet, checked: known ids, known labels. */
export function readSheet(csv: string): Row[] {
  const [head, ...body] = parseCsv(csv);
  if (!head || SHEET_COLUMNS.some((c, i) => head[i] !== c)) throw new Error(`the first row must be: ${SHEET_COLUMNS.join(",")}`);
  return body.map((cells, r) => {
    const row = Object.fromEntries(SHEET_COLUMNS.map((c, i) => [c, (cells[i] ?? "").trim()])) as Row;
    for (const col of ["a_primary", "b_primary"] as const) {
      if (row[col] && !LABELS.includes(row[col])) throw new Error(`row ${r + 2} (${row.id}): ${col} "${row[col]}" is not one of ${LABELS.join(", ")}`);
    }
    for (const col of ["a_acceptable", "b_acceptable"] as const) {
      const bad = row[col].split(";").map((x) => x.trim()).filter(Boolean).find((x) => !(PRIORITY_AREAS as readonly string[]).includes(x));
      if (bad) throw new Error(`row ${r + 2} (${row.id}): ${col} "${bad}" is not an area key`);
    }
    return row;
  });
}

export function kappaReport(rows: readonly Row[]): string {
  const both = rows.filter((r) => r.a_primary && r.b_primary);
  const { n, agreement, kappa } = cohensKappa(both.map((r) => r.a_primary), both.map((r) => r.b_primary));
  const differ = both.filter((r) => r.a_primary !== r.b_primary).map((r) => r.id);
  if (n === 0) return `Nobody has filled in both label columns yet (0 of ${rows.length} rows).`;
  const lines = [
    `Rows labelled by both people: ${n} of ${rows.length}.`,
    `Primary area: agreement ${(agreement * 100).toFixed(1)}%, Cohen's kappa ${kappa.toFixed(3)}.`,
    differ.length ? `Settle these ${differ.length}: ${differ.join(", ")}.` : "No disagreements on the primary area.",
  ];
  if (n < rows.length) lines.push(`Still to label: ${rows.filter((r) => !(r.a_primary && r.b_primary)).map((r) => r.id).join(", ")}.`);
  return lines.join("\n");
}

/** `npm run eval:e1 -- sheet | kappa` (eval/e1.ts). Returns the exit code. */
export function e1Cli(argv: readonly string[]): number {
  const dir = path.join(process.cwd(), "eval", "fixtures");
  const sheet = path.join(dir, SHEET_FILE);
  const cmd = argv[0];
  if (cmd === "sheet") {
    if (existsSync(sheet) && readSheet(readFileSync(sheet, "utf8")).some((r) => r.a_primary || r.b_primary || r.a_acceptable || r.b_acceptable)) {
      console.error(`eval/fixtures/${SHEET_FILE} already has labels in it; not overwriting.`);
      return 1;
    }
    const candidates = JSON.parse(readFileSync(path.join(dir, E1_CANDIDATES_FILE), "utf8")) as Candidate[];
    writeFileSync(sheet, `\uFEFF${toCsv(sheetRows(candidates))}`); // the BOM makes spreadsheet apps read the French as UTF-8
    console.log(`Wrote eval/fixtures/${SHEET_FILE}: ${candidates.length} rows, label columns empty.`);
    return 0;
  }
  if (cmd === "kappa") {
    // An optional path: the holdout's own sheet, which a person keeps outside the project (docs/dev/holdout-howto.md).
    console.log(kappaReport(readSheet(readFileSync(argv[1] ? path.resolve(argv[1]) : sheet, "utf8"))));
    return 0;
  }
  console.error("Usage: npm run eval:e1 -- sheet | kappa [sheet.csv]");
  return 2;
}
