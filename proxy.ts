// Next 16 proxy (formerly middleware). It guards ONLY /app/:path*; every other route stays public. On /api/v1/:path*
// it does one thing more, and only in local development: CORS for the Expo app's web build (lib/api/v1/cors.ts).
// Next 16 runs proxy on the Node.js runtime by default (a `runtime` export is not allowed here), so the
// frozen lib/auth/local-session.ts, which uses node:crypto, works as is.
//
// This is a first gate, not the only one: every staff page also calls requireStaff() (lib/auth/staff.ts),
// which re-checks the cookie AND that the org and member still exist.
//
// Local auth counts only for a request that is for this computer AND did not come through a proxy or tunnel from
// elsewhere (lib/auth/local-request.ts: the Host, X-Forwarded-Host, X-Forwarded-For, X-Real-IP and Forwarded
// headers), so a valid session cookie replayed through ngrok or nginx still lands on /sign-in, which is a 404 there.
import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_SESSION_COOKIE, verifyLocalSession } from "@/lib/auth/local-session";
import { localRequestAllowed } from "@/lib/auth/local-request";
import { SIGNED_OUT } from "@/lib/auth/signed-out";
import { apiV1Cors } from "@/lib/api/v1/cors";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/v1/")) return apiV1(request);
  const signedIn =
    process.env.AUTH_MODE === "local" &&
    localRequestAllowed(request.headers) &&
    verifyLocalSession(request.cookies.get(LOCAL_SESSION_COOKIE)?.value) !== null;
  if (signedIn) return NextResponse.next();
  // A server action (a staff form) with no session: the session ended or the person signed out in another tab.
  // Answer in words, so the form keeps what was typed and says why nothing was saved. Next's client throws a
  // 4xx text/plain body as the Error's message (lib/auth/signed-out.ts); a 303 to the sign-in page would only
  // become "An unexpected response was received from the server." there.
  if (request.method === "POST" && request.headers.has("next-action")) {
    return new NextResponse(SIGNED_OUT, { status: 401, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  }
  // Always the fixed /sign-in path: no "next" or return-to parameter, so no open redirect. 303 turns any other
  // POST into a GET of the sign-in page.
  return NextResponse.redirect(new URL("/sign-in", request.url), 303);
}

/**
 * /api/v1: nothing changes unless lib/api/v1/cors.ts allows this request (AUTH_MODE=local, a request for this
 * computer, Origin http://localhost:8081). Then a preflight is answered here, and the route's own answer gets the
 * CORS headers. Never a redirect or a session check: the API has no sessions (domain §4.1).
 */
function apiV1(request: NextRequest) {
  const cors = apiV1Cors(request);
  if (!cors) return NextResponse.next();
  if (cors.preflight) return new NextResponse(null, { status: 204, headers: cors.headers });
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(cors.headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: ["/app/:path*", "/api/v1/:path*"],
};
