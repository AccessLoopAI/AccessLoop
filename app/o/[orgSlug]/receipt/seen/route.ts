import { NextResponse, type NextRequest } from "next/server";
import { RECEIPT_COOKIE, receiptPath } from "@/lib/intake/receipt-cookie";
import { ORG_SLUG } from "@/lib/orgs";

// The receipt page calls this once it has shown the code (Phase 7 T3.10): the answer clears the receipt cookie, so a
// reload, the Back button after leaving, or the next person at a shared computer finds no code (the cookie also
// expires on its own after 2 minutes). A plain fetch, not a server action: changing a cookie in a server action
// re-renders the page, which would take the code off the screen the person is reading. It reads nothing, stores
// nothing and logs nothing. Only this site's own pages may ask (a cross-site request could only clear the cookie).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ orgSlug: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { orgSlug } = await params;
  if (!ORG_SLUG.test(orgSlug)) return new NextResponse(null, { status: 404 });
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return new NextResponse(null, { status: 403 });
  const res = new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
  // The same attributes as when "Send report" set it (app/o/[orgSlug]/report/actions.ts), so this replaces it.
  const https = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
  res.cookies.set(RECEIPT_COOKIE, "", { httpOnly: true, sameSite: "lax", path: receiptPath(orgSlug), maxAge: 0, secure: https });
  return res;
}
