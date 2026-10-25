// FROZEN. Local prototype sign-in (AUTH_MODE=local): replaces Clerk so the prototype needs no accounts.
// A signed, httpOnly cookie names a seeded staff user. It ONLY works on localhost and never on Vercel.
import { timingSafeEqual } from "node:crypto";
import { hmacHex } from "@/lib/crypto";

export const LOCAL_SESSION_COOKIE = "al_local_session";
export const LOCAL_SESSION_MAX_AGE_S = 12 * 60 * 60;

export interface LocalSession {
  userId: string;     // org_members.clerk_user_id, e.g. "local_alex"
  orgClerkId: string; // orgs.clerk_org_id, e.g. "local_org_maple"
  iat: number;        // issued-at, epoch seconds
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True only when local auth is switched on AND the request is for a local host AND we're not on Vercel. */
export function localAuthAllowed(hostHeader: string | null): boolean {
  if (process.env.AUTH_MODE !== "local" || process.env.VERCEL) return false;
  if (!hostHeader) return false;
  const host = hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
  return LOCAL_HOSTS.has(host.toLowerCase());
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export function signLocalSession(s: Omit<LocalSession, "iat">, now = Date.now()): string {
  const body = b64(JSON.stringify({ userId: s.userId, orgClerkId: s.orgClerkId, iat: Math.floor(now / 1000) }));
  return `${body}.${hmacHex("SESSION_SECRET", body)}`;
}

export function verifyLocalSession(token: string | undefined | null, now = Date.now()): LocalSession | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(hmacHex("SESSION_SECRET", body), "hex");
  const given = Buffer.from(mac, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LocalSession;
    if (typeof s.userId !== "string" || typeof s.orgClerkId !== "string" || typeof s.iat !== "number") return null;
    if (Math.floor(now / 1000) - s.iat > LOCAL_SESSION_MAX_AGE_S) return null;
    return s;
  } catch {
    return null;
  }
}
