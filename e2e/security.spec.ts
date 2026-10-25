// Tenancy and security checks (docs/domain.md §9). Phase 1: the Lakeview lead sees none of Maple Harbour's
// cases; an unknown org slug is a 404; UPDATE/DELETE on case_events fail. Plus the staff gate: no session,
// the wrong role and a non-local Host are all refused. Phase 2: owners get 404 for cases not assigned to them;
// refs repeat across orgs and each lead opens only their own org's case; auditors get no forms; every case
// action refuses a wrong-role caller; a Maple Harbour receipt code in the Lakeview receipt context is a 404, and so
// is an unknown /r/ code (e2e/reporter.spec.ts checks the same through the public form, plus expired codes).
// Specs share one database and run in file order: never assume fixed counts (demo.spec adds cases every run).
import { randomBytes } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { anyEventId, appSql, casesOf, ownerSql, withSql, type OrgCase } from "./db";
import { caseFacts, fileReport, moveCase } from "./fixtures/cases";
import { refsOnPage } from "./inbox-pages";

const MAPLE = "maple-harbour";
const LAKEVIEW = "lakeview-telecom";
const LOCAL = process.env.AUTH_MODE === "local";

/** The inbox shows texts whitespace-collapsed, so compare them the same way. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

test.describe("Phase 1: tenancy (domain §9)", () => {
  test("the Lakeview lead sees none of Maple Harbour's cases in their inbox", async ({ browser }) => {
    const { maple, lakeview } = await withSql(ownerSql, async (sql) => ({
      maple: await casesOf(sql, MAPLE),
      lakeview: await casesOf(sql, LAKEVIEW),
    }));
    expect(maple.length, "the seed gives Maple Harbour cases").toBeGreaterThan(0);

    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, "E2E_OTHER_LEAD_EMAIL");
    await page.goto("/app/inbox");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("banner")).toContainText("Other org lead");

    const main = page.getByRole("main");
    const shown = norm(await main.innerText());
    const lakeRefs = new Set(lakeview.map((c) => c.ref));
    const lakeTexts = lakeview.flatMap(textsOf).map(norm);

    let refsChecked = 0;
    let textsChecked = 0;
    for (const c of maple) {
      // Refs repeat across orgs (BAR-0001 exists in every org), so only refs Lakeview doesn't have prove anything.
      if (!lakeRefs.has(c.ref)) {
        await expect(main.getByRole("link", { name: c.ref, exact: true }), `Maple Harbour ${c.ref}`).toHaveCount(0);
        refsChecked++;
      }
      for (const text of textsOf(c)) {
        const probe = norm(text).slice(0, 60);
        if (probe.length < 20 || lakeTexts.some((t) => t.includes(probe))) continue;
        expect(shown, `text of Maple Harbour ${c.ref}`).not.toContain(probe);
        textsChecked++;
      }
    }
    expect(refsChecked + textsChecked).toBeGreaterThan(0);

    if (lakeview.length === 0) {
      await expect(main.getByRole("heading", { name: "No cases yet" })).toBeVisible();
      await expect(main.getByRole("table")).toHaveCount(0);
    } else {
      // Exactly Lakeview's own cases: one header row plus one row per case.
      await expect(main.getByRole("table", { name: "Cases received" }).getByRole("row")).toHaveCount(lakeview.length + 1);
    }

    // The case page is looked up inside the active org: a Maple Harbour-only ref is a 404 for Lakeview.
    const mapleOnly = maple.find((c) => !lakeRefs.has(c.ref));
    if (mapleOnly) {
      const res = await page.goto(`/app/cases/${mapleOnly.ref}`);
      expect(res?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: mapleOnly.ref })).toHaveCount(0);
    }
    await context.close();
  });

  test("an unknown org slug is a 404", async ({ request }) => {
    for (const path of ["/o/no-such-org/report", "/o/no-such-org/receipt"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain("Report a barrier to");
    }
  });
});

test.describe("Phase 1: the event log is append-only (domain §8)", () => {
  test("as the database owner, UPDATE and DELETE on case_events are blocked by the trigger", async () => {
    await withSql(ownerSql, async (sql) => {
      const ev = await anyEventId(sql, MAPLE);
      const inOrg = <T,>(fn: (tx: typeof sql) => Promise<T>) =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.org_id', ${ev.orgId}, true)`;
          return fn(tx as unknown as typeof sql);
        });

      await expect(inOrg((tx) => tx`update case_events set payload = '{"tampered":true}'::jsonb where id = ${ev.id}::bigint`))
        .rejects.toThrow(/append-only/);
      await expect(inOrg((tx) => tx`delete from case_events where id = ${ev.id}::bigint`)).rejects.toThrow(/append-only/);

      // Nothing changed.
      const [after] = await inOrg((tx) => tx<{ hash: string; tampered: boolean }[]>`
        select hash, payload ? 'tampered' as tampered from case_events where id = ${ev.id}::bigint`);
      expect(after).toEqual({ hash: ev.hash, tampered: false });
    });
  });

  test("as the app role, UPDATE and DELETE on case_events are refused", async () => {
    const ev = await withSql(ownerSql, (sql) => anyEventId(sql, MAPLE));
    await withSql(appSql, async (sql) => {
      const inOrg = <T,>(fn: (tx: typeof sql) => Promise<T>) =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.org_id', ${ev.orgId}, true), set_config('app.role', 'lead', true)`;
          return fn(tx as unknown as typeof sql);
        });
      // The app role can read its own org's events (so the refusals below are about writing, not visibility).
      const [seen] = await inOrg((tx) => tx<{ n: number }[]>`select count(*)::int as n from case_events where id = ${ev.id}::bigint`);
      expect(seen.n).toBe(1);

      await expect(inOrg((tx) => tx`update case_events set payload = payload where id = ${ev.id}::bigint`))
        .rejects.toThrow(/permission denied|append-only/);
      await expect(inOrg((tx) => tx`delete from case_events where id = ${ev.id}::bigint`))
        .rejects.toThrow(/permission denied|append-only/);
    });
  });
});

test.describe("the staff gate", () => {
  test("/app/inbox without a session goes to /sign-in", async ({ page, request }) => {
    const res = await request.get("/app/inbox", { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(new URL(res.headers()["location"] ?? "", "http://x").pathname).toBe("/sign-in");

    await page.goto("/app/inbox");
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("a forged session cookie is refused too", async ({ request }) => {
    const forged = Buffer.from(JSON.stringify({ userId: "local_alex", orgClerkId: "local_org_maple", iat: 1 })).toString("base64url");
    const res = await request.get("/app/inbox", { maxRedirects: 0, headers: { cookie: `al_local_session=${forged}.${"0".repeat(64)}` } });
    expect(res.status()).toBe(303);
  });

  test("an owner gets 404 (not 403) on /app/inbox", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, "E2E_OWNER_EMAIL");
    const res = await page.goto("/app/inbox");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toHaveCount(0);
    await context.close();
  });

  test("/sign-out refuses a cross-site POST (logout CSRF) and keeps working for the app's own form", async ({ request }) => {
    const crossSite: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "null" },
      { "sec-fetch-site": "cross-site" },
    ];
    for (const headers of crossSite) {
      const res = await request.post("/sign-out", { headers, maxRedirects: 0 });
      expect(res.status(), JSON.stringify(headers)).toBe(403);
      expect(res.headers()["set-cookie"] ?? "", JSON.stringify(headers)).not.toContain("al_local_session");
    }
    const own = await request.post("/sign-out", { headers: { "sec-fetch-site": "same-origin" }, maxRedirects: 0 });
    expect(own.status()).toBe(303);
    expect(own.headers()["location"]).toBe("/sign-in");
    expect(own.headers()["set-cookie"] ?? "").toContain("al_local_session=;");
    // The real button (a same-origin form POST in the browser) is covered by signOut() in pages.spec.ts.
  });

  test("/sign-in is a 404 on a non-local Host", async ({ request }) => {
    test.skip(!LOCAL, "local sign-in only exists in AUTH_MODE=local");
    // Control: the same request with a local Host works, so the 404 below is caused by the Host header alone.
    const local = await request.get("/sign-in", { headers: { host: "localhost:3000" } });
    expect(local.status()).toBe(200);

    for (const host of ["accessloop.example.com", "localhost.evil.example", "192.168.1.20:3000"]) {
      const res = await request.get("/sign-in", { headers: { host } });
      expect(res.status(), host).toBe(404);
      expect(await res.text(), host).not.toContain("Sign in as");
    }
  });
});

test.describe("redaction review comes first (domain §2, §5)", () => {
  /** The seeded auditor ("Internal audit"). The e2e helper has no auditor, so use the local sign-in page. */
  async function signInAsAuditor(page: Page) {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
    await page.waitForURL(/\/app\//);
  }

  /** The first 40 characters of each text the case has, whitespace collapsed (what a page would show). */
  const probes = (c: OrgCase) =>
    [...textsOf(c), c.locationDetail ?? ""].map((t) => norm(t).slice(0, 40)).filter((p) => p.length >= 12);

  test("an auditor sees no report text before the lead approves the redaction", async ({ browser }) => {
    test.skip(!LOCAL, "signs in through the local 'Sign in as' page");
    const maple = await withSql(ownerSql, (sql) => casesOf(sql, MAPLE));
    const pending = maple.filter((c) => !c.reviewed);
    const approved = maple.find((c) => c.reviewed && c.redactedText.trim().length >= 12);
    expect(pending.length, "the seed has a new case waiting for redaction review").toBeGreaterThan(0);
    expect(approved, "the seed has approved cases").toBeTruthy();

    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAsAuditor(page);
    await page.goto("/app/inbox");
    const table = page.getByRole("table", { name: "Cases received" });
    // The inbox shows 50 cases to a page (Phase 7 T2 item 5): check the waiting cases on every page.
    const checked = new Set<string>();
    for (let n = 2; ; n++) {
      const onPage = new Set(await refsOnPage(page));
      for (const c of pending.filter((x) => onPage.has(x.ref))) {
        const row = table.getByRole("row").filter({ has: page.getByRole("link", { name: c.ref, exact: true }) });
        await expect(row, c.ref).toContainText("Waiting for redaction review");
        const shown = norm(await row.innerText());
        for (const p of probes(c)) expect(shown, `inbox row of ${c.ref}`).not.toContain(p);
        checked.add(c.ref);
      }
      const next = page.getByRole("link", { name: "Next page" });
      if ((await next.count()) === 0) break;
      await next.click();
      await expect(page.locator("#inbox-pages-title")).toContainText(`Page ${n} of`);
    }
    expect([...checked].sort(), "every waiting case was checked").toEqual(pending.map((c) => c.ref).sort());

    // The case page keeps the facts and hides the words.
    const one = pending[pending.length - 1];
    const res = await page.goto(`/app/cases/${one.ref}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: one.ref })).toBeVisible();
    await expect(page.getByTestId("case-status")).toHaveText("New");
    await expect(page.getByText("Waiting for redaction review")).toBeVisible();
    const main = norm(await page.getByRole("main").innerText());
    for (const p of probes(one)) expect(main, `case page of ${one.ref}`).not.toContain(p);
    await expectNoAxeViolations(page, "case page (auditor, before redaction review)");

    // Once approved, the auditor reads the redacted text.
    await page.goto(`/app/cases/${approved!.ref}`);
    await expect(page.getByRole("region", { name: "The report, with personal details removed" })).toContainText(
      norm(approved!.redactedText).slice(0, 40),
    );
    await context.close();
  });
});

/* ------------------------------------------------------------------ Phase 2 (domain §9) */

test.describe("Phase 2: case pages are scoped to the org and the role (domain §9)", () => {
  const ROLE_REFUSED = "Your role can't do this. Nothing was saved.";
  const NOT_FOUND = "We can't find this case. Nothing was saved.";
  const stampText = (what: string) => `The automatic door button at the side entrance is broken (${what} ${Date.now().toString(36)}).`;

  async function signInAsAuditorHere(page: Page) {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: /^Sign in as Internal audit .*Maple Harbour/ }).click();
    await page.waitForURL(/\/app\//);
  }

  test("an owner gets 404 for a case not assigned to them, and their own case opens without 'Show original'", async ({ browser }) => {
    const unassigned = await fileReport(MAPLE, { text: stampText("owner 404 new") });
    const triaged = await fileReport(MAPLE, { text: stampText("owner 404 triaged") });
    await moveCase(MAPLE, triaged.ref, "triaged");
    const mine = await fileReport(MAPLE, { text: stampText("owner own case") });
    await moveCase(MAPLE, mine.ref, "assigned");

    const page = await (await browser.newContext()).newPage();
    await signInAs(page, "E2E_OWNER_EMAIL");
    for (const c of [unassigned, triaged]) {
      const res = await page.goto(`/app/cases/${c.ref}`);
      expect(res?.status(), c.ref).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: c.ref })).toHaveCount(0);
      await expect(page.getByRole("main")).not.toContainText("side entrance");
    }
    const res = await page.goto(`/app/cases/${mine.ref}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: mine.ref })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show original" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Original report" })).toHaveCount(0);
    await page.context().close();
  });

  test("refs repeat across orgs: each lead opens their own org's case under the same ref, never the other's", async ({ browser }) => {
    // A Lakeview report through Lakeview's own public form, so both orgs have a case with this ref.
    const reporter = await (await browser.newContext()).newPage();
    const lakeText = `The phone menu skips the TTY option every time (security spec ${Date.now().toString(36)}).`;
    await reporter.goto(`/o/${LAKEVIEW}/report`);
    await reporter.getByLabel("What got in your way?").fill(lakeText);
    await reporter.getByRole("button", { name: "Next" }).click();
    await reporter.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "On the phone or at a service" }).check();
    await reporter.getByRole("button", { name: "Next" }).click();
    await reporter.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Don't contact me" }).check();
    await reporter.getByRole("button", { name: "Next" }).click();
    await expect(reporter.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
    await reporter.getByRole("radio", { name: "Keep my words only" }).check();
    await reporter.getByRole("button", { name: "Send report" }).click();
    await expect(reporter.getByRole("heading", { level: 1, name: "We got your report" })).toBeFocused();
    const ref = (await reporter.getByTestId("case-ref").innerText()).trim();
    await reporter.context().close();

    const maple = await withSql(ownerSql, (sql) => casesOf(sql, MAPLE));
    const mapleSame = maple.find((c) => c.ref === ref);
    expect(mapleSame, `Maple Harbour also has ${ref}`).toBeTruthy();

    const lake = await (await browser.newContext()).newPage();
    await signInAs(lake, "E2E_OTHER_LEAD_EMAIL");
    expect((await lake.goto(`/app/cases/${ref}`))?.status()).toBe(200);
    await expect(lake.getByRole("heading", { level: 1, name: ref })).toBeVisible();
    await expect(lake.getByRole("region", { name: "Redaction review" })).toContainText(lakeText.slice(0, 40));
    const lakeMain = norm(await lake.getByRole("main").innerText());
    for (const t of textsOf(mapleSame!)) {
      const probe = norm(t).slice(0, 40);
      if (probe.length >= 20 && !lakeText.includes(probe)) expect(lakeMain).not.toContain(probe);
    }
    // A Maple Harbour ref that Lakeview does not have is still a 404 for the Lakeview lead.
    const mapleOnly = await fileReport(MAPLE, { text: stampText("maple only") });
    const lakeRefs = new Set((await withSql(ownerSql, (sql) => casesOf(sql, LAKEVIEW))).map((c) => c.ref));
    if (!lakeRefs.has(mapleOnly.ref)) {
      expect((await lake.goto(`/app/cases/${mapleOnly.ref}`))?.status()).toBe(404);
      await expect(lake.getByRole("main")).not.toContainText("maple only");
    }
    await lake.context().close();

    const mapleLead = await (await browser.newContext()).newPage();
    await signInAs(mapleLead, "E2E_LEAD_EMAIL");
    expect((await mapleLead.goto(`/app/cases/${ref}`))?.status()).toBe(200);
    await expect(mapleLead.getByRole("heading", { level: 1, name: ref })).toBeVisible();
    await expect(mapleLead.getByRole("main")).not.toContainText("TTY option");
    await expect(mapleLead.getByRole("main")).toContainText(norm(mapleSame!.redactedText).slice(0, 30));
    await mapleLead.context().close();
  });

  test("an auditor sees no forms and no buttons on a case, before or after the redaction review", async ({ browser }) => {
    test.skip(!LOCAL, "signs in through the local 'Sign in as' page");
    const fresh = await fileReport(MAPLE, { text: stampText("auditor new") });
    const assigned = await fileReport(MAPLE, { text: stampText("auditor assigned") });
    await moveCase(MAPLE, assigned.ref, "assigned");
    const page = await (await browser.newContext()).newPage();
    await signInAsAuditorHere(page);
    for (const c of [fresh, assigned]) {
      expect((await page.goto(`/app/cases/${c.ref}`))?.status()).toBe(200);
      const main = page.getByRole("main");
      await expect(main.locator("form"), c.ref).toHaveCount(0);
      await expect(main.getByRole("button"), c.ref).toHaveCount(0);
      await expect(main.getByRole("textbox")).toHaveCount(0);
      await expect(main.getByRole("combobox")).toHaveCount(0);
    }
    await page.context().close();
  });

  test("every case action refuses a caller with the wrong role, even from a lead's open page", async ({ browser }) => {
    test.skip(!LOCAL, "switches sessions through the local 'Sign in as' page");
    // Cases for each step; the lead's pages are opened first, then the session in the same browser changes.
    const toTriage = await fileReport(MAPLE, { text: stampText("refuse triage") });
    await moveCase(MAPLE, toTriage.ref, "approved");
    const toAssign = await fileReport(MAPLE, { text: stampText("refuse assign") });
    await moveCase(MAPLE, toAssign.ref, "triaged");
    const toReview = await fileReport(MAPLE, { text: stampText("refuse review") });
    const otherTeam = await fileReport(MAPLE, { text: stampText("refuse fix") });
    await moveCase(MAPLE, otherTeam.ref, "triaged");

    const context = await browser.newContext();
    const pages = {
      triage: await context.newPage(),
      assign: await context.newPage(),
      review: await context.newPage(),
      reveal: await context.newPage(),
      fix: await context.newPage(),
    };
    await signInAs(pages.triage, "E2E_LEAD_EMAIL");
    // The lead gives this case to the Web team, so Facilities team (the e2e owner) is not its assignee.
    await pages.fix.goto(`/app/cases/${otherTeam.ref}`);
    await pages.fix.getByLabel("Assign to").selectOption({ label: "Web team" });
    await pages.fix.getByRole("button", { name: "Assign" }).click();
    await expect(pages.fix.getByTestId("case-status")).toHaveText("Assigned");
    await pages.fix.getByLabel("What did you fix?").fill("Fixed it.");
    await pages.triage.goto(`/app/cases/${toTriage.ref}`);
    await pages.triage.getByLabel("Priority area").selectOption("built_environment");
    await pages.triage.getByLabel("Public summary").fill("A door did not open.");
    await pages.assign.goto(`/app/cases/${toAssign.ref}`);
    await pages.assign.getByLabel("Assign to").selectOption({ label: "Facilities team" });
    await pages.review.goto(`/app/cases/${toReview.ref}`);
    await pages.reveal.goto(`/app/cases/${toReview.ref}`);

    const attempt = async (expected: { fix: string }) => {
      await pages.triage.getByRole("button", { name: "Save triage" }).click();
      await expect(pages.triage.getByTestId("case-action-result")).toContainText(ROLE_REFUSED);
      await pages.assign.getByRole("button", { name: "Assign" }).click();
      await expect(pages.assign.getByTestId("case-action-result")).toContainText(ROLE_REFUSED);
      await pages.review.getByRole("button", { name: "Approve redaction" }).click();
      await expect(pages.review.getByTestId("case-action-result")).toContainText(ROLE_REFUSED);
      await pages.reveal.getByRole("button", { name: "Show original" }).click();
      await expect(pages.reveal.getByRole("main")).toContainText(ROLE_REFUSED);
      await expect(pages.reveal.getByRole("region", { name: "Original report" })).toHaveCount(0);
      await pages.fix.getByRole("button", { name: "Log fix" }).click();
      await expect(pages.fix.getByTestId("case-action-result")).toContainText(expected.fix);
    };
    const unchanged = async () => {
      const triage = await caseFacts(MAPLE, toTriage.ref);
      const assign = await caseFacts(MAPLE, toAssign.ref);
      const review = await caseFacts(MAPLE, toReview.ref);
      const fix = await caseFacts(MAPLE, otherTeam.ref);
      expect(triage.status).toBe("new");
      expect(assign.status).toBe("triaged");
      expect(review.redactionApprovedAt).toBeNull();
      expect(review.events.map((e) => e.type)).not.toContain("redaction_approved");
      expect(review.events.map((e) => e.type)).not.toContain("private_revealed");
      expect(fix.status).toBe("assigned");
      expect(fix.events.map((e) => e.type)).not.toContain("fix_logged");
    };

    // The owner (Facilities team) takes over this browser's session. Owners may log fixes, but only on their own
    // cases: this one is the Web team's, so it is "not found", exactly like a 404.
    const switcher = await context.newPage();
    await signInAs(switcher, "E2E_OWNER_EMAIL");
    await attempt({ fix: NOT_FOUND });
    await unchanged();
    expect((await switcher.goto(`/app/cases/${otherTeam.ref}`))?.status()).toBe(404);

    // Then the auditor: read-only, every action refused.
    await signInAsAuditorHere(switcher);
    await attempt({ fix: ROLE_REFUSED });
    await unchanged();
    await context.close();
  });
});

test.describe("Phase 2: receipt codes belong to one org (domain §9)", () => {
  /** A well-formed receipt code that (almost certainly) belongs to nobody. */
  const unknownCode = () =>
    [...randomBytes(16)].map((b) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[b % 32]).join("").match(/.{4}/g)!.join("-");

  test("a Maple Harbour receipt code in the Lakeview receipt context is a 404; unknown /r/ codes are a 404", async ({ request }) => {
    // /r/[code] has no org in its URL (the code alone resolves the org), so the org-scoped receipt context is
    // /o/[orgSlug]/receipt with the code in its cookie (docs/decisions.md "Cross-org receipt check").
    const maple = await fileReport(MAPLE, { text: `The automatic door button at the side entrance is broken (receipt scope ${Date.now().toString(36)}).` });
    const cookie = { cookie: `al_receipt=${maple.code}` };
    const own = await request.get(`/o/${MAPLE}/receipt`, { headers: cookie });
    expect(own.status()).toBe(200);
    expect(await own.text()).toContain(maple.ref);

    const foreign = await request.get(`/o/${LAKEVIEW}/receipt`, { headers: cookie });
    expect(foreign.status()).toBe(404);
    const body = await foreign.text();
    expect(body).not.toContain(maple.ref);
    expect(body).not.toContain(maple.code);
    expect(body).not.toContain("We got your report");

    // The code still works where it belongs, and a code nobody holds is a 404 that says nothing.
    expect((await request.get(`/r/${maple.code}`)).status()).toBe(200);
    for (const path of [`/r/${unknownCode()}`, `/r/${unknownCode().toLowerCase()}`, "/r/not-a-code"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).not.toContain("Where your report is now");
    }
  });
});

function textsOf(c: OrgCase): string[] {
  return [c.summary, c.aiSummary, c.redactedText].filter((t): t is string => !!t && !!t.trim());
}
