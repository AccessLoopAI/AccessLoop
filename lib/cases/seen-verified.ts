// Which just-verified cases this browser has already seen (signature moment 1, staff side). Client-safe.
// The moment plays once per browser, and only for a verification from the last VERIFIED_MOMENT_DAYS days, so the
// seeded history and old cases never move.
export const SEEN_VERIFIED_COOKIE = "al_seen_verified";
export const SEEN_VERIFIED_MAX = 40;
export const VERIFIED_MOMENT_DAYS = 14;

/** A short, non-secret key for a case: the first 12 hex digits of its id. */
export function seenKey(caseId: string): string {
  return caseId.replace(/-/g, "").slice(0, 12).toLowerCase();
}

export function parseSeenVerified(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw.split(".").filter((k) => /^[0-9a-f]{12}$/.test(k));
}

/** Play the moment: verified recently, and this browser has not seen it yet. */
export function playVerifiedMoment(
  c: { status: string; verifiedAt: Date | null; id: string },
  seenCookie: string | undefined,
  now: Date,
): boolean {
  if (c.status !== "verified" || !c.verifiedAt) return false;
  if (now.getTime() - c.verifiedAt.getTime() > VERIFIED_MOMENT_DAYS * 86_400_000) return false;
  return !parseSeenVerified(seenCookie).includes(seenKey(c.id));
}
