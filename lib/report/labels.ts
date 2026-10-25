// Words the report pages and the plain-text export share. No imports, so client components can use it without
// pulling the report compiler into the browser bundle. Pure.

/** "Sources for this sentence (3 records)": the footnote button's exact name (domain §7.9, e2e/demo.spec.ts). */
export function sourcesButtonName(count: number): string {
  return `Sources for this sentence (${count} ${count === 1 ? "record" : "records"})`;
}

/**
 * What a cited case with no public summary says in its place (Sources lists, /verify, the plain-text export). A case
 * closed before triage (spam cited by the "not accessibility feedback" fact, D6; a duplicate closed from new) was
 * never reviewed and never will be, so it is not "waiting" (review finding, docs/decisions.md 2026-10-21).
 */
export function noSummaryWords(status: string | undefined): string {
  return status === "closed" ? "Closed before review (no public summary)" : "Waiting for review";
}

/** The longest text a lead may write in one section of a report (plain text). */
export const LEAD_TEXT_MAX = 4000;

/**
 * Set by "Generate draft" to the new report's id (not secret; path /app/reports, two minutes): the draft page plays
 * the building animation and announces "Draft ready" once, and the page's script deletes it.
 */
export const BUILT_COOKIE = "al_built";

/** Where AccessLoop publishes the public keys that check a report's signature (docs/domain.md §8). */
export const SIGNING_KEYS_PATH = "/.well-known/accessloop-signing-keys.json";

/** The offline checker for an evidence bundle (tools/verify-bundle.mjs), served as a download. */
export const VERIFIER_PATH = "/verify/verify-bundle.mjs";

/** The published report's evidence bundle (lib/report/bundle.ts), under its public page. */
export function evidenceBundlePath(orgSlug: string, reportId: string): string {
  return `/p/${orgSlug}/reports/${reportId}/evidence.json`;
}
