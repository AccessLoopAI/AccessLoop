import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/staff";
import { listEvalResults } from "@/lib/eval/results";
import { pricesFromEnv } from "@/lib/eval/usage";
import { EvalReport } from "./EvalReport";

// The latest saved AI eval result (lead only; CLAUDE.md "Routes"). The results are files in eval/results written by
// `npm run eval` (eval/runner.ts); they hold no tenant data, so nothing here touches the database. next.config.ts
// traces eval/results/*.json into this route so a deployed build carries them. `?run=<file>` shows another saved run
// (the "Saved runs" table links to each): the name is only looked up in the listing, never used as a path. The price
// constants for an api run's cost per report (AI_PRICES_USD_PER_MTOK, AI_PRICES_SET_ON; lib/eval/usage.ts) are read
// here at request time: they are not secrets, and a missing or malformed value only hides the cost.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "AI evaluation" };

export default async function EvalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireStaff(["lead"]);
  const { run } = await searchParams;
  const listing = await listEvalResults();
  return <EvalReport listing={listing} run={typeof run === "string" ? run : null} prices={pricesFromEnv(process.env)} />;
}
