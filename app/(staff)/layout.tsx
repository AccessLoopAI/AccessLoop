import type { ReactNode } from "react";
import { SignOutForm } from "@/components/layout/SignOutForm";
import { StaffShell } from "@/components/layout/StaffShell";
import { STAFF_ROLE_LABELS, requireStaff, staffNav } from "@/lib/auth/staff";

// Staff area (/app/*). proxy.ts is the first gate; this layout is the second: no signed-in staff member
// -> /sign-in. Each page then checks its own roles with requireStaff([...]) (wrong role -> 404).
// The sign-in page lives outside this group (app/sign-in), so it never shows a Sign out button.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function StaffLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  return (
    <StaffShell
      orgName={staff.orgName}
      userName={staff.displayName}
      userRole={STAFF_ROLE_LABELS[staff.role]}
      nav={staffNav(staff.role)}
      signOut={<SignOutForm />}
    >
      {children}
    </StaffShell>
  );
}
