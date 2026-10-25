// Who may run the daily job: a request with `Authorization: Bearer ${CRON_SECRET}` (docs/phase7-prompt.md T3 item 12).
// Vercel Cron sends exactly that header when the project has CRON_SECRET set; a human can send it with curl.
// CRON_SECRET comes from lib/env.ts secretFromEnv (derived from SESSION_SECRET in local mode, required elsewhere).
// Server-only (node:crypto). The comparison is constant-time over fixed-length digests, so neither the secret nor its
// length leaks through timing. The header and the secret are never logged.
import { createHash, timingSafeEqual } from "node:crypto";

const BEARER = /^Bearer[ \t]+(\S+)[ \t]*$/i;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** True only when the Authorization header carries exactly this secret as a Bearer token. */
export function bearerMatches(header: string | null | undefined, secret: string): boolean {
  if (!secret || typeof header !== "string") return false;
  const token = BEARER.exec(header)?.[1];
  if (!token) return false;
  return timingSafeEqual(digest(token), digest(secret));
}
