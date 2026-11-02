// /verify's fifth check, the sign-off lock and the offline checker, against the local production build (docs/domain.md
// §8 "Signed at sign-off"; docs/archive/phase7-prompt.md T5 items 4-6). A published report: "Signed by AccessLoop at sign-off:
// Passed", a "Signed at sign-off" column in "Records", and a "Check it yourself, offline" section whose three
// downloads (the evidence bundle, the published keys, the checking script itself) pass when the script runs on them
// with Node alone. Then the lead's text is changed through the owner connection: the sign-off lock trigger refuses
// it; with the trigger switched off inside one transaction (as whoever controls the database could), the change goes
// through, only check 5 turns red (checks 1-3 stay green, axe in both themes), and the same script fails on the
// re-downloaded bundle. Restored in `finally`. Specs share one database: never fixed counts.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, expect, type Browser, type Page } from "@playwright/test";
import { expectNoAxeViolations, signInAs } from "./helpers";
import { ownerSql, withSql, type Sql } from "./db";
import { makeReport } from "./fixtures/reports";

const ORG = "maple-harbour";
const KEYS = "/.well-known/accessloop-signing-keys.json";
const SCRIPT = "/verify/verify-bundle.mjs";

test.describe.configure({ mode: "serial" });

/** A made-up loopback client address (127.x.y.z) per anonymous context: its own rate-limit bucket (IPv6 is counted per /64). */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));

async function anon(browser: Browser): Promise<Page> {
  return (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
}

async function axeBothThemes(page: Page, label: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // A theme switch starts colour transitions: let them finish before axe reads the colours (as e2e/verify.spec.ts).
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    });
    await expectNoAxeViolations(page, `${label} (${scheme})`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** The three downloads, saved the way a third party would, and the script run on them: [exit code, output]. */
async function runChecker(page: Page, reportId: string, dir: string, ...extra: string[]): Promise<[number | null, string]> {
  const get = async (url: string) => {
    const res = await page.request.get(url, { headers: { "x-forwarded-for": freshIp() } });
    expect(res.status(), url).toBe(200);
    return res;
  };
  const script = await get(SCRIPT);
  expect(script.headers()["content-type"]).toContain("javascript");
  expect(script.headers()["content-disposition"]).toBe('attachment; filename="verify-bundle.mjs"');
  writeFileSync(path.join(dir, "verify-bundle.mjs"), await script.text());
  writeFileSync(path.join(dir, "accessloop-signing-keys.json"), await (await get(KEYS)).text());
  writeFileSync(path.join(dir, "evidence.json"), await (await get(`/p/${ORG}/reports/${reportId}/evidence.json`)).text());
  const r = spawnSync(process.execPath, ["verify-bundle.mjs", "evidence.json", "--keys", "accessloop-signing-keys.json", ...extra], { cwd: dir, encoding: "utf8" });
  return [r.status, r.stdout];
}

/** Change the stored lead text as the database owner, with the sign-off lock switched off in this transaction only. */
async function setConsultations(sql: Sql, orgId: string, reportId: string, text: string | null) {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${orgId}, true)`;
    await tx.unsafe("ALTER TABLE reports DISABLE TRIGGER reports_signed_off_lock");
    const hit = await tx`update reports set consultations_text = ${text} where id = ${reportId} returning id`;
    if (hit.length !== 1) throw new Error(`changed ${hit.length} rows`);
    await tx.unsafe("ALTER TABLE reports ENABLE TRIGGER reports_signed_off_lock");
  });
}

let dir = "";
test.beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "al-e2e-verify-"));
});
test.afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("a published report: the fifth check passes, and the downloaded checker passes on the downloaded bundle", async ({ browser }) => {
  const report = await makeReport(ORG, { publish: true });
  const page = await anon(browser);
  await page.goto(`/verify/${report.id}`);
  await expect(page.getByRole("status")).toContainText("All records match");
  const checks = page.getByRole("region", { name: "The five checks" });
  await expect(checks).toContainText("Signed by AccessLoop at sign-off: Passed");
  await expect(checks).toContainText("The two signed fingerprints are the same.");
  const table = page.getByRole("table", { name: "Records" });
  await expect(table.getByRole("columnheader", { name: "Signed at sign-off", exact: true })).toHaveCount(1);
  await expect(table.locator("tbody > tr").first()).toContainText("Signed");

  // "Check it yourself, offline": the three downloads and the command.
  await expect(page.getByRole("heading", { level: 2, name: "Check it yourself, offline" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download evidence bundle" })).toHaveAttribute("href", `/p/${ORG}/reports/${report.id}/evidence.json`);
  await expect(page.getByRole("link", { name: "AccessLoop’s published signing keys" }).first()).toHaveAttribute("href", KEYS);
  await expect(page.getByRole("link", { name: "Download the checking script (verify-bundle.mjs)" })).toHaveAttribute("href", SCRIPT);
  await expect(page.getByTestId("offline-command")).toHaveText(/^node verify-bundle\.mjs .+-evidence\.json --keys accessloop-signing-keys\.json$/);
  // The passing signed state (both signed fingerprints side by side, the offline steps) passes axe in both themes too.
  await axeBothThemes(page, "verify (signed, published)");

  // The served script is exactly the one in the source code.
  const served = await (await page.request.get(SCRIPT, { headers: { "x-forwarded-for": freshIp() } })).text();
  expect(served).toBe(readFileSync(path.join("tools", "verify-bundle.mjs"), "utf8"));

  const root = (await (await page.request.get(`/p/${ORG}/reports/${report.id}/evidence.json`, { headers: { "x-forwarded-for": freshIp() } })).json()).signature.root as string;
  const [code, out] = await runChecker(page, report.id, dir, "--expect-root", root.match(/.{4}/g)!.join(" "));
  expect(out).toContain("PASS  Signature: Ed25519, valid for key ed25519-");
  expect(out).toContain("PASS  Case histories:");
  expect(out).toContain("PASS  Report numbers:");
  expect(out.trim().endsWith("All checks passed.")).toBe(true);
  expect(code).toBe(0);
  await page.context().close();
});

test("the lead's text changed after sign-off: refused by the database; with the lock off, check 5 turns red and the checker fails", async ({ browser }) => {
  const report = await makeReport(ORG, { publish: true });
  const page = await anon(browser);
  await withSql(ownerSql, async (sql) => {
    const [{ orgId, text }] = await sql<{ orgId: string; text: string | null }[]>`
      select org_id as "orgId", consultations_text as text from reports where id = ${report.id}`;
    // The sign-off lock (D7(a)) refuses the change, even for the owner.
    await expect(
      sql.begin(async (tx) => {
        await tx`select set_config('app.org_id', ${orgId}, true)`;
        await tx`update reports set consultations_text = 'We met our advisory group every month.' where id = ${report.id}`;
      }),
    ).rejects.toThrow(/signed off and locked/);

    await setConsultations(sql, orgId, report.id, "We met our advisory group every month.");
    try {
      await page.goto(`/verify/${report.id}`);
      await expect(page.getByRole("heading", { level: 1, name: "Evidence check" })).toBeVisible();
      await expect(page.getByRole("status")).toContainText("it no longer matches what AccessLoop signed at sign-off (the lead's own text changed)");
      await expect(page.getByTestId("evidence-line")).toHaveText(/^Problems found:/);
      const checks = page.getByRole("region", { name: "The five checks" });
      for (const ok of ["Report unchanged: Passed", "Records intact: Passed", "Report matches records: Passed"]) await expect(checks).toContainText(ok);
      await expect(checks).toContainText("Signed by AccessLoop at sign-off: Failed");
      await expect(checks).toContainText("The two signed fingerprints are different.");
      const cells = await page.getByRole("table", { name: "Records" }).locator("tbody > tr > td:last-child").allTextContents();
      expect(cells.length).toBeGreaterThan(0);
      expect(new Set(cells.map((t) => t.trim()))).toEqual(new Set(["Signature fails"]));
      await axeBothThemes(page, "verify (signed, lead text changed)");

      const [code, out] = await runChecker(page, report.id, dir);
      expect(out).toContain("FAIL  Signed root");
      expect(out).toContain("the lead's own text (the area sections or Consultations) is not the text that was signed");
      expect(out).toContain("PASS  Report fingerprint");
      expect(code).toBe(1);
    } finally {
      await setConsultations(sql, orgId, report.id, text);
    }
  });
  await page.reload();
  await expect(page.getByRole("status")).toContainText("All records match");
  await page.context().close();
});

test("a draft: not signed yet, which never fails the check; the offline steps wait for publishing", async ({ browser }) => {
  const draft = await makeReport(ORG);
  const page = await (await browser.newContext()).newPage();
  await signInAs(page, "E2E_LEAD_EMAIL");
  await page.goto(`/verify/${draft.id}`);
  await expect(page.getByRole("status")).toContainText("All records match");
  await expect(page.getByRole("region", { name: "The five checks" })).toContainText("Signed by AccessLoop at sign-off: Not signed yet");
  await expect(page.getByRole("main")).toContainText("The evidence bundle and the checking script work once the report is signed off and published.");
  await expect(page.getByTestId("offline-command")).toHaveCount(0);
  await page.context().close();
});
