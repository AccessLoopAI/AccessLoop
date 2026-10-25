// Test-only: an in-process Postgres (PGlite) with the real drizzle migrations applied. No security SQL is
// installed (no app role, no RLS, no append-only trigger), so tests can tamper with case_events directly.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import type { Tx } from "@/db/client";
import * as schema from "@/db/schema";

const MIGRATIONS_URL = new URL("../../db/migrations/", import.meta.url);
const MIGRATIONS_DIR = fileURLToPath(MIGRATIONS_URL);

export interface TestDb {
  client: PGlite;
  db: PgliteDatabase<typeof schema>;
  /** Run `fn` in a transaction. The frozen functions only use the query builder, so the PGlite tx stands in for Tx. */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) throw new Error(`no migrations in ${MIGRATIONS_DIR}`);
  for (const f of files) {
    const statements = readFileSync(new URL(f, MIGRATIONS_URL), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
  }
  const db = drizzle(client, { schema });
  return {
    client,
    db,
    tx: (fn) => db.transaction((t) => fn(t as unknown as Tx)),
    close: () => client.close(),
  };
}

let counter = 0;

/** An org row with the fields the schema requires. */
export async function insertOrg(t: TestDb, name = "Test org") {
  counter++;
  const [org] = await t.db.insert(schema.orgs).values({
    clerkOrgId: `test_org_${counter}_${Date.now()}`,
    slug: `test-org-${counter}-${Date.now()}`,
    name,
    planAreas: ["built_environment", "ict"],
    feedbackDesignateTitle: "Accessibility lead",
    contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
    contactPhone: "1-800-555-0101",
    contactEmail: "access@example.org",
  }).returning();
  return org;
}

/** A bare case row (status new). Real intake goes through createCase(); this is only for chain tests. */
export async function insertCase(t: TestDb, orgId: string, overrides: Partial<typeof schema.cases.$inferInsert> = {}) {
  counter++;
  const receivedAt = new Date("2026-09-01T14:00:00.000Z");
  const [row] = await t.db.insert(schema.cases).values({
    orgId,
    seq: counter,
    ref: `BAR-${String(counter).padStart(4, "0")}`,
    intakeChannel: "web",
    locationKind: "place",
    redactedText: "The automatic door button at [STREET_ADDRESS] is broken. Call me at [PHONE].",
    receiptCodeHash: `${counter}`.padStart(64, "0"),
    receivedAt,
    retentionUntil: "2033-09-01",
    ...overrides,
  }).returning();
  return row;
}

export async function insertMember(t: TestDb, orgId: string, role: "lead" | "owner" | "auditor", displayName: string) {
  counter++;
  const [m] = await t.db.insert(schema.orgMembers).values({
    orgId, clerkUserId: `test_user_${counter}`, displayName, role,
  }).returning();
  return m;
}
