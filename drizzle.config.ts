try { process.loadEnvFile(".env.local"); } catch { /* no .env.local: use the real environment */ }

import { defineConfig } from "drizzle-kit";

// Owner connection (MIGRATION_DATABASE_URL), never the app role. `db:generate` needs no database.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
});
