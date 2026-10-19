import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

const LOCAL = process.env.AUTH_MODE === "local";

/** Fails the test on ANY axe violation at WCAG 2.0/2.1/2.2 A and AA. */
export async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`);
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

type Who = "E2E_LEAD_EMAIL" | "E2E_OWNER_EMAIL" | "E2E_OTHER_LEAD_EMAIL";

const ORG_FOR: Record<Who, "SEED_CLERK_ORG_ID_DEMO" | "SEED_CLERK_ORG_ID_OTHER"> = {
  E2E_LEAD_EMAIL: "SEED_CLERK_ORG_ID_DEMO",
  E2E_OWNER_EMAIL: "SEED_CLERK_ORG_ID_DEMO",
  E2E_OTHER_LEAD_EMAIL: "SEED_CLERK_ORG_ID_OTHER",
};

// Local mode: the seeded display names (db/seed.ts) the /sign-in page shows as buttons.
const LOCAL_NAME: Record<Who, string> = {
  E2E_LEAD_EMAIL: "Alex Rivera",
  E2E_OWNER_EMAIL: "Facilities team",
  E2E_OTHER_LEAD_EMAIL: "Other org lead",
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Sign in as a seeded staff user.
 * - AUTH_MODE=local (prototype): /sign-in lists seeded staff as buttons named
 *   "Sign in as {display name} ({org name})"; clicking one sets the local session cookie (lib/auth/local-session.ts).
 * - Clerk mode (going live): Clerk testing helpers + CLERK_SECRET_KEY, then make the user's org ACTIVE so
 *   auth().orgId is set. If the installed @clerk/testing signature differs, adapt THIS helper only.
 */
export async function signInAs(page: Page, who: Who) {
  if (LOCAL) {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: new RegExp(`^Sign in as ${escapeRe(LOCAL_NAME[who])}`) }).click();
    await page.waitForURL(/\/app\//);
    return;
  }
  const emailAddress = process.env[who];
  const orgId = process.env[ORG_FOR[who]];
  if (!emailAddress) throw new Error(`${who} is not set`);
  if (!orgId) throw new Error(`${ORG_FOR[who]} is not set`);
  await setupClerkTestingToken({ page });
  await page.goto("/sign-in");
  await clerk.signIn({ page, emailAddress });
  await page.evaluate(async (organization) => {
    const c = (window as unknown as { Clerk: { setActive: (p: { organization: string }) => Promise<void> } }).Clerk;
    await c.setActive({ organization });
  }, orgId);
}

export async function signOut(page: Page) {
  if (LOCAL) {
    await page.getByRole("button", { name: "Sign out" }).click();
    return;
  }
  await clerk.signOut({ page });
}
