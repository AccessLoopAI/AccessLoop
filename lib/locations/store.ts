// An organization's locations (D8 `org_locations`), read and written ONLY through withOrg (a tenant table under
// forced RLS, domain §9). The org always comes from the server: the signed-in lead's org, or the org resolved from
// the report form's slug; a location id from a URL is only ever looked up inside that org. Locations are retired
// (active = false), never deleted: the app role has no DELETE. Server-only.
import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withOrg } from "@/db/tenant";
import { orgLocations } from "@/db/schema";
import type { LocationKindValue } from "@/lib/intake/types";
import { isLocationId, locationPrefill, LOCATIONS_PER_ORG_MAX, type LocationInput, type LocationPrefill } from "./input";

export interface OrgLocation {
  id: string;
  name: string;
  kind: LocationKindValue;
  detail: string | null;
  active: boolean;
  createdAt: Date;
}

const COLUMNS = {
  id: orgLocations.id,
  name: orgLocations.name,
  kind: orgLocations.kind,
  detail: orgLocations.detail,
  active: orgLocations.active,
  createdAt: orgLocations.createdAt,
};

/** Every location of the org: in use first, then by name. */
export async function listLocations(orgId: string): Promise<OrgLocation[]> {
  return withOrg({ orgId, role: "lead" }, (tx) =>
    tx
      .select(COLUMNS)
      .from(orgLocations)
      .where(eq(orgLocations.orgId, orgId))
      .orderBy(desc(orgLocations.active), asc(sql`lower(${orgLocations.name})`), asc(orgLocations.createdAt)),
  );
}

/** One location of the org, or null (unknown id, malformed id, or another org's location: all the same). */
export async function getLocation(orgId: string, id: string): Promise<OrgLocation | null> {
  if (!isLocationId(id)) return null;
  const [row] = await withOrg({ orgId, role: "lead" }, (tx) =>
    tx
      .select(COLUMNS)
      .from(orgLocations)
      .where(and(eq(orgLocations.orgId, orgId), eq(orgLocations.id, id)))
      .limit(1),
  );
  return row ?? null;
}

export type SaveLocationResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate" | "too_many" | "not_found" };

/** Another location in use with the same name (any case), so two posters never look alike. */
async function nameTaken(tx: Tx, orgId: string, name: string, exceptId?: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(orgLocations)
    .where(
      and(
        eq(orgLocations.orgId, orgId),
        eq(orgLocations.active, true),
        sql`lower(${orgLocations.name}) = lower(${name})`,
        exceptId ? ne(orgLocations.id, exceptId) : undefined,
      ),
    );
  return (row?.n ?? 0) > 0;
}

export async function createLocation(orgId: string, input: LocationInput): Promise<SaveLocationResult> {
  return withOrg({ orgId, role: "lead" }, async (tx) => {
    // One lead adding two locations at once is not a race worth a lock: the worst case is two posters of one name.
    const [all] = await tx.select({ n: count() }).from(orgLocations).where(eq(orgLocations.orgId, orgId));
    if ((all?.n ?? 0) >= LOCATIONS_PER_ORG_MAX) return { ok: false, reason: "too_many" } as const;
    if (await nameTaken(tx, orgId, input.name)) return { ok: false, reason: "duplicate" } as const;
    const [row] = await tx
      .insert(orgLocations)
      .values({ orgId, name: input.name, kind: input.kind, detail: input.detail })
      .returning({ id: orgLocations.id });
    return { ok: true, id: row.id } as const;
  });
}

export async function updateLocation(
  orgId: string,
  id: string,
  input: LocationInput & { active: boolean },
): Promise<SaveLocationResult> {
  if (!isLocationId(id)) return { ok: false, reason: "not_found" };
  return withOrg({ orgId, role: "lead" }, async (tx) => {
    if (input.active && (await nameTaken(tx, orgId, input.name, id))) return { ok: false, reason: "duplicate" } as const;
    const rows = await tx
      .update(orgLocations)
      .set({ name: input.name, kind: input.kind, detail: input.detail, active: input.active })
      .where(and(eq(orgLocations.orgId, orgId), eq(orgLocations.id, id)))
      .returning({ id: orgLocations.id });
    return rows.length === 1 ? ({ ok: true, id } as const) : ({ ok: false, reason: "not_found" } as const);
  });
}

/**
 * The report form's pre-fill for `?loc=` (public): only a location IN USE of THIS org (resolved from the slug). An
 * unknown, retired, malformed or other org's id gives null, and the form simply starts empty: it never says why.
 */
export async function findReportLocation(orgId: string, loc: unknown): Promise<LocationPrefill | null> {
  if (!isLocationId(loc)) return null;
  const [row] = await withOrg({ orgId, role: "public" }, (tx) =>
    tx
      .select({ name: orgLocations.name, kind: orgLocations.kind, detail: orgLocations.detail })
      .from(orgLocations)
      .where(and(eq(orgLocations.orgId, orgId), eq(orgLocations.id, loc), eq(orgLocations.active, true)))
      .limit(1),
  );
  return row ? locationPrefill(row) : null;
}
