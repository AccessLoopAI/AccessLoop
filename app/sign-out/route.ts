// POST /sign-out: forget the local session, then go to /sign-in. There is no GET (Next answers 405),
// so a link or an email scanner can never sign anyone out.
import { NextResponse } from "next/server";
import { LOCAL_SESSION_COOKIE } from "@/lib/auth/local-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Only the app's own Sign out form may sign a person out. Route handlers don't get the Origin check Next gives
 * server actions, and a cross-site form POST would still apply this response's Set-Cookie (logout CSRF).
 * Browsers send Sec-Fetch-Site (a page can't forge it), so it decides when present; a same-origin POST may
 * still carry `Origin: null` under some referrer policies. Without it (older browsers, curl, tests), Origin
 * decides; a request with neither is not from a cross-site page.
 */
function crossSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true; // "null" or anything else that isn't a URL
  }
}

export async function POST(request: Request) {
  if (crossSite(request)) {
    return new NextResponse(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  // A fixed, relative same-origin path (never built from the Host header); 303 makes the browser GET it.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/sign-in", "Cache-Control": "no-store" } });
  res.cookies.set(LOCAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return res;
}
