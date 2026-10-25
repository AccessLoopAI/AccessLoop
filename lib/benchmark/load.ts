// Server only: reads data/benchmark/feedback-sections.csv for the "How your Feedback section compares" card. Read on
// every request (a dozen rows), so a row a person verifies counts on the next page load, with no cache to clear.
// Never throws: a missing or refused file hides the card and logs one text-free warning (line numbers and column
// names only, never notes or values).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { benchmarkSummary, parseBenchmarkCsv, type BenchmarkSummary } from "./feedback-sections";

/** The file, relative to the project root (process.cwd() under next start, next dev, vitest and tsx). */
export const BENCHMARK_CSV = path.join("data", "benchmark", "feedback-sections.csv");

let warned = false;
function warnOnce(file: string, message: string) {
  if (warned) return;
  warned = true;
  console.warn(`[benchmark] ${path.basename(file)} not used: ${message}`);
}

/** The verified rows' summary, or null (card hidden): no verified row, or the file is missing or refused. */
export async function loadFeedbackBenchmark(file: string = path.join(process.cwd(), BENCHMARK_CSV)): Promise<BenchmarkSummary | null> {
  let text: string;
  try {
    // turbopackIgnore: without it `next build` traces the whole project into the report pages' server output (its
    // "Dynamic filesystem access" warning); next.config.ts traces exactly data/benchmark/*.csv into /app/reports/*.
    text = await readFile(/*turbopackIgnore: true*/ file, "utf8");
  } catch (err) {
    warnOnce(file, err instanceof Error && "code" in err ? String(err.code) : "unreadable");
    return null;
  }
  const parsed = parseBenchmarkCsv(text);
  if (!parsed.ok) {
    warnOnce(file, parsed.errors.slice(0, 3).join("; "));
    return null;
  }
  return benchmarkSummary(parsed.rows);
}
