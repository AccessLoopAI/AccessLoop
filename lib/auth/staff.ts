// Staff identity: the ONE place staff pages learn who is signed in and which org they act for.
// Server-only (Node runtime): it reads cookies/headers and the database. Never import it from a client component.
//
// AUTH_MODE=local (the prototype): a signed cookie from the frozen lib/auth/local-session.ts names a seeded
// staff user; it only counts for a request to this computer that no proxy forwarded from elsewhere
// (localRequestAllowed, lib/auth/local-request.ts). AUTH_MODE=clerk: the adapter is added at "Going live"; until
// then there is no adapter and nobody is signed in (see resolveStaff).
// orgId is always our orgs.id, resolved here on the server. Never take an org from a request body or query.
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { orgMembers, orgs } from "@/db/schema";
import { LOCAL_SESSION_COOKIE, verifyLocalSession } from "@/lib/auth/local-session";
import { localRequestAllowed } from "@/lib/auth/local-request";
import type { StaffNavItem } from "@/components/layout/staff-nav-current";

export type StaffRole = "lead" | "owner" | "auditor";

export const STAFF_ROLES: readonly StaffRole[] = ["lead", "owner", "auditor"];

export interface Staff {
  orgId: string;
  memberId: string;
  role: StaffRole;
  displayName: string;
}

export interface StaffOrg extends Staff {
  orgName: string;
  orgSlug: string;
}

/** The role in words, shown under the signed-in name in the staff header. */
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  lead: "Lead",
  owner: "Owner",
  auditor: "Auditor (read only)",
};

/** Where each role lands after sign-in and on /app: leads and auditors on the dashboard (domain §10), owners on My work. */
export function staffHome(role: StaffRole): "/app/dashboard" | "/app/my-work" {
  return role === "owner" ? "/app/my-work" : "/app/dashboard";
}

/**
 * Primary navigation by role (docs: CLAUDE.md "Routes"). Lead: Dashboard, Inbox, Log feedback, My work, Reports,
 * Outbox, Eval, Settings; auditor: Dashboard, Inbox, Reports; owner: My work. Staff intake is "Log feedback", never
 * "New report" (that name belongs to the Phase 4 report generator's link).
 */
export function staffNav(role: StaffRole): StaffNavItem[] {
  const items: StaffNavItem[] = [];
  // A case page belongs to the section its back link returns to: the Inbox (lead, auditor) or My work (owner).
  const cases = ["/app/cases/"];
  if (role === "lead" || role === "auditor") items.push({ href: "/app/dashboard", label: "Dashboard" });
  if (role === "lead" || role === "auditor") items.push({ href: "/app/inbox", label: "Inbox", section: cases });
  if (role === "lead") items.push({ href: "/app/cases/new", label: "Log feedback" });
  if (role === "lead") items.push({ href: "/app/my-work", label: "My work" });
  if (role === "owner") items.push({ href: "/app/my-work", label: "My work", section: cases });
  // Phase 4: progress reports (lead; auditor read-only). Never labelled "New report" (demo.spec's link name). A
  // report's evidence check (/verify/[id], outside /app) belongs to it: its "Back to the report" returns there.
  if (role === "lead" || role === "auditor") items.push({ href: "/app/reports", label: "Reports", section: ["/verify/"] });
  if (role === "lead") items.push({ href: "/app/outbox", label: "Outbox" });
  if (role === "lead") items.push({ href: "/app/eval", label: "Eval" }); // the latest saved AI eval result
  if (role === "lead") items.push({ href: "/app/settings", label: "Settings" });
  return items;
}

let warnedNoAdapter = false;

// One lookup per request: the staff layout and the page both ask, React's cache() dedupes it.
const resolveStaff = cache(async (): Promise<StaffOrg | null> => {
  const mode = process.env.AUTH_MODE;
  if (mode === "clerk") {
    // No Clerk adapter yet (it comes at "Going live", docs/handoff.md; Phase 7 Wave 2): with no adapter nobody is
    // signed in. Public pages that ask, such as /verify/[reportId], render their signed-out view instead of
    // throwing; /app/* never gets here (proxy.ts sends it to /sign-in, a 404 outside local mode). Said once per
    // server, with no request details.
    if (!warnedNoAdapter) {
      warnedNoAdapter = true;
      console.warn("AUTH_MODE=clerk: no Clerk adapter is installed yet, so every staff request is treated as signed out.");
    }
    return null;
  }
  if (mode !== "local") return null;

  if (!localRequestAllowed(await headers())) return null;

  const session = verifyLocalSession((await cookies()).get(LOCAL_SESSION_COOKIE)?.value);
  if (!session) return null;

  // orgs is not tenant-scoped: read it directly, by the org named in the signed session.
  const [org] = await db
    .select({ id: orgs.id, name: orgs.name, slug: orgs.slug })
    .from(orgs)
    .where(eq(orgs.clerkOrgId, session.orgClerkId))
    .limit(1);
  if (!org) return null;

  const [member] = await withOrg({ orgId: org.id, role: "system" }, (tx) =>
    tx
      .select({ id: orgMembers.id, role: orgMembers.role, displayName: orgMembers.displayName })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, org.id), eq(orgMembers.clerkUserId, session.userId)))
      .limit(1),
  );
  if (!member) return null;

  return {
    orgId: org.id,
    memberId: member.id,
    role: member.role,
    displayName: member.displayName,
    orgName: org.name,
    orgSlug: org.slug,
  };
});

/** The signed-in staff member, or null. */
export async function getStaff(): Promise<Staff | null> {
  const s = await resolveStaff();
  return s ? { orgId: s.orgId, memberId: s.memberId, role: s.role, displayName: s.displayName } : null;
}

/** getStaff() plus the org's name and slug (for the staff header). */
export async function getStaffOrg(): Promise<StaffOrg | null> {
  return resolveStaff();
}

/**
 * For staff pages: no staff -> redirect to /sign-in; a role that may not open this page -> 404
 * (owners and others get 404, not 403, so a page's existence is not confirmed).
 */
export async function requireStaff(allowed: readonly StaffRole[] = STAFF_ROLES): Promise<StaffOrg> {
  const s = await resolveStaff();
  if (!s) redirect("/sign-in");
  if (!allowed.includes(s.role)) notFound();
  return s;
}
