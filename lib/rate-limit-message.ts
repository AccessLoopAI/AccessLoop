// Client-safe: the words a person sees when a public limit is reached (lib/rate-limit.ts).
// Calm, no blame, says what to do. Shared by server actions, pages and client components.
export const RATE_LIMITED_MESSAGE = "Too many tries from this connection. Please wait a few minutes and try again.";

/**
 * The review step when the hour's AI budget is spent (AI_GLOBAL_HOURLY_LIMIT): the report takes the manual path,
 * exactly as if the summary had failed, and says why in plain words.
 */
export const AI_PAUSED_MESSAGE =
  "Many people are using this form right now, so we did not make a short summary. A staff member will read your words. You can send your report as usual.";

/**
 * "Send report" when the org's form has taken its reports for the day (ORG_DAILY_SUBMISSION_LIMIT). Names the other
 * ways to reach the organization (ACR s.9(3)): the web form is only one of them.
 */
export function orgFullMessage(org: { name: string; contactPhone?: string | null; contactEmail?: string | null }): string {
  const ways = [org.contactPhone ? `by phone at ${org.contactPhone}` : null, org.contactEmail ? `by email at ${org.contactEmail}` : null]
    .filter(Boolean)
    .join(" or ");
  return (
    `This form has taken all the reports it can for today. Your answers are still here. ` +
    `Please try again tomorrow${ways ? `, or tell ${org.name} ${ways}` : `, or contact ${org.name} another way`}.`
  );
}
