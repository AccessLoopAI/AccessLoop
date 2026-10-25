import { defineConfig, devices } from "@playwright/test";

// Load .env.local without dotenv (Node >= 20.12). Missing file is fine (CI sets real env vars).
try { process.loadEnvFile(".env.local"); } catch { /* no .env.local */ }

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(baseURL);
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET; // for protected Vercel preview URLs (going live)
/** The specs of the reporter's side (no staff sign-in needed for their subject), also run in WebKit. qr-prefill: a
 *  location poster's link (Phase 7 T4.5). */
const REPORTER_SPECS = /(reporter|text-spacing|qr-prefill)\.spec\.ts$/;

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0, // a flaky demo is a broken demo: fix the cause, don't retry
  workers: 1, // specs share one database; run them in order
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: !isLocal && bypass ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" } : {},
  },
  // Local prototype: start Postgres + a PRODUCTION build with fakes forced. A running `npm run local` (next dev)
  // is reused only if you opt in with E2E_REUSE=1; by default a leftover dev server makes the run fail loudly.
  webServer: isLocal
    ? {
        command: "npm run local:serve",
        url: baseURL,
        reuseExistingServer: process.env.E2E_REUSE === "1",
        timeout: 300_000,
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>,
          FAKE_LLM: "1", FAKE_EMAIL: "1", AI_BACKEND: "fake" },
      }
    : undefined,
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "chromium", dependencies: ["setup"], use: { ...devices["Desktop Chrome"] } },
    // Phase 7 T4.7: the reporter specs again in WebKit, Safari's engine (iPhone and Mac reporters; VoiceOver users are
    // on Safari). After Chromium, as its own project, so the Chromium run keeps its order in the shared database.
    // Install it once with `npx playwright install webkit`.
    { name: "webkit", dependencies: ["setup"], testMatch: REPORTER_SPECS, use: { ...devices["Desktop Safari"] } },
  ],
});
