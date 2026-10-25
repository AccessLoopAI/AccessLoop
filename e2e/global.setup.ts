import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

setup.describe.configure({ mode: "serial" });

setup("auth setup", async () => {
  if (process.env.AUTH_MODE === "local") return; // local prototype: no Clerk
  await clerkSetup(); // needs CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY of the DEV instance
});
