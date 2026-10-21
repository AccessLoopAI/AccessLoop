// Public org lookup by slug (public routes). `orgs` is not tenant-scoped (domain §9), so it is read with `db`.
// Server-only. The slug comes from the route; the org id is always this server-side lookup's result.
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs } from "@/db/schema";

/** Slugs look like "maple-harbour". Anything else can't be an org, so callers 404 without a query. */
export const ORG_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export interface PublicOrg {
  id: string;
  slug: string;
  name: string;
  /** Public by law (ACR s.9(1), s.14(2)): who receives feedback, and the other ways to give it (s.9(3)). */
  feedbackDesignateTitle: string;
  contactPhone: string;
  contactEmail: string;
  contactMailingAddress: string;
}

const PUBLIC_FIELDS = {
  id: orgs.id,
  slug: orgs.slug,
  name: orgs.name,
  feedbackDesignateTitle: orgs.feedbackDesignateTitle,
  contactPhone: orgs.contactPhone,
  contactEmail: orgs.contactEmail,
  contactMailingAddress: orgs.contactMailingAddress,
};

/** The org for a public slug, or null. Cached per request (the page and its metadata share one query). */
export const getPublicOrg = cache(async (slug: string): Promise<PublicOrg | null> => {
  if (!ORG_SLUG.test(slug)) return null;
  const [org] = await db.select(PUBLIC_FIELDS).from(orgs).where(eq(orgs.slug, slug)).limit(1);
  return org ?? null;
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The org of an id the SERVER vouches for (a MAC-checked re-test link's claims), never one from a request body or
 * query. Its public profile only. Null for anything that is not an org.
 */
export const getPublicOrgById = cache(async (id: string): Promise<PublicOrg | null> => {
  if (!UUID.test(id)) return null;
  const [org] = await db.select(PUBLIC_FIELDS).from(orgs).where(eq(orgs.id, id)).limit(1);
  return org ?? null;
});
