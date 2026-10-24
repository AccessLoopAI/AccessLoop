// The scenario organization in the real seed (db/seed.ts, data/scenarios.json): a fresh in-memory PGlite seeded the
// way scripts/db-smoke.ts does. Kestrel Bay Group gets exactly the scenario cases, in order, through the frozen core
// (their chains verify and replay to the projection), its lead and owner can sign in, and Maple Harbour and Lakeview
// are exactly as before (domain §10's numbers stay Maple Harbour's alone). Running the seed again adds nothing.
import { spawn } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { SCENARIO_ORG, SCENARIOS, type Scenario } from "@/lib/scenarios";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

let seeded: SeededDb | undefined;
const saved = { ...process.env };
type Row = { id: string; ref: string; status: string; priority_area: string | null; public_summary: string | null; received_at: Date };
let scenarioOrgId = "";
let rows: Row[] = [];
let counts: Record<string, number> = {};
let members: { display_name: string; role: string }[] = [];

function expectedStatus(s: Scenario): string {
  if (!s.publicSummary) return "new";
  const last = s.steps.at(-1)?.[1];
  if (last === "close_no_action") return "closed";
  if (last === "fixed") return "verified";
  if (last === "fix") return s.wantsRetest ? "retest_open" : "fixed_unverified";
  return s.owner ? "assigned" : "triaged";
}

async function read(url: string) {
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const [org] = await sql<{ id: string }[]>`select id from orgs where slug = ${SCENARIO_ORG.slug}`;
    const perOrg = await sql<{ slug: string; n: number }[]>`select o.slug, count(c.id)::int n from orgs o left join cases c on c.org_id = o.id group by o.slug`;
    return {
      orgId: org?.id ?? "",
      rows: org ? await sql<Row[]>`select id, ref, status, priority_area, public_summary, received_at from cases where org_id = ${org.id} order by seq` : [],
      counts: Object.fromEntries(perOrg.map((r) => [r.slug, r.n])),
      members: org ? await sql<{ display_name: string; role: string }[]>`select display_name, role from org_members where org_id = ${org.id} order by role, display_name` : [],
    };
  } finally {
    await sql.end();
  }
}

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env);
  ({ orgId: scenarioOrgId, rows, counts, members } = await read(seeded.url));
}, 240_000);

afterAll(async () => {
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

describe("the seeded scenario organization", () => {
  it("is a third org beside Maple Harbour (16 cases, unchanged) and Lakeview (none)", () => {
    expect(counts).toEqual({ "maple-harbour": 16, "lakeview-telecom": 0, [SCENARIO_ORG.slug]: SCENARIOS.length });
  });

  it("has a lead and an owner to sign in as, named unlike anyone in the other orgs", () => {
    expect(members).toEqual([
      { display_name: "Riley Brennan", role: "lead" },
      { display_name: "Operations team", role: "owner" },
    ]);
  });

  it("holds every scenario as its case, in order, with the status, area and summary its steps give", () => {
    expect(rows.map((r) => r.ref)).toEqual(SCENARIOS.map((s) => s.ref));
    rows.forEach((r, i) => {
      const s = SCENARIOS[i];
      expect({ ref: r.ref, status: r.status, area: r.priority_area, summary: r.public_summary ?? "" }, s.id).toEqual({
        ref: s.ref,
        status: expectedStatus(s),
        area: s.publicSummary ? s.area : null,
        summary: s.publicSummary,
      });
      expect(r.received_at.toISOString().slice(0, 10)).toBe(s.receivedOn);
    });
  });

  it("built every case through the frozen core: each chain verifies and replays to the projection", async () => {
    const { withOrg } = await import("@/db/tenant");
    const { verifyCaseChain } = await import("@/lib/case-events");
    const results = await withOrg({ orgId: scenarioOrgId, role: "auditor" }, (tx) =>
      Promise.all(rows.map((r) => verifyCaseChain(tx, scenarioOrgId, r.id))),
    );
    expect(results.every((c) => c.ok)).toBe(true);

    const { loadMetricCases } = await import("@/lib/metrics/load");
    const { replayCase } = await import("@/lib/metrics");
    const loaded = await loadMetricCases({ orgId: scenarioOrgId, role: "lead" });
    for (const r of rows) {
      const replayed = replayCase(loaded.find((c) => c.id === r.id)!);
      expect({ status: replayed.status, area: replayed.priorityArea }).toEqual({ status: r.status, area: r.priority_area });
    }
  });

  it("adds nothing when the seed runs again on the same database", async () => {
    // Async: the in-memory database is served from THIS process, so a blocking spawn would starve it.
    const run = await new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("db", "seed.ts")], {
        cwd: process.cwd(),
        env: { ...process.env, ...seeded!.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += String(d)));
      child.stderr.resume();
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout }));
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain("already has cases");
  }, 120_000);

  it("still has the same cases after that second run", async () => {
    const again = await read(seeded!.url);
    expect(again.counts).toEqual(counts);
    expect(again.rows.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});
