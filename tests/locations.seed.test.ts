// Locations (Phase 7 T4.5, D8 org_locations) against a seeded in-memory Postgres (the migrations, the app role, the
// security SQL and the seed, as `npm run db:smoke` builds it): adding, listing, editing and retiring a location, the
// report form's pre-fill (only a location IN USE of the org the slug names), and the API's ?loc=. The in-memory
// database connects as its superuser, so these tests check the queries' own org filter; db:smoke and the e2e suite
// check the row-level security under the app role.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.77" }) }));

let seeded: SeededDb | undefined;
let sql: ReturnType<typeof postgres>;
const org = { maple: "", lakeview: "" };
const saved = { ...process.env };

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env, { FAKE_LLM: "1", AI_BACKEND: "fake", FAKE_EMAIL: "1" });
  sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  for (const [key, slug] of [["maple", "maple-harbour"], ["lakeview", "lakeview-telecom"]] as const) {
    org[key] = (await sql<{ id: string }[]>`select id from orgs where slug = ${slug}`)[0].id;
  }
}, 240_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 }).catch(() => {});
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

const store = () => import("@/lib/locations/store");

describe("a lead's locations", () => {
  it("adds, lists (in use first, by name), edits and retires a location, never across orgs", async () => {
    const { createLocation, getLocation, listLocations, updateLocation } = await store();
    const main = await createLocation(org.maple, { name: "Main Street branch", kind: "place", detail: "front entrance" });
    const phone = await createLocation(org.maple, { name: "Phone banking line", kind: "phone_or_service", detail: null });
    expect(main.ok && phone.ok).toBe(true);
    if (!main.ok || !phone.ok) return;

    const list = await listLocations(org.maple);
    expect(list.map((l) => [l.name, l.kind, l.detail, l.active])).toEqual([
      ["Main Street branch", "place", "front entrance", true],
      ["Phone banking line", "phone_or_service", null, true],
    ]);
    expect(await listLocations(org.lakeview)).toEqual([]);

    // Another org's lead can neither read nor change it (the same answer as an unknown id).
    expect(await getLocation(org.lakeview, main.id)).toBeNull();
    expect(await updateLocation(org.lakeview, main.id, { name: "Taken", kind: "other", detail: null, active: false })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect((await getLocation(org.maple, main.id))?.name).toBe("Main Street branch");
    expect(await getLocation(org.maple, "not-a-uuid")).toBeNull();

    // Retire it: it goes to the end of the list.
    expect(await updateLocation(org.maple, main.id, { name: "Main Street branch", kind: "place", detail: "front entrance", active: false })).toEqual({
      ok: true,
      id: main.id,
    });
    expect((await listLocations(org.maple)).map((l) => [l.name, l.active])).toEqual([
      ["Phone banking line", true],
      ["Main Street branch", false],
    ]);
  });

  it("refuses a second location in use with the same name (any case), but not in another org", async () => {
    const { createLocation, updateLocation } = await store();
    const first = await createLocation(org.maple, { name: "Harbour Road branch", kind: "place", detail: null });
    expect(first.ok).toBe(true);
    expect(await createLocation(org.maple, { name: "harbour road BRANCH", kind: "place", detail: null })).toEqual({ ok: false, reason: "duplicate" });
    expect((await createLocation(org.lakeview, { name: "Harbour Road branch", kind: "place", detail: null })).ok).toBe(true);
    // Renaming another location to it is refused too; a retired one may share it.
    const other = await createLocation(org.maple, { name: "Online banking", kind: "digital", detail: null });
    if (!other.ok) throw new Error("not added");
    expect(await updateLocation(org.maple, other.id, { name: "Harbour Road branch", kind: "digital", detail: null, active: true })).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect((await updateLocation(org.maple, other.id, { name: "Harbour Road branch", kind: "digital", detail: null, active: false })).ok).toBe(true);
  });
});

describe("the report form's pre-fill (?loc=)", () => {
  it("is the location's answers, only for a location in use of the slug's own org", async () => {
    const { createLocation, findReportLocation, updateLocation } = await store();
    const added = await createLocation(org.maple, { name: "King Street branch", kind: "place", detail: "main entrance" });
    if (!added.ok) throw new Error("not added");
    expect(await findReportLocation(org.maple, added.id)).toEqual({
      name: "King Street branch",
      locationKind: "place",
      locationDetail: "King Street branch, main entrance",
    });
    // Lakeview's form with Maple Harbour's location: nothing (the location never picks the org).
    expect(await findReportLocation(org.lakeview, added.id)).toBeNull();
    for (const bad of [undefined, "", "abc", ["x"], `${added.id}' or '1'='1`, "00000000-0000-4000-8000-000000000000"]) {
      expect(await findReportLocation(org.maple, bad)).toBeNull();
    }
    await updateLocation(org.maple, added.id, { name: "King Street branch", kind: "place", detail: "main entrance", active: false });
    expect(await findReportLocation(org.maple, added.id)).toBeNull();
  });

  it("GET /api/v1/orgs/{slug}?loc= gives the same place, and none for another org's slug", async () => {
    const { createLocation } = await store();
    const added = await createLocation(org.maple, { name: "Accessible ATM, Quay Street", kind: "place", detail: null });
    if (!added.ok) throw new Error("not added");
    const route = await import("@/app/api/v1/orgs/[slug]/route");
    const get = (slug: string, query: string) =>
      route.GET(new Request(`http://localhost:3000/api/v1/orgs/${slug}${query}`, { headers: { host: "localhost:3000" } }), {
        params: Promise.resolve({ slug }),
      });

    const res = await get("maple-harbour", `?loc=${added.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).place).toEqual({
      name: "Accessible ATM, Quay Street",
      locationKind: "place",
      locationDetail: "Accessible ATM, Quay Street",
    });
    expect((await (await get("lakeview-telecom", `?loc=${added.id}`)).json()).place).toBeNull();
    expect((await (await get("maple-harbour", "?loc=nope")).json()).place).toBeNull();
    expect((await (await get("maple-harbour", "")).json()).place).toBeNull();
    // More than one loc is ignored, as on the web form (even when one of them is a location in use).
    expect((await (await get("maple-harbour", `?loc=${added.id}&loc=${added.id}`)).json()).place).toBeNull();
    expect((await (await get("maple-harbour", `?loc=${added.id}&loc=nope`)).json()).place).toBeNull();
  });
});
