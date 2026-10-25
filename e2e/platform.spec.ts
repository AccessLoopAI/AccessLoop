// Phase 7 T3 platform checks against the running production build (docs/decisions.md 2026-10-20):
// - GET /api/health answers through the app role, says which modes this build runs with, and carries no secret;
// - local sign-in refuses a request that came through a proxy or tunnel (lib/auth/local-request.ts), even with
//   `Host: localhost`, while a plain request (what `next start` itself forwards) keeps working;
// - the security headers (next.config.ts) on public and staff responses, and a native form POST (no JavaScript)
//   still reaching its server action under the public referrer policy;
// - the dashboard's line for the web form's daily cap (lib/rate-limit.ts), and both states once the cap is reached.
// The suite's own browser contexts reach the app directly, so they are local; nothing here changes the database
// (the /check tries are counted in their own made-up loopback address's rate-limit bucket), except the reached-cap
// test, which fills the scenario org's counter for today and puts it back.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { casesOf, ownerSql, withSql } from "./db";
import { fillOrgCap } from "./fixtures/cap";
import { gotoHydrated } from "./hydration";

/** A made-up client address in 127/8 (loopback: local sign-in refuses others): its own rate-limit bucket. */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

const LOCAL = process.env.AUTH_MODE === "local";

test.describe("GET /api/health", () => {
  test("answers 200 with the database reachable, the modes, no secrets, never cached", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, db: "ok", aiBackend: "fake", emailMode: "fake" }); // Playwright forces fakes
    expect(Object.keys(body).sort()).toEqual(["aiBackend", "authMode", "commit", "db", "emailMode", "ok"]);
    if (LOCAL) expect(body.authMode).toBe("local");

    // No value of .env.local appears in the answer (read here only to compare, never printed).
    const text = await res.text();
    let env = "";
    try {
      env = readFileSync(".env.local", "utf8");
    } catch {
      // CI without a file: the variables come from the environment, and the key list above already bounds the body.
    }
    for (const line of env.split(/\r?\n/)) {
      const value = line.match(/^\s*[A-Z0-9_]+\s*=\s*"?([^"]*)"?\s*$/)?.[1] ?? "";
      if (value.length >= 12) expect(text.includes(value), "a .env.local value in /api/health").toBe(false);
    }
  });
});

test.describe("local sign-in through a proxy or tunnel (Phase 7 T3 item 4)", () => {
  test.skip(!LOCAL, "local sign-in only exists in AUTH_MODE=local");

  test("/sign-in works for a plain local request, and is a 404 when forwarding headers point elsewhere", async ({ request }) => {
    // Control: `next start` adds its own X-Forwarded-Host (= Host) and X-Forwarded-For (127.0.0.1); those pass.
    const plain = await request.get("/sign-in");
    expect(plain.status()).toBe(200);
    expect(await plain.text()).toContain("Sign in as");
    const loopback = await request.get("/sign-in", { headers: { host: "localhost", "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "localhost" } });
    expect(loopback.status()).toBe(200);

    const forwarded: Record<string, string>[] = [
      { host: "localhost", "x-forwarded-host": "evil.example" }, // the brief's case
      { host: "localhost", "x-forwarded-for": "203.0.113.9" },
      { host: "localhost", "x-forwarded-for": "127.0.0.1, 203.0.113.9" },
      { host: "localhost", "x-real-ip": "198.51.100.4" },
      { host: "localhost", forwarded: "for=203.0.113.9;proto=https;host=abc.ngrok-free.app" },
      { host: "localhost", forwarded: 'for="[::1]";host=evil.example' },
    ];
    for (const headers of forwarded) {
      const res = await request.get("/sign-in", { headers });
      expect(res.status(), JSON.stringify(headers)).toBe(404);
      expect(await res.text(), JSON.stringify(headers)).not.toContain("Sign in as");
    }
  });

  test("a valid staff session does not open /app through a proxy: proxy.ts sends it to /sign-in", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, "E2E_LEAD_EMAIL");

    const direct = await context.request.get("/app/inbox", { maxRedirects: 0 });
    expect(direct.status()).toBe(200);

    const viaProxy: Record<string, string>[] = [{ "x-forwarded-host": "evil.example" }, { "x-forwarded-for": "203.0.113.9" }, { forwarded: "for=203.0.113.9" }];
    for (const headers of viaProxy) {
      const res = await context.request.get("/app/inbox", { headers, maxRedirects: 0 });
      expect(res.status(), JSON.stringify(headers)).toBe(303);
      expect(new URL(res.headers()["location"] ?? "", "http://x").pathname).toBe("/sign-in");
    }
    await context.close();
  });
});

test.describe("security headers (Phase 7 T3 item 6)", () => {
  const COMMON = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  };

  test("public pages, assets and API answers: never framed, never sniffed, a referrer only to this site", async ({ request }) => {
    for (const path of ["/", "/o/maple-harbour/report", "/check", "/p/maple-harbour", "/api/health", "/favicon.ico"]) {
      const res = await request.get(path, { headers: { "x-forwarded-for": freshIp() } });
      expect(res.status(), path).toBeLessThan(400);
      const h = res.headers();
      expect(h, path).toMatchObject({ ...COMMON, "referrer-policy": "same-origin" });
      expect(h["content-security-policy-report-only"], path).toContain("default-src 'self'");
      expect(h["content-security-policy-report-only"], path).toContain("frame-ancestors 'none'");
      expect(h["strict-transport-security"], path).toBeUndefined(); // only on Vercel builds
    }
  });

  test("staff pages: strict-origin-when-cross-origin", async ({ browser, request }) => {
    expect((await request.get("/sign-in")).headers()).toMatchObject({ ...COMMON, "referrer-policy": "strict-origin-when-cross-origin" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAs(page, "E2E_LEAD_EMAIL");
    const res = await context.request.get("/app/inbox", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()).toMatchObject({ ...COMMON, "referrer-policy": "strict-origin-when-cross-origin" });
    await context.close();
  });

  test("a native form POST without JavaScript still reaches its server action (the browser sends a real Origin)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
    const page = await context.newPage();
    await page.goto("/check");
    const origins: (string | undefined)[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") origins.push(r.headers()["origin"]);
    });
    await page.getByLabel("Your receipt code").fill("1234");
    await Promise.all([page.waitForLoadState("load"), page.getByRole("button", { name: "Check", exact: true }).click()]);
    await expect(page.getByRole("main")).toContainText("That code doesn't look right.");
    // With Referrer-Policy: no-referrer the browser would send `Origin: null` here, and Next would refuse the action.
    expect(origins).toEqual([new URL(baseURL ?? "http://localhost:3000").origin]);
    await context.close();
  });
});

test.describe("the web form's daily cap on the dashboard (Phase 7 T3 item 7)", () => {
  test("the lead sees today's count against the cap; this computer's own reports are not counted locally", async ({ page }) => {
    await signInAs(page, "E2E_LEAD_EMAIL");
    await page.goto("/app/dashboard");
    const line = page.getByTestId("intake-cap");
    await expect(line).toContainText(/Web reports today: \d+ of the \d+ the form takes each day/);
    if (LOCAL) await expect(line).toContainText("In this local prototype, reports sent from this computer are not counted.");
    await expectNoAxeViolations(page, "dashboard with the daily cap line");
  });
});

// Review finding (docs/decisions.md 2026-10-21): the cap once REACHED was never rendered in any spec, so its two
// states (the dashboard's warning and the form's "Your report was not sent") had no axe check (CLAUDE.md: every page
// and state). The cap is filled for the scenario org only, which no other spec reports to, and put back afterwards.
test.describe("the web form's daily cap, once reached", () => {
  test("the dashboard warns, and 'Send report' saves nothing and names the org's other channels; axe on both", async ({ browser }) => {
    test.skip(!LOCAL, "fills the cap through the local database and signs in with a local button");
    const SLUG = "kestrel-bay";
    const cap = await fillOrgCap(SLUG);
    try {
      const staff = await (await browser.newContext()).newPage();
      await staff.goto("/sign-in");
      await staff.getByRole("button", { name: /^Sign in as Riley Brennan/ }).click();
      await staff.waitForURL(/\/app\//);
      await staff.goto("/app/dashboard");
      const line = staff.getByTestId("intake-cap");
      await expect(line).toContainText(`The report form has taken today's ${cap.limit} reports`);
      await expect(line).toContainText("Feedback you log yourself is not limited.");
      await axeBothThemes(staff, "dashboard, daily cap reached");
      await staff.context().close();

      // A reporter from elsewhere (not this computer's loopback, so the cap counts them): nothing is saved.
      const reporter = await (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": `2001:db8:${randomBytes(2).toString("hex")}::7` } })).newPage();
      const before = await caseCount(SLUG);
      await gotoHydrated(reporter, `/o/${SLUG}/report`);
      await reporter.getByLabel("What got in your way?").fill(`The phone menu hangs up before I can answer (cap ${Date.now()}).`);
      await reporter.getByRole("button", { name: "Next" }).click();
      await reporter.getByRole("group", { name: "Where did it happen?" }).getByRole("radio", { name: "On the phone or at a service" }).check();
      await reporter.getByRole("button", { name: "Next" }).click();
      await reporter.getByRole("group", { name: "How can we follow up?" }).getByRole("radio", { name: "Don't contact me" }).check();
      await reporter.getByRole("button", { name: "Next" }).click();
      await expect(reporter.getByRole("heading", { level: 2, name: "Check your report" })).toBeFocused({ timeout: 15_000 });
      await reporter.getByRole("radio", { name: "Yes, that's right" }).check();
      await reporter.getByRole("button", { name: "Send report" }).click();
      const notSent = reporter.getByText("Your report was not sent");
      await expect(notSent).toBeVisible();
      await expect(reporter.getByRole("main")).toContainText("This form has taken all the reports it can for today. Your answers are still here.");
      await expect(reporter.getByRole("heading", { level: 1, name: "We got your report" })).toHaveCount(0);
      await axeBothThemes(reporter, "report form, daily cap reached");
      expect(await caseCount(SLUG)).toBe(before);
      await reporter.context().close();
    } finally {
      await cap.restore();
    }
  });
});

/** axe in the light theme, then the dark one, after the theme switch's colour transitions finish (as e2e/dashboard.spec.ts). */
async function axeBothThemes(page: Page, label: string) {
  const settle = () =>
    page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await settle();
    await expectNoAxeViolations(page, `${label} (${colorScheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function caseCount(slug: string): Promise<number> {
  return withSql(ownerSql, async (sql) => (await casesOf(sql, slug)).length);
}
