// E2E-only fixture (never imported by the app): an org's poster locations (Phase 7 T4.5), made with the app's own
// lib/locations/store.ts (withOrg, under the app role's RLS). Uses the app's one db/client pool, like the other
// fixtures: never end it in a spec. Specs share one database and locations are never deleted, so a fixture either
// makes a uniquely named location or reuses one by name.
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orgs } from "@/db/schema";
import type { LocationKindValue } from "@/lib/intake/types";
import { createLocation, listLocations, updateLocation } from "@/lib/locations/store";

async function orgIdOf(slug: string): Promise<string> {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!org) throw new Error(`org ${slug} is not in the database (run npm run local:setup)`);
  return org.id;
}

export interface LocationSpec {
  name: string;
  kind: LocationKindValue;
  detail?: string | null;
  active?: boolean;
}

/** A new location (its name must be unique among the org's locations in use); returns its id. */
export async function addLocation(slug: string, spec: LocationSpec): Promise<string> {
  const orgId = await orgIdOf(slug);
  const made = await createLocation(orgId, { name: spec.name, kind: spec.kind, detail: spec.detail ?? null });
  if (!made.ok) throw new Error(`could not add the location (${made.reason})`);
  if (spec.active === false) {
    await updateLocation(orgId, made.id, { name: spec.name, kind: spec.kind, detail: spec.detail ?? null, active: false });
  }
  return made.id;
}

/** The org's location in use with this name, made once and reused by later runs (the key-pages walk). */
export async function ensureLocation(slug: string, spec: Omit<LocationSpec, "active">): Promise<string> {
  const orgId = await orgIdOf(slug);
  const found = (await listLocations(orgId)).find((l) => l.active && l.name === spec.name);
  return found ? found.id : addLocation(slug, spec);
}
