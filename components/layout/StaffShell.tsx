import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { StaffNav, type StaffNavItem } from "./StaffNav";

interface StaffShellProps {
  orgName?: string;
  /** Signed-in staff member, e.g. "Alex Rivera". */
  userName?: string;
  /** Their role in words, e.g. "Lead". */
  userRole?: string;
  nav?: StaffNavItem[];
  /** The sign-out control: SignOutForm (<form method="post" action="/sign-out"> with a "chrome" Button "Sign out"). */
  signOut?: ReactNode;
  children: ReactNode;
}

/**
 * Staff pages: the command centre. Ink top bar (sticky on large screens) with the navigation as a second row of tabs,
 * wide content area, 16px type. The sign-in page passes no nav, so its header is one row.
 */
export function StaffShell({ orgName, userName, userRole, nav = [], signOut, children }: StaffShellProps) {
  return (
    <div data-personality="staff" className="flex min-h-dvh flex-col">
      <SiteHeader
        variant="staff"
        sticky
        orgName={orgName}
        nav={nav.length > 0 ? <StaffNav items={nav} /> : undefined}
        utility={
          userName || signOut ? (
            <>
              {userName ? (
                // On phones the name has its own line under the organization, with "Sign out" and "Get help" under it
                // at the right (beside the buttons it was squeezed into three lines); the role line shows from sm.
                <p className="flex flex-col justify-center text-ui-sm leading-tight text-chrome-muted max-sm:basis-full sm:min-h-11">
                  <span className="font-bold text-chrome-ink">{userName}</span>
                  {userRole ? <span className="hidden sm:block">{userRole}</span> : null}
                </p>
              ) : null}
              {signOut}
            </>
          ) : null
        }
      />
      <main id="main" tabIndex={-1} className="flex-1">
        <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6 sm:py-10">{children}</div>
      </main>
      <SiteFooter wide />
    </div>
  );
}
