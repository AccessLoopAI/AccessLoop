// The dashboard's server loader (lib/metrics/dashboard.ts) against the real seed: one withOrg transaction gives the
// metrics (the same numbers tests/metrics.seed.test.ts checks), the deadline for the org's entity class, and the
// evidence-integrity check over the period's cases through the frozen verifyCaseChain, cached for 60 s. A payload
// edited behind the trigger's back is found once the cache runs out.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { zonedNoon } from "@/lib/dates";
import { thisYear } from "@/lib/metrics";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const NOW = zonedNoon("2026-10-19");
const PERIOD = thisYear(NOW);

let seeded: SeededDb | undefined;
let demoId = "";
let otherId = "";
const saved = { ...process.env };

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env); // db/client reads DATABASE_URL when it is first imported
  const sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    demoId = (await sql<{ id: string }[]>`select id from orgs where slug = 'maple-harbour'`)[0].id;
    otherId = (await sql<{ id: string }[]>`select id from orgs where slug = 'lakeview-telecom'`)[0].id;
  } finally {
    await sql.end();
  }
}, 240_000);

afterAll(async () => {
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

describe("loadDashboard (seed, now = 2026-10-19)", () => {
  it("gives the seed's numbers, the deadline banner and 'All 16 records verify'", async () => {
    const { loadDashboard } = await import("@/lib/metrics/dashboard");
    const d = await loadDashboard({ orgId: demoId, role: "lead" }, PERIOD, NOW);
    expect(d.metrics.total.total.count).toBe(16);
    expect([d.metrics.verifiedFixRate.verified.count, d.metrics.verifiedFixRate.fixLogged.count]).toEqual([7, 12]);
    expect(d.metrics.notFeedback.count).toBe(0);
    expect(d.metrics.medianDaysToVerifiedFix.days).toBe(14);
    expect(d.entityClass).toBe("private_large");
    expect(d.deadline.sentence).toBe("Progress report due June 1, 2027: 225 days");
    expect(d.integrity).toMatchObject({ checked: 16, intact: 16, broken: [] });
  });

  it("works for an auditor and stays inside the org", async () => {
    const { loadDashboard } = await import("@/lib/metrics/dashboard");
    const auditor = await loadDashboard({ orgId: demoId, role: "auditor" }, PERIOD, NOW);
    expect(auditor.integrity.checked).toBe(16);
    const other = await loadDashboard({ orgId: otherId, role: "lead" }, PERIOD, NOW);
    expect(other.metrics.total.total.caseIds.some((id) => auditor.metrics.total.total.caseIds.includes(id))).toBe(false);
    expect(other.integrity.checked).toBe(other.metrics.total.total.count);
  });

  it("checks again at once after a new event, and finds an edited event once the 60 s cache has run out", async () => {
    const { loadDashboard } = await import("@/lib/metrics/dashboard");
    const { withOrg } = await import("@/db/tenant");
    const { appendCaseEvent } = await import("@/lib/case-events");
    const first = await loadDashboard({ orgId: demoId, role: "lead" }, PERIOD, NOW);
    const [noted, target] = first.metrics.statuses.verified.caseIds;

    // A new event changes a chain head: the next load checks again instead of using the cached answer.
    await withOrg({ orgId: demoId, role: "lead" }, (tx) =>
      appendCaseEvent(tx, { orgId: demoId, caseId: noted, type: "note_added", actorKind: "system", actorId: null, payload: { note: "Checked" } }),
    );
    const afterNote = await loadDashboard({ orgId: demoId, role: "lead" }, PERIOD, new Date(NOW.getTime() + 5_000));
    expect(afterNote.integrity.checkedAt.getTime()).toBe(NOW.getTime() + 5_000);
    expect(afterNote.integrity.intact).toBe(16);

    // Edit a payload behind the append-only trigger's back (the demo's optional tamper beat, domain §8).
    const sql = postgres(seeded!.url, { prepare: false, max: 1, onnotice: () => {} });
    try {
      await sql.unsafe("ALTER TABLE case_events DISABLE TRIGGER USER");
      await sql`update case_events set payload = payload || '{"tampered": true}'::jsonb
        where org_id = ${demoId} and case_id = ${target} and seq = 1`;
      await sql.unsafe("ALTER TABLE case_events ENABLE TRIGGER USER");
    } finally {
      await sql.end();
    }

    // Same stored hashes, within 60 s: the cached result.
    const cached = await loadDashboard({ orgId: demoId, role: "lead" }, PERIOD, new Date(NOW.getTime() + 30_000));
    expect(cached.integrity.broken).toEqual([]);
    expect(cached.integrity.checkedAt).toEqual(afterNote.integrity.checkedAt);

    // After 60 s it is checked again: the edited record no longer verifies.
    const later = await loadDashboard({ orgId: demoId, role: "lead" }, PERIOD, new Date(NOW.getTime() + 66_000));
    expect(later.integrity.checked).toBe(16);
    expect(later.integrity.intact).toBe(15);
    expect(later.integrity.broken.map((b) => [b.caseId, b.brokenAtSeq])).toEqual([[target, 1]]);
  });
});
