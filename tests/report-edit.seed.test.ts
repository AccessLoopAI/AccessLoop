// The only writes to a report after it is generated (lib/report/edit.ts), on a freshly seeded PGlite (the
// tests/report.seed.test.ts pattern): the lead's text per plan area and for Consultations (checks recomputed and
// stored with it), sign-off only when every part is written and every required check passes, immutability after
// sign-off (every edit refuses), publishing once, and another org's report never found (RLS + the org filter).
// Also the readers behind the pages (lib/report/access.ts) and the plain-text export of the published report.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { zonedNoon } from "@/lib/dates";
import { thisYear } from "@/lib/metrics";
import type { EditResult } from "@/lib/report/edit";
import { reportPlainText } from "@/lib/report/text";
import type { ReportContent, ReportSnapshot } from "@/lib/report/types";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const NOW = zonedNoon("2026-10-19");
const PERIOD = thisYear(NOW);

type WithOrg = typeof import("@/db/tenant").withOrg;
type Edit = typeof import("@/lib/report/edit");
type Access = typeof import("@/lib/report/access");

let seeded: SeededDb | undefined;
let sql: postgres.Sql;
let orgId = "";
let otherOrgId = "";
let leadId = "";
let reportId = "";
let withOrg: WithOrg;
let edit: Edit;
let access: Access;
const saved = { ...process.env };

beforeAll(async () => {
  seeded = await startSeededDb();
  // AUTH_MODE=local + SESSION_SECRET: sign-off derives its signing key (lib/report/signing-key.ts).
  Object.assign(process.env, seeded.env, { FAKE_LLM: "1", AI_BACKEND: "fake", AUTH_MODE: "local", SESSION_SECRET: "test-session-secret" });
  sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  [{ id: orgId }] = await sql<{ id: string }[]>`select id from orgs where slug = 'maple-harbour'`;
  [{ id: otherOrgId }] = await sql<{ id: string }[]>`select id from orgs where slug = 'lakeview-telecom'`;
  [{ id: leadId }] = await sql<{ id: string }[]>`select id from org_members where org_id = ${orgId} and role = 'lead'`;
  ({ withOrg } = await import("@/db/tenant"));
  edit = await import("@/lib/report/edit");
  access = await import("@/lib/report/access");
  const { generateReport } = await import("@/lib/report/generate");
  const r = await generateReport({ orgId, memberId: leadId, period: PERIOD, now: NOW });
  if (!r.ok) throw new Error(`generateReport refused: ${r.code}`);
  reportId = r.id;
}, 240_000);

afterAll(async () => {
  await sql?.end().catch(() => {});
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

const save = (key: string, text: string, org = orgId) =>
  withOrg({ orgId: org, role: "lead" }, (tx) => edit.saveLeadText(tx, { orgId: org, reportId, key, text }));
const signOff = () => withOrg({ orgId, role: "lead" }, (tx) => edit.signOffReport(tx, { orgId, reportId, memberId: leadId, now: NOW }));
const publish = () => withOrg({ orgId, role: "lead" }, (tx) => edit.publishReport(tx, { orgId, reportId, now: new Date(NOW.getTime() + 3_600_000) }));
const row = async () =>
  (
    await sql<{ status: string; area_text: Record<string, string>; consultations_text: string | null; heading_check: { id: string; ok: boolean }[]; signed_off_by: string | null; signed_off_at: Date | null; published_at: Date | null }[]>`
      select status, area_text, consultations_text, heading_check, signed_off_by, signed_off_at, published_at from reports where id = ${reportId}`
  )[0];
const refusal = (r: EditResult) => (r.ok ? "ok" : r.reason);

describe("the lead's text (domain §7.7)", () => {
  it("saves an area's text and a Consultations text, and stores the recomputed checks with them", async () => {
    const before = await row();
    expect(before.heading_check.find((c) => c.id === "W:built_environment")?.ok).toBe(false);
    const r = await save("area:built_environment", "  We rebuilt the ramp at King Street.\r\n\r\nWe added handrails.  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.checks.toWrite).toBe(6);
    const after = await row();
    expect(after.area_text).toEqual({ built_environment: "We rebuilt the ramp at King Street.\n\nWe added handrails." });
    expect(after.heading_check.some((c) => c.id === "W:built_environment")).toBe(false);
    expect(refusal(await save("consultations", "We met our advisory group of people with disabilities twice."))).toBe("ok");
    expect((await row()).consultations_text).toBe("We met our advisory group of people with disabilities twice.");
  });

  it("clears a section with empty text (it is a placeholder again)", async () => {
    expect(refusal(await save("area:ict", "Temporary."))).toBe("ok");
    expect((await row()).area_text.ict).toBe("Temporary.");
    expect(refusal(await save("area:ict", "   "))).toBe("ok");
    expect((await row()).area_text.ict).toBeUndefined();
  });

  it("refuses sections without a text box, areas outside the draft's plan, and text over 4,000 characters", async () => {
    expect(refusal(await save("general", "x"))).toBe("invalid_section");
    expect(refusal(await save("feedback", "x"))).toBe("invalid_section");
    expect(refusal(await save("area:transportation", "x"))).toBe("invalid_section"); // not in Maple Harbour's plan
    expect(refusal(await save("area:nonsense", "x"))).toBe("invalid_section");
    expect(refusal(await save("consultations", "a".repeat(4001)))).toBe("too_long");
  });

  it("never finds another org's report", async () => {
    expect(refusal(await save("consultations", "x", otherOrgId))).toBe("not_found");
    expect(await access.loadStaffReport({ orgId: otherOrgId, role: "lead" }, reportId)).toBeNull();
  });
});

describe("sign-off, immutability and publishing (domain §7 steps 8-9)", () => {
  it("refuses to sign off while a part is still to write, and says how many", async () => {
    const r = await signOff();
    expect(refusal(r)).toBe("not_ready");
    if (!r.ok) expect(r.checks?.toWrite).toBeGreaterThan(0);
    expect((await row()).status).toBe("draft");
  });

  it("refuses to publish a draft", async () => {
    expect(refusal(await publish())).toBe("not_signed_off");
  });

  it("signs off when every part is written, recording who and when", async () => {
    const areas = ["employment", "built_environment", "ict", "communication_other", "procurement", "programs_services"];
    for (const a of areas) expect(refusal(await save(`area:${a}`, `Our progress on ${a}.`))).toBe("ok");
    expect(refusal(await signOff())).toBe("ok");
    const r = await row();
    expect(r.status).toBe("signed_off");
    expect(r.signed_off_by).toBe(leadId);
    expect(r.signed_off_at?.toISOString()).toBe(NOW.toISOString());
    expect(r.heading_check.every((c) => c.ok)).toBe(true);
  });

  it("is immutable afterwards: every edit and a second sign-off refuse, and nothing changes", async () => {
    const before = await row();
    expect(refusal(await save("area:ict", "Changed after sign-off."))).toBe("not_draft");
    expect(refusal(await save("consultations", ""))).toBe("not_draft");
    expect(refusal(await signOff())).toBe("not_draft");
    expect(await row()).toEqual(before);
  });

  it("publishes once; the public readers then find it, and only then", async () => {
    expect(await access.loadPublishedReport("maple-harbour", reportId)).toBeNull();
    expect(refusal(await publish())).toBe("ok");
    expect(refusal(await publish())).toBe("already_published");
    expect((await row()).published_at).not.toBeNull();
    const found = await access.loadPublishedReport("maple-harbour", reportId);
    expect(found?.report.id).toBe(reportId);
    expect(await access.loadPublishedReport("lakeview-telecom", reportId)).toBeNull();
    expect(await access.loadPublishedReport("maple-harbour", "not-a-uuid")).toBeNull();
    expect((await access.listPublishedReports(orgId)).map((r) => r.id)).toContain(reportId);
    expect((await access.listPublishedReports(otherOrgId)).map((r) => r.id)).not.toContain(reportId);
    const staffList = await access.listStaffReports({ orgId, role: "auditor" });
    expect(staffList.find((r) => r.id === reportId)?.status).toBe("signed_off");
  });

  it("exports the published report as plain text with the lead's text and every record it cites", async () => {
    const found = (await access.loadPublishedReport("maple-harbour", reportId))!;
    const r = found.report;
    const text = reportPlainText({
      title: r.title,
      orgName: r.content.settings.orgName,
      content: r.content as ReportContent,
      snapshot: r.snapshot as ReportSnapshot,
      areaText: r.areaText,
      consultationsText: r.consultationsText,
      manifestHash: r.manifestHash,
      signedOffAt: r.signedOffAt,
      publishedAt: r.publishedAt,
      verifyUrl: `/verify/${r.id}`,
    });
    expect(text).toContain("Our progress on ict.");
    expect(text).toContain("We met our advisory group");
    expect(text).toContain("confirmed by the person who reported");
    for (const ref of ["BAR-0001", "BAR-0016"]) expect(text).toContain(ref);
    expect(text).toContain(`Fingerprint of this report (SHA-256): ${r.manifestHash}`);
    expect(r.content.signing?.root).toMatch(/^[0-9a-f]{64}$/);
    expect(text).toContain(`Signed fingerprint (Ed25519, key ${r.content.signing?.keyId}): ${r.content.signing?.root}`);
    expect(text).not.toMatch(/undefined|\[object/);
  });
});
