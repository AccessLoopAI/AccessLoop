// FROZEN. The ONLY way to touch tenant tables. See docs/domain.md §9.
// RLS reads app.org_id / app.role; they are set transaction-locally, so pooled connections never leak them.
// Server-only: never import from a client component. (No "server-only" import, so tsx scripts like db/seed.ts can use it.)
import { sql } from "drizzle-orm";
import { db, type Tx } from "./client";

export type TenantRole = "lead" | "owner" | "auditor" | "reporter" | "public" | "system";

export interface TenantCtx {
  orgId: string;
  role: TenantRole;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withOrg<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.orgId)) throw new Error("withOrg: orgId must be a uuid resolved server-side");
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${ctx.orgId}, true), set_config('app.role', ${ctx.role}, true)`,
    );
    return fn(tx);
  });
}

/** Serialize per-org counters (case seq) inside a withOrg transaction. */
export async function lockOrgCounter(tx: Tx, orgId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"case_seq:" + orgId}))`);
}

/** Public receipt lookup (SECURITY DEFINER fn, no org needed). Returns null when unknown. */
export async function resolveReceipt(codeHash: string): Promise<{ orgId: string; caseId: string } | null> {
  const rows = await db.execute<{ org_id: string; case_id: string }>(
    sql`select org_id, case_id from resolve_receipt(${codeHash})`,
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, caseId: r.case_id } : null;
}

/** Public /verify lookup: org of a signed-off AND published report, else null (drafts need a staff session). */
export async function resolvePublishedReport(reportId: string): Promise<string | null> {
  if (!UUID.test(reportId)) return null;
  const rows = await db.execute<{ org_id: string | null }>(
    sql`select resolve_published_report(${reportId}::uuid) as org_id`,
  );
  return rows[0]?.org_id ?? null;
}
