// lib/cases/similar.ts similarCandidates() on a real Postgres (PGlite, the real migrations): the candidates for
// "Similar past barriers" are the same org, the same area, the same kind of place, received in the last 24 months,
// never the case itself, never a spam close, never a case without a public summary; the 40 newest, newest first.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { cases } from "@/db/schema";
import { SIMILAR_MAX_CANDIDATES } from "@/lib/ai/similar";
import { similarCandidates } from "@/lib/cases/similar";
import { insertCase, insertOrg, startTestDb, type TestDb } from "./support/pglite-db";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

type Overrides = Partial<typeof cases.$inferInsert>;
const triaged = (o: Overrides): Overrides => ({
  status: "triaged",
  priorityArea: "built_environment",
  locationKind: "place",
  publicSummary: "A door at a branch entrance did not open.",
  ...o,
});

let t: TestDb;
let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  t = await startTestDb();
  orgId = (await insertOrg(t, "Similar org")).id;
  otherOrgId = (await insertOrg(t, "Other org")).id;
}, 60_000);

afterAll(async () => {
  await t?.close();
});

describe("similarCandidates", () => {
  it("keeps exactly the same org, area and place within 24 months, newest first, with public summaries only", async () => {
    const subject = await insertCase(t, orgId, triaged({ receivedAt: daysAgo(1) }));
    const old = await insertCase(t, orgId, triaged({ receivedAt: daysAgo(300), status: "verified" }));
    const newer = await insertCase(t, orgId, triaged({ receivedAt: daysAgo(10), status: "closed", closedReason: "duplicate" }));
    const edge = await insertCase(t, orgId, triaged({ receivedAt: new Date("2024-10-20T12:00:00.000Z") }));
    // Left out, each for one reason:
    await insertCase(t, orgId, triaged({ receivedAt: new Date("2024-10-20T11:59:59.000Z") })); // 24 months and 1 s ago
    await insertCase(t, orgId, triaged({ receivedAt: daysAgo(5), priorityArea: "ict" }));
    await insertCase(t, orgId, triaged({ receivedAt: daysAgo(5), locationKind: "digital" }));
    await insertCase(t, orgId, triaged({ receivedAt: daysAgo(5), status: "closed", closedReason: "spam" }));
    await insertCase(t, orgId, { receivedAt: daysAgo(5), locationKind: "place" }); // new: no area, no public summary
    await insertCase(t, orgId, triaged({ receivedAt: daysAgo(5), publicSummary: "   " }));
    await insertCase(t, otherOrgId, triaged({ receivedAt: daysAgo(5) }));

    const got = await t.tx((tx) => similarCandidates(tx, subject, NOW));
    expect(got.map((c) => c.ref)).toEqual([newer.ref, old.ref, edge.ref]);
    expect(got[0]).toMatchObject({ status: "closed", closedReason: "duplicate", publicSummary: "A door at a branch entrance did not open.", aiOptOut: false });
    expect(got.every((c) => c.id !== subject.id)).toBe(true);
  });

  it("lists a candidate whose reporter chose \"Don't use AI on my report\", marked so it is never sent to the AI", async () => {
    const org = (await insertOrg(t, "Opt-out org")).id;
    const subject = await insertCase(t, org, triaged({ receivedAt: daysAgo(0) }));
    const optedOut = await insertCase(t, org, triaged({ receivedAt: daysAgo(2), aiOptOut: true }));
    const plain = await insertCase(t, org, triaged({ receivedAt: daysAgo(3) }));
    const got = await t.tx((tx) => similarCandidates(tx, subject, NOW));
    expect(got.map((c) => [c.ref, c.aiOptOut])).toEqual([[optedOut.ref, true], [plain.ref, false]]);
  });

  it("returns at most 40, the newest; and nothing for a case without an area", async () => {
    const org = (await insertOrg(t, "Busy org")).id;
    const subject = await insertCase(t, org, triaged({ receivedAt: daysAgo(0) }));
    const made = [];
    for (let i = 1; i <= SIMILAR_MAX_CANDIDATES + 5; i++) made.push(await insertCase(t, org, triaged({ receivedAt: daysAgo(i) })));
    const got = await t.tx((tx) => similarCandidates(tx, subject, NOW));
    expect(got).toHaveLength(SIMILAR_MAX_CANDIDATES);
    expect(got.map((c) => c.ref)).toEqual(made.slice(0, SIMILAR_MAX_CANDIDATES).map((c) => c.ref));

    const untriaged = await insertCase(t, org, { receivedAt: daysAgo(0), locationKind: "place" });
    expect(await t.tx((tx) => similarCandidates(tx, untriaged, NOW))).toEqual([]);
  });
});
