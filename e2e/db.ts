// E2E-only database access (never imported by the app). playwright.config.ts loads .env.local, so the URLs
// come from process.env. Connection strings are never printed. Reads set app.org_id inside a transaction,
// so they work whether or not the owner role bypasses RLS.
import postgres from "postgres";

export type Sql = ReturnType<typeof postgres>;

function need(name: "DATABASE_URL" | "MIGRATION_DATABASE_URL"): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (run npm run local:setup, or set it for this e2e target)`);
  return v;
}

/** The owner connection (migrations, security SQL). */
export const ownerSql = (): Sql => postgres(need("MIGRATION_DATABASE_URL"), { max: 1, prepare: false, onnotice: () => {} });
/** The app connection (role accessloop_app: no BYPASSRLS, no UPDATE/DELETE on case_events). */
export const appSql = (): Sql => postgres(need("DATABASE_URL"), { max: 1, prepare: false, onnotice: () => {} });

export interface OrgCase {
  ref: string;
  status: string;
  summary: string | null;
  aiSummary: string | null;
  redactedText: string;
  locationDetail: string | null;
  /** The lead approved the redaction (cases.redaction_approved_at is set). */
  reviewed: boolean;
}

export async function withSql<T>(make: () => Sql, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = make();
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function orgId(sql: Sql, slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from orgs where slug = ${slug}`;
  if (!row) throw new Error(`org ${slug} is not in the database (run npm run local:setup)`);
  return row.id;
}

/** Every case of one org, read inside that org's RLS context. */
export async function casesOf(sql: Sql, slug: string): Promise<OrgCase[]> {
  const id = await orgId(sql, slug);
  return (await sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${id}, true), set_config('app.role', 'system', true)`;
    return tx<OrgCase[]>`
      select ref, status, summary, ai_summary as "aiSummary", redacted_text as "redactedText",
        location_detail as "locationDetail", redaction_approved_at is not null as reviewed
      from cases where org_id = ${id} order by seq`;
  })) as OrgCase[];
}

/** One event id of an org (for the append-only checks). */
export async function anyEventId(sql: Sql, slug: string): Promise<{ orgId: string; id: string; hash: string }> {
  const id = await orgId(sql, slug);
  const [row] = (await sql.begin(async (tx) => {
    await tx`select set_config('app.org_id', ${id}, true), set_config('app.role', 'system', true)`;
    return tx<{ id: string; hash: string }[]>`select id::text as id, hash from case_events where org_id = ${id} order by id limit 1`;
  })) as { id: string; hash: string }[];
  if (!row) throw new Error(`org ${slug} has no case events (run npm run local:setup)`);
  return { orgId: id, ...row };
}
