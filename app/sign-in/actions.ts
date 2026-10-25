"use server";

// Local sign-in (AUTH_MODE=local only). The form names WHO to sign in as; everything else (the org row,
// the membership, the role) is looked up here on the server and never taken from the form.
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { orgMembers, orgs } from "@/db/schema";
import { LOCAL_SESSION_COOKIE, LOCAL_SESSION_MAX_AGE_S, signLocalSession } from "@/lib/auth/local-session";
import { localRequestAllowed } from "@/lib/auth/local-request";
import { staffHome } from "@/lib/auth/staff";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;

export async function signInAsMember(formData: FormData): Promise<void> {
  const h = await headers();
  // Re-check on every POST: the page being visible is not proof the request came from this computer (Host and
  // every forwarding header, lib/auth/local-request.ts).
  if (!localRequestAllowed(h)) notFound();

  const orgSlug = formData.get("org");
  const memberId = formData.get("member");
  if (typeof orgSlug !== "string" || !SLUG.test(orgSlug)) redirect("/sign-in");
  if (typeof memberId !== "string" || !UUID.test(memberId)) redirect("/sign-in");

  const [org] = await db
    .select({ id: orgs.id, clerkOrgId: orgs.clerkOrgId })
    .from(orgs)
    .where(eq(orgs.slug, orgSlug))
    .limit(1);
  if (!org) redirect("/sign-in");

  const [member] = await withOrg({ orgId: org.id, role: "system" }, (tx) =>
    tx
      .select({ clerkUserId: orgMembers.clerkUserId, role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.id, memberId)))
      .limit(1),
  );
  if (!member) redirect("/sign-in");

  const https = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
  (await cookies()).set(LOCAL_SESSION_COOKIE, signLocalSession({ userId: member.clerkUserId, orgClerkId: org.clerkOrgId }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: LOCAL_SESSION_MAX_AGE_S,
    secure: https,
  });

  redirect(staffHome(member.role));
}
