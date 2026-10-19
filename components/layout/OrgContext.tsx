"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { OrgContact } from "./OrgContacts";

const OrgContactContext = createContext<OrgContact | null>(null);

/**
 * The organization of an org-scoped segment (app/o/[orgSlug]/layout.tsx), for the client error page under it: when a
 * page there fails, app/error.tsx can still show "Other ways to reach {org}" (Phase 7 T4.1). Public fields only.
 */
export function OrgContactProvider({ org, children }: { org: OrgContact | null; children?: ReactNode }) {
  return <OrgContactContext.Provider value={org}>{children}</OrgContactContext.Provider>;
}

/** The segment's organization, or null outside an org-scoped segment (or when its lookup failed). */
export function useOrgContact(): OrgContact | null {
  return useContext(OrgContactContext);
}
