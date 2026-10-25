// The short-lived cookie that carries the receipt code from "Send report" to the receipt page.
// It holds ONLY the code, is httpOnly + SameSite=Lax, and is scoped to the receipt path of one org.
// The code never goes in a URL query (domain §4). It lives 2 minutes and the receipt page clears it as soon as it
// has shown the code once (receiptSeenPath), so the next person at a shared or kiosk computer can't reopen it
// (Phase 7, T3.10).
export const RECEIPT_COOKIE = "al_receipt";
export const RECEIPT_COOKIE_MAX_AGE_S = 2 * 60;

export function receiptPath(orgSlug: string): string {
  return `/o/${orgSlug}/receipt`;
}

/** POST here once the receipt is on screen: the answer clears the cookie (it is under the cookie's path). */
export function receiptSeenPath(orgSlug: string): string {
  return `${receiptPath(orgSlug)}/seen`;
}

export function reportPath(orgSlug: string): string {
  return `/o/${orgSlug}/report`;
}
