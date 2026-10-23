import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { Eye, Inbox, LogIn, Wrench } from "lucide-react";
import { db } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { orgMembers, orgs } from "@/db/schema";
import { StaffShell } from "@/components/layout/StaffShell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon, type Glyph } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { localRequestAllowed } from "@/lib/auth/local-request";
import { STAFF_ROLE_LABELS, type StaffRole } from "@/lib/auth/staff";
import { signInAsMember } from "./actions";

// Local prototype sign-in (AUTH_MODE=local). It exists only on this computer: on any other host, through a proxy
// or tunnel that forwards from elsewhere (lib/auth/local-request.ts), or in any other auth mode, this route is a
// 404. Clerk's <SignIn /> replaces it at "Going live".
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

const ROLE_ICON: Record<StaffRole, Glyph> = { lead: Inbox, owner: Wrench, auditor: Eye };

const ROLE_SUMMARY: Record<StaffRole, string> = {
  lead: "Sees every case, approves redaction, can reveal the original (always logged), triages, assigns and writes the progress report.",
  owner: "Sees only the cases assigned to them, with names and contact details removed, and logs fixes.",
  auditor: "Sees cases once the lead has checked them for names and contact details, and the reports, but can't change anything.",
};

interface OrgWithMembers {
  id: string;
  slug: string;
  name: string;
  members: { id: string; displayName: string; role: StaffRole }[];
}

async function loadOrgsWithMembers(): Promise<OrgWithMembers[]> {
  const all = await db
    .select({ id: orgs.id, slug: orgs.slug, name: orgs.name })
    .from(orgs)
    .orderBy(asc(orgs.createdAt), asc(orgs.name));
  return Promise.all(
    all.map(async (org) => ({
      ...org,
      members: await withOrg({ orgId: org.id, role: "system" }, (tx) =>
        tx
          .select({ id: orgMembers.id, displayName: orgMembers.displayName, role: orgMembers.role })
          .from(orgMembers)
          .where(eq(orgMembers.orgId, org.id))
          .orderBy(asc(orgMembers.role), asc(orgMembers.displayName)),
      ),
    })),
  );
}

export default async function SignInPage() {
  if (!localRequestAllowed(await headers())) notFound();
  const list = await loadOrgsWithMembers();
  const withPeople = list.filter((o) => o.members.length > 0);

  return (
    <StaffShell>
      {/* On the shell's left edge, like every other staff page (it was centred under a left-aligned header). */}
      <div className="grid max-w-[64rem] gap-[var(--stack-lg)]">
        <PageHeader
          title="Sign in"
          description="Choose who you want to be. Each person sees AccessLoop the way their role allows."
        />

        <Notice tone="info" title="This sign-in only works on this computer">
          It is for trying AccessLoop locally with made-up organizations and people, so there are no passwords. It is
          turned off on any other web address.
        </Notice>

        {withPeople.length === 0 ? (
          <EmptyState title="No one to sign in as yet">
            The local database has no staff. Run <code>npm run local:setup</code> to add the made-up demo organizations
            and their people, then reload this page.
          </EmptyState>
        ) : (
          withPeople.map((org) => (
            <section key={org.id} aria-labelledby={`org-${org.slug}`} className="grid gap-4">
              <h2 id={`org-${org.slug}`}>{org.name}</h2>
              <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
                {org.members.map((m) => {
                  const describedBy = `member-${m.id}-role`;
                  return (
                    <li key={m.id} className="al-card grid content-start gap-3 rounded-lg border border-border bg-surface p-[var(--card-pad)]">
                      <p id={describedBy} className="flex gap-3 text-small text-ink-muted">
                        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-pill bg-primary-soft text-primary">
                          <Icon icon={ROLE_ICON[m.role]} size="1.15rem" />
                        </span>
                        <span>
                          <span className="block font-bold text-ink">{STAFF_ROLE_LABELS[m.role]}</span>
                          <span className="block">{ROLE_SUMMARY[m.role]}</span>
                        </span>
                      </p>
                      <form action={signInAsMember}>
                        <input type="hidden" name="org" value={org.slug} />
                        <input type="hidden" name="member" value={m.id} />
                        <Button
                          type="submit"
                          variant="secondary"
                          fullWidth
                          aria-describedby={describedBy}
                          iconEnd={<Icon icon={LogIn} />}
                          className="py-3! [&>span]:grow [&>span]:text-left"
                        >
                          <span className="block text-small font-normal text-ink-muted">Sign in as </span>
                          <span className="block text-lead">{m.displayName} </span>
                          {/* The organization is the section's heading just above, so it is not shown again on every
                              button; it stays in the name, after the visible words (WCAG 2.5.3). */}
                          <VisuallyHidden>({org.name})</VisuallyHidden>
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </StaffShell>
  );
}
