"use server";

// /check (docs/domain.md §4): a typed receipt code -> the reporter's page /r/{code}. Public and rate-limited.
// An unknown or expired code gets one calm answer that never says whether the code ever existed.
// Never log the code.
import { redirect } from "next/navigation";
import { limitRequest, logRateLimitFailure } from "@/lib/rate-limit";
import { formatReceiptCode, normalizeReceiptCode } from "@/lib/receipt-code";
import { loadReporterCase } from "@/lib/reporter-case";
import { CHECK_CODE_MAX, type CheckProblem, type CheckState } from "@/lib/check-code";

export async function checkReceiptCode(_prev: CheckState, form: FormData): Promise<CheckState> {
  const raw = form.get("code");
  const typed = (typeof raw === "string" ? raw : "").trim().slice(0, CHECK_CODE_MAX);
  const problem = (p: CheckProblem): CheckState => ({ problem: p, code: typed, at: Date.now() });

  try {
    if (!(await limitRequest("check")).ok) return problem("rate_limited");
  } catch (err) {
    logRateLimitFailure("could not check the /check limit", err);
    return problem("failed");
  }

  const normalized = normalizeReceiptCode(typed);
  if (!normalized) return problem("format");

  let found: boolean;
  try {
    found = (await loadReporterCase(normalized)) !== null;
  } catch (err) {
    console.error(`[check] could not look up a receipt code (${err instanceof Error ? err.name : "UnknownError"})`);
    return problem("failed");
  }
  if (!found) return problem("unknown");
  redirect(`/r/${formatReceiptCode(normalized)}`);
}
