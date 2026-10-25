// The daily job /api/cron/daily (Phase 7 T3 item 12; lib/cron; docs/decisions.md 2026-10-20) against the production
// build: only `Authorization: Bearer ${CRON_SECRET}` runs it (the local secret is derived from SESSION_SECRET, as the
// server derives it); `?dryRun=1` writes nothing; a run sends the round's one reminder a week after the request,
// through the real database roles (the address is read in a lead transaction), with the round's link, and a second run
// sends nothing more; this build does not expire re-tests (CRON_EXPIRE_RETEST is not set, docs/domain.md §10).
// A run also handles whatever else is due in the shared e2e database (the seed's stalled BAR-0013 gets its one owner
// alert the first time), so the assertions are about this spec's own case and the counts' shape only.
import { test, expect } from "@playwright/test";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { caseEvents, cases, orgMembers, orgs } from "@/db/schema";
import { withOrg } from "@/db/tenant";
import { appendCaseEvent } from "@/lib/case-events";
import { createCase } from "@/lib/cases/create";
import { secretFromEnv } from "@/lib/env";
import { LINK_PLACEHOLDER } from "@/lib/email/templates";
import { buildPreview, prepareCase } from "@/lib/intake/pipeline";
import { transition, type Actor } from "@/lib/state-machine";
import { signInAs } from "./helpers";
import { caseFacts } from "./fixtures/cases";
import { messagesOf } from "./fixtures/messages";

const ORG = "maple-harbour";
const DAY = 86_400_000;
const PATH = "/api/cron/daily";
let counter = 0;
const stamp = () => `${Date.now().toString(36)}-${++counter}`;
const bearer = () => ({ authorization: `Bearer ${secretFromEnv("CRON_SECRET")}` });

/**
 * A web report with an email, received `days + 2` days ago and moved along at past times (as db/seed.ts dates its
 * history) with the app's own intake code and the frozen core, so its fix (and re-test request) is `days` days old.
 */
async function fixedDaysAgo(days: number): Promise<{ ref: string }> {
  process.env.FAKE_LLM = "1";
  const text = `The ramp rail at the side entrance is loose (cron ${stamp()}).`;
  const email = `cron.${stamp()}@example.com`;
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, ORG)).limit(1);
  const preview = await buildPreview(org.id, { text, locationKind: "place", locationDetail: "", aiOptOut: false });
  const prepared = await prepareCase(
    org.id,
    { text, locationKind: "place", locationDetail: "", wantsRetest: true, emailChoice: "email", email, aiOptOut: false, choice: preview.summary ? "ai_confirmed" : null, editedSummary: "", token: preview.token },
    email,
  );
  const at = (d: number) => new Date(Date.now() - d * DAY);
  const created = await withOrg({ orgId: org.id, role: "reporter" }, (tx) => createCase(tx, { ...prepared, receivedAt: at(days + 2) }));
  await withOrg({ orgId: org.id, role: "system" }, async (tx) => {
    const caseId = created.case.id;
    const members = await tx.select().from(orgMembers).where(eq(orgMembers.orgId, org.id));
    const lead = members.find((m) => m.displayName.startsWith("Alex Rivera"))!;
    const owner = members.find((m) => m.displayName === "Facilities team")!;
    const asLead: Actor = { kind: "staff", memberId: lead.id, role: "lead" };
    const [proposed] = await tx.select({ payload: caseEvents.payload }).from(caseEvents)
      .where(and(eq(caseEvents.caseId, caseId), eq(caseEvents.type, "redaction_proposed"))).orderBy(desc(caseEvents.seq)).limit(1);
    await appendCaseEvent(tx, { orgId: org.id, caseId, type: "redaction_approved", actorKind: "staff", actorId: lead.id, payload: { spans: proposed?.payload.spans ?? [] }, createdAt: at(days + 1.9) });
    await tx.update(cases).set({ redactionApprovedAt: at(days + 1.9), needsManualRedaction: false }).where(eq(cases.id, caseId));
    await transition(tx, org.id, caseId, { kind: "triage", priorityArea: "built_environment", publicSummary: "A ramp rail at a branch was loose." }, asLead, { at: at(days + 1.5) });
    await transition(tx, org.id, caseId, { kind: "assign", memberId: owner.id }, asLead, { at: at(days + 1) });
    await transition(tx, org.id, caseId, { kind: "log_fix", description: "Tightened the rail." }, { kind: "staff", memberId: owner.id, role: "owner" }, { at: at(days) });
  });
  return { ref: created.case.ref };
}

test.describe("GET /api/cron/daily", () => {
  test("refuses every request without the exact bearer secret, before reading anything", async ({ request }) => {
    for (const headers of [{} as Record<string, string>, { authorization: "Bearer wrong-secret-of-about-the-right-length-xxxxxx" }, { authorization: `Basic ${secretFromEnv("CRON_SECRET")}` }, { authorization: `Bearer ${secretFromEnv("CRON_SECRET")}x` }]) {
      for (const method of ["get", "post"] as const) {
        const res = await request[method](PATH, { headers });
        expect(res.status(), `${method} ${JSON.stringify(Object.keys(headers))}`).toBe(401);
        expect(res.headers()["cache-control"]).toBe("no-store");
        expect(await res.json()).toEqual({ ok: false, error: "unauthorized" });
      }
    }
  });

  test("a dry run counts and writes nothing; a run sends the round's one reminder with its link; a second run sends nothing", async ({ browser, request }) => {
    test.setTimeout(180_000);
    const due = await fixedDaysAgo(8);
    const notYet = await fixedDaysAgo(2);

    const dry = await request.get(`${PATH}?dryRun=1`, { headers: bearer() });
    expect(dry.status()).toBe(200);
    const plan = await dry.json();
    expect(plan).toMatchObject({ ok: true, dryRun: true, expiry: { enabled: false, due: 0, done: 0 } });
    expect(plan.reminders.due).toBeGreaterThanOrEqual(1);
    expect(plan.reminders.done).toBe(0);
    expect(Object.keys(plan).sort()).toEqual(["dryRun", "expiry", "ok", "orgs", "ownerAlerts", "reminders"]);
    expect(JSON.stringify(plan)).not.toMatch(/BAR-|@|maple/i); // counts only
    expect(await messagesOf(ORG, due.ref)).toEqual([]);

    const res = await request.get(PATH, { headers: bearer() });
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const summary = await res.json();
    expect(summary).toMatchObject({ ok: true, dryRun: false, expiry: { enabled: false, done: 0 } });
    expect(summary.reminders.done).toBeGreaterThanOrEqual(1);
    expect(summary.reminders.errors).toBe(0);
    expect(summary.ownerAlerts.errors).toBe(0);

    expect((await messagesOf(ORG, due.ref)).map((m) => [m.template, m.status])).toEqual([["retest_reminder", "skipped_fake"]]);
    const reminder = (await caseFacts(ORG, due.ref)).events.find((e) => e.type === "message_sent")!;
    expect(reminder).toMatchObject({ actorKind: "system", payload: { template: "retest_reminder", round: 1, linkIncluded: true, codeIncluded: false } });
    expect(await messagesOf(ORG, notYet.ref)).toEqual([]);
    expect((await caseFacts(ORG, due.ref)).status).toBe("retest_open");

    const again = await (await request.post(PATH, { headers: bearer() })).json();
    expect(again).toMatchObject({ ok: true, reminders: { errors: 0 } });
    expect(await messagesOf(ORG, due.ref)).toHaveLength(1);

    // The lead sees the reminder went out (no button left), and the Outbox shows the link's placeholder, never a link.
    const page = await (await browser.newContext()).newPage();
    await signInAs(page, "E2E_LEAD_EMAIL");
    await page.goto(`/app/cases/${due.ref}`);
    await expect(page.getByText("A reminder email went out on")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send a reminder email" })).toHaveCount(0);
    await page.goto("/app/outbox");
    const row = page.getByRole("row").filter({ hasText: due.ref }).filter({ has: page.getByRole("cell", { name: "Re-test reminder", exact: true }) });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^Show the email/ }).click();
    await expect(row).toContainText(LINK_PLACEHOLDER);
    await expect(row).not.toContainText("/r/t/");
    await expect(row.getByText(/To: The reporter.s email \(never shown\)/)).toBeVisible();
    await page.context().close();
  });
});
