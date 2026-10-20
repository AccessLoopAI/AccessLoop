// READ-ONLY security smoke test against DATABASE_URL, as the app role (accessloop_app).
//   npm run db:remote-smoke             (DATABASE_URL from the environment, else .env.local)
//   npm run db:remote-smoke -- --strict (a SKIP counts as a failure)
//
// For a hosted database (Supabase, Going live) where `npm run db:smoke`'s in-memory PGlite can't help: it checks
// the same row-level-security, guard and SECURITY DEFINER properties as scripts/db-smoke.ts, but without writing:
// - every check runs in its own transaction that is ALWAYS rolled back;
// - checks that only read run in BEGIN READ ONLY;
// - a check that a write is refused attempts it in a read-write transaction, expects the refusal and rolls back
//   (Postgres reports a read-only transaction before a missing privilege, so these can't run READ ONLY). The
//   statements touch no rows (`where false`), except the two cross-org INSERTs, whose rows RLS must refuse, and
//   one no-op UPDATE (`set title = title`) of a signed-off report, which the sign-off lock must refuse (D7(a)).
//   Nothing touches a table with a sequence, so even the sequences stay where they were.
// It never prints row contents, receipt hashes, URLs, host names or secrets: only check names, PASS/FAIL/SKIP and
// table, role or function names. It refuses to run as a superuser or BYPASSRLS role (exit 2), prints one line per
// check and exits 1 if any check fails.
// No top-level await: works whether or not package.json sets "type": "module".
import postgres from "postgres";
import { randomBytes, randomUUID } from "node:crypto";

export const APP_ROLE = "accessloop_app";
/** db/sql/0100_security.sql's tenant tables. Any other public table with an org_id column is checked the same way. */
export const TENANT_TABLES = [
  "org_members", "cases", "case_private", "case_events", "attachments", "reports", "outbound_messages", "org_locations",
];
/** The only table the app may DELETE from (expired rate-limit windows). */
export const DELETE_ALLOWED = ["rate_limits"];
export const DEFINER_FUNCTIONS = ["resolve_receipt", "resolve_published_report"];
/**
 * Tables without org_id (approved D7(b), db/sql/0100_security.sql section 6): RLS is forced on them too, with policies
 * for named roles only, and the app role keeps the commands it uses outside withOrg (an ALL policy covers them all).
 */
export const GLOBAL_TABLE_APP_COMMANDS: Record<string, string[]> = {
  orgs: ["SELECT", "INSERT", "UPDATE"],
  rate_limits: ["SELECT", "INSERT", "UPDATE", "DELETE"],
};
/** The sign-off lock (approved D7(a), db/sql/0100_security.sql section 2b). */
export const SIGN_OFF_LOCK = { table: "reports", func: "reports_signed_off_immutable" };
/** Supabase's Data API roles. Where they exist they must not reach our tables or functions (approved D7(c)). */
export const API_ROLES = ["anon", "authenticated"];
/** Org contexts the per-org checks visit (bounded, so a large hosted database stays quick). */
export const MAX_ORGS = 25;
const NON_LEAD_ROLES = ["owner", "auditor", "reporter", "public", "system", ""];

export type Status = "PASS" | "FAIL" | "SKIP";
export interface Outcome { status: Status; note?: string }
export interface Result extends Outcome { id: string; title: string }

export type Row = Record<string, unknown>;
export type Q = (text: string, params?: unknown[]) => Promise<Row[]>;
export interface OrgCtx { orgId: string; role: string }

// ---------------------------------------------------------------- catalog (read-only, evaluated by pure code)

export interface TableInfo {
  name: string;
  rls: boolean;
  force: boolean;
  ownedByApp: boolean;
  hasOrgId: boolean;
  orgIdNotNull: boolean;
  priv: { select: boolean; insert: boolean; update: boolean; delete: boolean; truncate: boolean; trigger: boolean };
}
/** roles: the roles the policy applies to ("public" when it has no TO clause). */
export interface PolicyInfo { table: string; name: string; cmd: string; roles: string[]; qual: string | null; withCheck: string | null }
export interface TriggerInfo { table: string; name: string; enabled: string; type: number; func: string }
export interface FunctionInfo {
  name: string;
  secdef: boolean;
  config: string[];
  ownedByApp: boolean;
  appExec: boolean;
  publicExec: boolean;
  ownerName: string;
  ownerBypass: boolean;
}
/** tables: public tables/views it can SELECT, INSERT, UPDATE or DELETE; functions: SECURITY DEFINER functions it can call. */
export interface ApiRoleInfo { name: string; tables: number; functions: number }
export interface Catalog {
  currentUser: string;
  schemaCreate: boolean;
  databaseCreate: boolean;
  schemaOwnedByApp: boolean;
  tables: TableInfo[];
  policies: PolicyInfo[];
  triggers: TriggerInfo[];
  functions: FunctionInfo[];
  apiRoles: ApiRoleInfo[];
}

// ---------------------------------------------------------------- data found through the app role (read-only)

export interface Discovery {
  orgIds: string[];
  /** Orgs with at least one case visible to their lead, with one sample (kept in memory only, never printed). */
  sampleCase: { orgId: string; caseId: string; codeHash: string } | null;
  draftReports: { orgId: string; id: string }[];
  publishedReports: { orgId: string; id: string }[];
  /** Reports whose stored status is signed_off, published or not (the sign-off lock check). */
  signedOffReports: { orgId: string; id: string }[];
  tableOwner: string | null;
}

export interface ReadCtx {
  catalog: Catalog;
  data: Discovery;
  /** Run `fn` in BEGIN READ ONLY (optionally with app.org_id/app.role set), then ROLLBACK. */
  readOnly<T>(fn: (q: Q) => Promise<T>, org?: OrgCtx): Promise<T>;
}
export interface Refusal { refused: boolean; code?: string; message?: string }
export interface RefusalCtx extends ReadCtx {
  /** Attempt a statement that must be refused; ALWAYS rolled back. readOnly: true when the refusal isn't a write. */
  attempt(fn: (q: Q) => Promise<unknown>, opts?: { org?: OrgCtx; readOnly?: boolean }): Promise<Refusal>;
}

interface BaseCheck { id: string; title: string; covers: string }
export interface CatalogCheck extends BaseCheck { mode: "catalog"; run(c: Catalog): Outcome }
export interface ReadCheck extends BaseCheck { mode: "read-only"; run(ctx: ReadCtx): Promise<Outcome> }
export interface RefusalCheck extends BaseCheck { mode: "refusal"; run(ctx: RefusalCtx): Promise<Outcome> }
export type Check = CatalogCheck | ReadCheck | RefusalCheck;

const pass = (note?: string): Outcome => ({ status: "PASS", note });
const fail = (note: string): Outcome => ({ status: "FAIL", note });
const skip = (note: string): Outcome => ({ status: "SKIP", note });
const list = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));
const squash = (s: string | null) => (s ?? "").replace(/[\s()]+/g, " ").replace(/::text/g, "").trim();

export function tenantTables(c: Catalog): TableInfo[] {
  return c.tables.filter((t) => t.hasOrgId || TENANT_TABLES.includes(t.name));
}
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
/** pg_trigger.tgtype bits: ROW 1, BEFORE 2, DELETE 8, UPDATE 16. */
export const BEFORE_ROW_UPDATE_DELETE = 1 | 2 | 8 | 16;
export const BEFORE_ROW_UPDATE = 1 | 2 | 16;

// ---------------------------------------------------------------- the checks

export const CHECKS: Check[] = [
  {
    id: "role.app", mode: "catalog", covers: "app connects as accessloop_app (domain §9)",
    title: `connected as the app role (${APP_ROLE})`,
    run: (c) => (c.currentUser === APP_ROLE ? pass() : fail(`connected as "${c.currentUser}"`)),
  },
  {
    id: "role.owns-nothing", mode: "catalog", covers: "app role can't ALTER/DISABLE RLS or replace functions",
    title: "app role owns no table, function or the public schema",
    run: (c) => {
      const owned = [...c.tables.filter((t) => t.ownedByApp).map((t) => t.name), ...c.functions.filter((f) => f.ownedByApp).map((f) => `${f.name}()`)];
      if (c.schemaOwnedByApp) owned.push("schema public");
      return owned.length ? fail(`owns ${list(owned)}`) : pass();
    },
  },
  {
    id: "role.no-create", mode: "catalog", covers: "app role can't add objects next to the SECURITY DEFINER functions",
    title: "app role cannot CREATE in schema public or the database",
    run: (c) => (c.schemaCreate || c.databaseCreate
      ? fail([c.schemaCreate && "CREATE on schema public", c.databaseCreate && "CREATE on the database"].filter(Boolean).join(", "))
      : pass()),
  },
  {
    id: "grants.app-works", mode: "catalog", covers: "security SQL grants applied (the app itself keeps working)",
    title: "app role can SELECT, INSERT and UPDATE what the app needs",
    run: (c) => {
      const missing: string[] = [];
      for (const t of c.tables) {
        if (!t.priv.select) missing.push(`SELECT ${t.name}`);
        if (!t.priv.insert) missing.push(`INSERT ${t.name}`);
        if (t.name !== "case_events" && !t.priv.update) missing.push(`UPDATE ${t.name}`);
      }
      for (const t of DELETE_ALLOWED) if (c.tables.some((x) => x.name === t && !x.priv.delete)) missing.push(`DELETE ${t}`);
      if (!c.tables.length) return fail("no tables in schema public (migrations not applied?)");
      return missing.length ? fail(`missing ${list(missing)}`) : pass();
    },
  },
  {
    id: "grants.no-delete", mode: "catalog", covers: "no DELETE for the app (7-year retention, ACR s.19)",
    title: "app role has no DELETE, TRUNCATE or TRIGGER (DELETE only on rate_limits)",
    run: (c) => {
      const bad: string[] = [];
      for (const t of c.tables) {
        if (t.priv.delete && !DELETE_ALLOWED.includes(t.name)) bad.push(`DELETE ${t.name}`);
        if (t.priv.truncate) bad.push(`TRUNCATE ${t.name}`);
        if (t.priv.trigger) bad.push(`TRIGGER ${t.name}`);
      }
      return bad.length ? fail(`granted ${list(bad)}`) : pass();
    },
  },
  {
    id: "grants.no-update-events", mode: "catalog", covers: "no UPDATE on the event log for the app",
    title: "app role has no UPDATE or DELETE on case_events",
    run: (c) => {
      const t = c.tables.find((x) => x.name === "case_events");
      if (!t) return fail("case_events is missing");
      return t.priv.update || t.priv.delete ? fail([t.priv.update && "UPDATE", t.priv.delete && "DELETE"].filter(Boolean).join(" and ") + " granted") : pass();
    },
  },
  {
    id: "rls.forced", mode: "catalog", covers: "RLS forced on every tenant table (domain §9)",
    title: "row-level security enabled AND forced on every tenant table",
    run: (c) => {
      const missing = TENANT_TABLES.filter((n) => !c.tables.some((t) => t.name === n));
      const weak = tenantTables(c).filter((t) => !t.rls || !t.force).map((t) => `${t.name} (${!t.rls ? "off" : "not forced"})`);
      if (missing.length) return fail(`missing tables: ${list(missing)}`);
      return weak.length ? fail(list(weak)) : pass(`${tenantTables(c).length} tables`);
    },
  },
  {
    id: "rls.org-id", mode: "catalog", covers: "every tenant table has org_id uuid not null (domain §9)",
    title: "every tenant table has a NOT NULL org_id",
    run: (c) => {
      const bad = tenantTables(c).filter((t) => !t.hasOrgId || !t.orgIdNotNull).map((t) => t.name);
      return bad.length ? fail(list(bad)) : pass();
    },
  },
  {
    id: "rls.policies", mode: "catalog", covers: "tenant policies compare org_id with app.org_id; case_private lead-only",
    title: "every tenant policy is scoped to org_id = app_org() (case_private reads: lead only)",
    run: (c) => {
      const bad: string[] = [];
      for (const t of tenantTables(c)) {
        const ps = c.policies.filter((p) => p.table === t.name);
        if (!ps.length) bad.push(`${t.name}: no policy`);
        for (const p of ps) {
          for (const [label, expr] of [["USING", p.qual], ["WITH CHECK", p.withCheck]] as const) {
            // A conjunction that includes the org predicate; an OR could let other rows through.
            if (expr !== null && (!squash(expr).includes("org_id = app_org") || /\bOR\b/i.test(squash(expr)))) {
              bad.push(`${t.name}.${p.name} ${label}`);
            }
          }
          if (p.cmd === "INSERT" && p.withCheck === null) bad.push(`${t.name}.${p.name} has no WITH CHECK`);
          if (p.cmd !== "INSERT" && p.qual === null) bad.push(`${t.name}.${p.name} has no USING`);
          if (t.name === "case_private" && p.cmd !== "INSERT" && !squash(p.qual).includes("app_role = 'lead'")) {
            bad.push(`case_private.${p.name} is not lead-only`);
          }
        }
      }
      return bad.length ? fail(list(bad, 4)) : pass(`${c.policies.filter((p) => tenantTables(c).some((t) => t.name === p.table)).length} policies`);
    },
  },
  {
    id: "rls.forced-all", mode: "catalog", covers: "RLS forced on every table in public, orgs and rate_limits too (approved D7(b); db-smoke)",
    title: "row-level security enabled AND forced on every table in public (orgs and rate_limits too)",
    run: (c) => {
      const missing = Object.keys(GLOBAL_TABLE_APP_COMMANDS).filter((n) => !c.tables.some((t) => t.name === n));
      const weak = c.tables.filter((t) => !t.rls || !t.force).map((t) => `${t.name} (${!t.rls ? "off" : "not forced"})`);
      if (missing.length) return fail(`missing tables: ${list(missing)}`);
      return weak.length ? fail(list(weak)) : pass(`${c.tables.length} tables`);
    },
  },
  {
    id: "rls.global-policies", mode: "catalog",
    covers: "orgs/rate_limits policies name roles, never PUBLIC or anon/authenticated (D7(b); db-smoke: a grant but no policy reads nothing)",
    title: "tables without org_id have policies for named roles only, and the app role keeps what it uses",
    run: (c) => {
      const bad: string[] = [];
      const tenant = new Set(tenantTables(c).map((t) => t.name));
      let n = 0;
      for (const t of c.tables.filter((x) => !tenant.has(x.name))) {
        const ps = c.policies.filter((p) => p.table === t.name);
        n += ps.length;
        for (const p of ps) {
          // A PUBLIC policy would hand these rows to any role holding a grant (Supabase's anon, a stray grant).
          if (p.roles.includes("public")) bad.push(`${t.name}.${p.name} applies to PUBLIC`);
          for (const r of p.roles.filter((x) => API_ROLES.includes(x))) bad.push(`${t.name}.${p.name} applies to ${r}`);
        }
        for (const cmd of GLOBAL_TABLE_APP_COMMANDS[t.name] ?? []) {
          if (!ps.some((p) => p.roles.includes(APP_ROLE) && (p.cmd === cmd || p.cmd === "ALL"))) bad.push(`${t.name}: no ${cmd} policy for ${APP_ROLE}`);
        }
      }
      return bad.length ? fail(list(bad, 4)) : pass(`${n} policies`);
    },
  },
  {
    id: "trigger.append-only", mode: "catalog", covers: "append-only trigger on case_events, even for the owner (domain §8)",
    title: "case_events has an enabled BEFORE UPDATE OR DELETE row trigger",
    run: (c) => {
      const t = c.triggers.find((x) => x.table === "case_events" && x.func === "case_events_immutable"
        && (x.type & BEFORE_ROW_UPDATE_DELETE) === BEFORE_ROW_UPDATE_DELETE);
      if (!t) return fail("no BEFORE UPDATE OR DELETE FOR EACH ROW trigger calling case_events_immutable()");
      return t.enabled === "O" || t.enabled === "A" ? pass(t.name) : fail(`${t.name} is disabled (tgenabled ${t.enabled})`);
    },
  },
  {
    id: "trigger.sign-off-lock", mode: "catalog", covers: "sign-off lock on reports, even for the owner (approved D7(a), domain §8; db-smoke)",
    title: "reports has an enabled BEFORE UPDATE row trigger (the sign-off lock)",
    run: (c) => {
      const t = c.triggers.find((x) => x.table === SIGN_OFF_LOCK.table && x.func === SIGN_OFF_LOCK.func
        && (x.type & BEFORE_ROW_UPDATE) === BEFORE_ROW_UPDATE);
      if (!t) return fail(`no BEFORE UPDATE FOR EACH ROW trigger on ${SIGN_OFF_LOCK.table} calling ${SIGN_OFF_LOCK.func}()`);
      return t.enabled === "O" || t.enabled === "A" ? pass(t.name) : fail(`${t.name} is disabled (tgenabled ${t.enabled})`);
    },
  },
  {
    id: "definer.catalog", mode: "catalog", covers: "resolve_receipt / resolve_published_report: SECURITY DEFINER, pinned search_path, app-only EXECUTE",
    title: "SECURITY DEFINER lookups pin search_path and only the app role may call them",
    run: (c) => {
      const bad: string[] = [];
      for (const name of DEFINER_FUNCTIONS) {
        const f = c.functions.find((x) => x.name === name);
        if (!f) { bad.push(`${name}() missing`); continue; }
        if (!f.secdef) bad.push(`${name}() is not SECURITY DEFINER`);
        if (!f.appExec) bad.push(`${name}() not executable by the app role`);
      }
      // Every definer function in public (including any added later) must pin search_path and not be PUBLIC.
      for (const f of c.functions.filter((x) => x.secdef)) {
        if (!f.config.some((s) => /^search_path=/.test(s))) bad.push(`${f.name}() has no SET search_path`);
        if (f.publicExec) bad.push(`${f.name}() is executable by PUBLIC`);
      }
      return bad.length ? fail(list(bad, 4)) : pass();
    },
  },
  {
    // Plain functions (app_org(), app_role()) run with the caller's rights and must stay callable for the policies;
    // only SECURITY DEFINER functions can read past row-level security, so only those count here.
    id: "api-roles.closed", mode: "catalog", covers: "Supabase anon/authenticated reach no table or definer function (approved D7(c), Data API)",
    title: "Data API roles (anon, authenticated) can't reach public tables or SECURITY DEFINER functions",
    run: (c) => {
      if (!c.apiRoles.length) return pass("roles not present on this database");
      const bad = c.apiRoles.filter((r) => r.tables > 0 || r.functions > 0).map((r) => `${r.name}: ${r.tables} tables, ${r.functions} definer functions`);
      return bad.length ? fail(list(bad)) : pass(c.apiRoles.map((r) => r.name).join(", "));
    },
  },

  // ---- behaviour, as the app role, in READ ONLY transactions
  {
    id: "rls.fails-closed", mode: "read-only", covers: "no org context -> 0 rows (db-smoke: fails closed)",
    title: "without an org context every tenant table returns 0 rows",
    run: async (ctx) => {
      const counts = await ctx.readOnly((q) => countTables(q, tenantTables(ctx.catalog).map((t) => t.name)));
      const leaking = Object.entries(counts).filter(([, n]) => n > 0).map(([t]) => t);
      return leaking.length ? fail(`rows visible in ${list(leaking)}`) : pass(`${Object.keys(counts).length} tables`);
    },
  },
  {
    id: "rls.unknown-org", mode: "read-only", covers: "an org id with no rows -> 0 rows",
    title: "an unknown org context returns 0 rows from every tenant table",
    run: async (ctx) => {
      const counts = await ctx.readOnly((q) => countTables(q, tenantTables(ctx.catalog).map((t) => t.name)), { orgId: randomUUID(), role: "lead" });
      const leaking = Object.entries(counts).filter(([, n]) => n > 0).map(([t]) => t);
      return leaking.length ? fail(`rows visible in ${list(leaking)}`) : pass();
    },
  },
  {
    id: "rls.isolation", mode: "read-only", covers: "org A's context never shows org B's rows (db-smoke: other org -> 0 demo cases)",
    title: "each org's lead sees only rows with its own org_id",
    run: async (ctx) => {
      if (!ctx.data.orgIds.length) return skip("no orgs in the database");
      const tables = tenantTables(ctx.catalog).map((t) => t.name);
      const bad: string[] = [];
      let visible = 0;
      for (const orgId of ctx.data.orgIds) {
        const rows = await ctx.readOnly(async (q) => {
          const sel = tables.map((t, i) =>
            `(select count(*) from ${quoteIdent(t)}) as t${i}, (select count(*) from ${quoteIdent(t)} where org_id is distinct from app_org()) as x${i}`);
          return (await q(`select ${sel.join(", ")}`))[0];
        }, { orgId, role: "lead" });
        tables.forEach((t, i) => {
          visible += Number(rows[`t${i}`]);
          if (Number(rows[`x${i}`]) > 0) bad.push(t);
        });
      }
      if (bad.length) return fail(`another org's rows visible in ${list([...new Set(bad)])}`);
      return visible > 0 ? pass(`${ctx.data.orgIds.length} orgs`) : skip("no tenant rows to compare");
    },
  },
  {
    id: "rls.case-private", mode: "read-only", covers: "owner cannot read case_private; lead can (db-smoke)",
    title: "case_private is readable by the lead only",
    run: async (ctx) => {
      const orgId = ctx.data.sampleCase?.orgId;
      if (!orgId) return skip("no cases in the database");
      const bad: string[] = [];
      for (const role of NON_LEAD_ROLES) {
        const n = await ctx.readOnly(async (q) => Number((await q("select count(*) as n from case_private"))[0].n), { orgId, role });
        if (n > 0) bad.push(role || "(no role)");
      }
      if (bad.length) return fail(`readable as ${list(bad)}`);
      const lead = await ctx.readOnly(async (q) => Number((await q("select count(*) as n from case_private"))[0].n), { orgId, role: "lead" });
      return lead > 0 ? pass() : fail("the lead cannot read case_private for an org that has cases");
    },
  },
  {
    id: "orgs.public-lookup", mode: "read-only", covers: "public routes resolve the org by slug without an org context (domain §9)",
    title: "orgs can be looked up without an org context (public pages)",
    run: async (ctx) => (ctx.data.orgIds.length ? pass() : fail("no orgs visible to the app role (empty database or hidden by RLS)")),
  },
  {
    id: "definer.receipt-unknown", mode: "read-only", covers: "resolve_receipt answers nothing for an unknown code",
    title: "resolve_receipt returns no row for an unknown code hash",
    run: async (ctx) => {
      const rows = await ctx.readOnly((q) => q("select * from resolve_receipt($1)", [randomBytes(32).toString("hex")]));
      return rows.length === 0 ? pass() : fail(`${rows.length} rows`);
    },
  },
  {
    id: "definer.receipt-resolves", mode: "read-only", covers: "resolve_receipt works for app role without org context (db-smoke)",
    title: "resolve_receipt finds a real case without an org context",
    run: async (ctx) => {
      const s = ctx.data.sampleCase;
      if (!s) return skip("no cases in the database");
      const rows = await ctx.readOnly((q) => q("select org_id::text as org_id, case_id::text as case_id from resolve_receipt($1)", [s.codeHash]));
      if (rows.length === 1 && rows[0].org_id === s.orgId && rows[0].case_id === s.caseId) return pass();
      const owner = ctx.catalog.functions.find((f) => f.name === "resolve_receipt");
      const hint = owner && !owner.ownerBypass ? `; its owner role "${owner.ownerName}" has no BYPASSRLS: add explicit policies` : "";
      return fail(`${rows.length === 1 ? "wrong case" : `${rows.length} rows`}${hint}`);
    },
  },
  {
    id: "definer.published-unknown", mode: "read-only", covers: "resolve_published_report answers null for an unknown id",
    title: "resolve_published_report returns null for an unknown report id",
    run: async (ctx) => {
      const rows = await ctx.readOnly((q) => q("select resolve_published_report($1::uuid)::text as org_id", [randomUUID()]));
      return rows[0]?.org_id == null ? pass() : fail("returned an org");
    },
  },
  {
    id: "definer.published-hides-drafts", mode: "read-only", covers: "resolve_published_report hides drafts (db-smoke)",
    title: "resolve_published_report returns null for unpublished reports",
    run: async (ctx) => {
      const drafts = ctx.data.draftReports.slice(0, 5);
      if (!drafts.length) return skip("no unpublished report in the database");
      for (const d of drafts) {
        const rows = await ctx.readOnly((q) => q("select resolve_published_report($1::uuid)::text as org_id", [d.id]));
        if (rows[0]?.org_id != null) return fail("an unpublished report was resolved");
      }
      return pass(`${drafts.length} checked`);
    },
  },
  {
    id: "definer.published-finds", mode: "read-only", covers: "resolve_published_report finds a published report's org (db-smoke)",
    title: "resolve_published_report finds the org of a published report",
    run: async (ctx) => {
      const pub = ctx.data.publishedReports.slice(0, 5);
      if (!pub.length) return skip("no published report in the database");
      for (const p of pub) {
        const rows = await ctx.readOnly((q) => q("select resolve_published_report($1::uuid)::text as org_id", [p.id]));
        if (rows[0]?.org_id !== p.orgId) {
          const f = ctx.catalog.functions.find((x) => x.name === "resolve_published_report");
          const hint = f && !f.ownerBypass ? `; its owner role "${f.ownerName}" has no BYPASSRLS: add explicit policies` : "";
          return fail(`a published report was not resolved to its org${hint}`);
        }
      }
      return pass(`${pub.length} checked`);
    },
  },

  // ---- refusals: attempted, refused, always rolled back
  {
    id: "write.update-events", mode: "refusal", covers: "app role cannot UPDATE case_events (db-smoke)",
    title: "UPDATE on case_events is refused (permission denied)",
    run: async (ctx) => expectRefusal(await ctx.attempt((q) => q("update case_events set payload = payload where false"), { org: leadCtx(ctx) }), "42501"),
  },
  {
    id: "write.delete-events", mode: "refusal", covers: "app role cannot DELETE case_events",
    title: "DELETE on case_events is refused (permission denied)",
    run: async (ctx) => expectRefusal(await ctx.attempt((q) => q("delete from case_events where false"), { org: leadCtx(ctx) }), "42501"),
  },
  {
    id: "write.delete-cases", mode: "refusal", covers: "app role cannot DELETE (7-year retention) (db-smoke)",
    title: "DELETE on cases is refused (permission denied)",
    run: async (ctx) => expectRefusal(await ctx.attempt((q) => q("delete from cases where false"), { org: leadCtx(ctx) }), "42501"),
  },
  {
    id: "write.cross-org-insert", mode: "refusal", covers: "cross-org INSERT blocked by RLS (db-smoke)",
    title: "inserting another org's row is refused by row-level security",
    run: async (ctx) => {
      const org = leadCtx(ctx);
      const other = ctx.data.orgIds.find((id) => id !== org.orgId) ?? randomUUID();
      return expectRefusal(await ctx.attempt((q) => q(
        "insert into org_members (org_id, clerk_user_id, display_name, role) values ($1, $2, 'remote smoke', 'auditor')",
        [other, `remote_smoke_${randomBytes(6).toString("hex")}`]), { org }), "42501", /row-level security/);
    },
  },
  {
    id: "write.no-context-insert", mode: "refusal", covers: "an INSERT without an org context fails closed",
    title: "inserting without an org context is refused by row-level security",
    run: async (ctx) => {
      const orgId = ctx.data.orgIds[0] ?? randomUUID();
      return expectRefusal(await ctx.attempt((q) => q(
        "insert into org_members (org_id, clerk_user_id, display_name, role) values ($1, $2, 'remote smoke', 'auditor')",
        [orgId, `remote_smoke_${randomBytes(6).toString("hex")}`])), "42501", /row-level security/);
    },
  },
  {
    // The one write attempted on an existing row: a no-op UPDATE (title = title) that the trigger must refuse. Even
    // if it weren't refused, the value would stay the same, and the transaction is rolled back either way.
    id: "write.signed-off-report", mode: "refusal", covers: "a signed-off report can't be edited, by the app role either (D7(a); db-smoke)",
    title: "UPDATE of a signed-off report is refused by the sign-off lock",
    run: async (ctx) => {
      const r = ctx.data.signedOffReports[0];
      if (!r) return skip("no signed-off report in the database");
      return expectRefusal(await ctx.attempt((q) => q("update reports set title = title where id = $1", [r.id]), { org: { orgId: r.orgId, role: "lead" } }),
        "P0001", /signed off and locked/);
    },
  },
  {
    id: "role.no-set-owner", mode: "refusal", covers: "the app role can't become the table owner (who has the trigger-only guard)",
    title: "SET ROLE to the table owner is refused",
    run: async (ctx) => {
      const owner = ctx.data.tableOwner;
      if (!owner) return skip("cases table not found");
      if (owner === ctx.catalog.currentUser) return fail("the app role owns the tables");
      return expectRefusal(await ctx.attempt((q) => q(`set local role ${quoteIdent(owner)}`), { readOnly: true }), "42501");
    },
  },
];

function leadCtx(ctx: ReadCtx): OrgCtx {
  return { orgId: ctx.data.sampleCase?.orgId ?? ctx.data.orgIds[0] ?? randomUUID(), role: "lead" };
}

export function expectRefusal(r: Refusal, code: string, message?: RegExp): Outcome {
  if (!r.refused) return fail("the statement was NOT refused (rolled back)");
  if (r.code !== code || (message && !message.test(r.message ?? ""))) {
    return fail(`refused for another reason: ${r.code ?? "?"} ${sanitize(r.message ?? "")}`);
  }
  return pass(r.code);
}

async function countTables(q: Q, tables: string[]): Promise<Record<string, number>> {
  if (!tables.length) return {};
  const row = (await q(`select ${tables.map((t, i) => `(select count(*) from ${quoteIdent(t)}) as t${i}`).join(", ")}`))[0];
  return Object.fromEntries(tables.map((t, i) => [t, Number(row[`t${i}`])]));
}

// ---------------------------------------------------------------- role refusal, output

export interface RoleFacts {
  currentUser: string;
  sessionUser: string;
  currentSuper: boolean;
  currentBypass: boolean;
  sessionSuper: boolean;
  sessionBypass: boolean;
  /** Superuser or BYPASSRLS roles the current role is a member of (could SET ROLE to). */
  privilegedMemberships: string[];
}

/** Why this connection must not run the smoke test, or null when it may. */
export function roleRefusal(f: RoleFacts): string | null {
  if (f.currentSuper || f.sessionSuper) {
    return `"${f.currentSuper ? f.currentUser : f.sessionUser}" is a SUPERUSER: row-level security does not apply to it. Connect as ${APP_ROLE}.`;
  }
  if (f.currentBypass || f.sessionBypass) {
    return `"${f.currentBypass ? f.currentUser : f.sessionUser}" has BYPASSRLS: row-level security does not apply to it. Connect as ${APP_ROLE}.`;
  }
  if (f.privilegedMemberships.length) {
    return `"${f.currentUser}" is a member of ${f.privilegedMemberships.map((r) => `"${r}"`).join(", ")} (SUPERUSER or BYPASSRLS), so it can leave row-level security with SET ROLE. Revoke that membership.`;
  }
  return null;
}

/** Remove anything that could be a value, URL, address or secret from a message before printing it. */
export function sanitize(message: string): string {
  return message
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/[^\s@"']+@[^\s@"']+/g, "[address]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/\b[0-9a-f]{16,}\b/gi, "[hex]")
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, "[ip]")
    .replace(/\bKey \(.*$/s, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function formatLine(r: Result): string {
  return `${r.status.padEnd(4)}  ${r.title}${r.note ? ` (${sanitize(r.note)})` : ""}`;
}

export function summaryLine(results: Result[]): string {
  const n = (s: Status) => results.filter((r) => r.status === s).length;
  return `${n("PASS")} PASS, ${n("FAIL")} FAIL, ${n("SKIP")} SKIP (${results.length} checks)`;
}

export function exitCode(results: Result[], strict = false): number {
  return results.some((r) => r.status === "FAIL" || (strict && r.status === "SKIP")) ? 1 : 0;
}

// ---------------------------------------------------------------- database plumbing

class Rollback { constructor(readonly value: unknown) {} }

async function tx<T>(sql: postgres.Sql, readOnly: boolean, org: OrgCtx | undefined, fn: (q: Q) => Promise<T>): Promise<T> {
  try {
    await sql.begin(readOnly ? "read only" : "read write", async (t) => {
      await t.unsafe("set local statement_timeout = '15s'");
      await t.unsafe("set local lock_timeout = '2s'");
      if (org) await t.unsafe("select set_config('app.org_id', $1, true), set_config('app.role', $2, true)", [org.orgId, org.role]);
      const q: Q = (text, params) => t.unsafe(text, (params ?? []) as postgres.ParameterOrJSON<never>[]) as unknown as Promise<Row[]>;
      throw new Rollback(await fn(q)); // never commit
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error("transaction was not rolled back");
}

export async function readRoleFacts(sql: postgres.Sql): Promise<RoleFacts> {
  return tx(sql, true, undefined, async (q) => {
    const [r] = await q(`select current_user::text as cu, session_user::text as su,
      coalesce((select rolsuper from pg_roles where rolname = current_user), false) as cs,
      coalesce((select rolbypassrls from pg_roles where rolname = current_user), false) as cb,
      coalesce((select rolsuper from pg_roles where rolname = session_user), false) as ss,
      coalesce((select rolbypassrls from pg_roles where rolname = session_user), false) as sb,
      coalesce((select array_agg(r.rolname::text order by r.rolname) from pg_roles r
        where r.rolname <> current_user and (r.rolsuper or r.rolbypassrls) and pg_has_role(current_user, r.oid, 'MEMBER')), '{}') as pm`);
    return {
      currentUser: String(r.cu), sessionUser: String(r.su),
      currentSuper: r.cs === true, currentBypass: r.cb === true, sessionSuper: r.ss === true, sessionBypass: r.sb === true,
      privilegedMemberships: (r.pm as string[]) ?? [],
    };
  });
}

export async function readCatalog(sql: postgres.Sql): Promise<Catalog> {
  return tx(sql, true, undefined, async (q) => {
    const [me] = await q(`select current_user::text as cu,
      has_schema_privilege(current_user, 'public', 'CREATE') as sc,
      has_database_privilege(current_user, current_database(), 'CREATE') as dc,
      (select nspowner = (select oid from pg_roles where rolname = current_user) from pg_namespace where nspname = 'public') as so`);
    const tables = await q(`select c.relname::text as name, c.relrowsecurity as rls, c.relforcerowsecurity as force,
        c.relowner = (select oid from pg_roles where rolname = current_user) as owned,
        a.attname is not null as has_org, coalesce(a.attnotnull, false) as org_nn,
        has_table_privilege(current_user, c.oid, 'SELECT') as s, has_table_privilege(current_user, c.oid, 'INSERT') as i,
        has_table_privilege(current_user, c.oid, 'UPDATE') as u, has_table_privilege(current_user, c.oid, 'DELETE') as d,
        has_table_privilege(current_user, c.oid, 'TRUNCATE') as t, has_table_privilege(current_user, c.oid, 'TRIGGER') as g
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`);
    const policies = await q(`select tablename::text as t, policyname::text as name, cmd::text as cmd,
        array_to_string(roles, ',') as roles, qual, with_check as wc
      from pg_policies where schemaname = 'public' order by tablename, policyname`);
    const triggers = await q(`select c.relname::text as t, tg.tgname::text as name, tg.tgenabled::text as en, tg.tgtype::int as ty,
        p.proname::text as fn
      from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = tg.tgfoid
      where n.nspname = 'public' and not tg.tgisinternal`);
    const functions = await q(`select p.proname::text as name, p.prosecdef as sd, coalesce(p.proconfig, '{}') as cfg,
        p.proowner = (select oid from pg_roles where rolname = current_user) as owned,
        has_function_privilege(current_user, p.oid, 'EXECUTE') as ax,
        exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                where x.grantee = 0 and x.privilege_type = 'EXECUTE') as px,
        o.rolname::text as owner, (o.rolsuper or o.rolbypassrls) as ob
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles o on o.oid = p.proowner
      where n.nspname = 'public' order by p.proname`);
    const apiRoles = await q(`select r.rolname::text as name,
        (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
          and (has_table_privilege(r.oid, c.oid, 'SELECT') or has_table_privilege(r.oid, c.oid, 'INSERT')
            or has_table_privilege(r.oid, c.oid, 'UPDATE') or has_table_privilege(r.oid, c.oid, 'DELETE')))::int as tables,
        (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef and has_function_privilege(r.oid, p.oid, 'EXECUTE'))::int as functions
      from pg_roles r where r.rolname in (${API_ROLES.map((r) => `'${r}'`).join(", ")}) order by r.rolname`);
    return {
      currentUser: String(me.cu), schemaCreate: me.sc === true, databaseCreate: me.dc === true, schemaOwnedByApp: me.so === true,
      tables: tables.map((t) => ({
        name: String(t.name), rls: t.rls === true, force: t.force === true, ownedByApp: t.owned === true,
        hasOrgId: t.has_org === true, orgIdNotNull: t.org_nn === true,
        priv: { select: t.s === true, insert: t.i === true, update: t.u === true, delete: t.d === true, truncate: t.t === true, trigger: t.g === true },
      })),
      policies: policies.map((p) => ({
        table: String(p.t), name: String(p.name), cmd: String(p.cmd), roles: String(p.roles ?? "").split(",").filter(Boolean),
        qual: (p.qual as string) ?? null, withCheck: (p.wc as string) ?? null,
      })),
      triggers: triggers.map((t) => ({ table: String(t.t), name: String(t.name), enabled: String(t.en), type: Number(t.ty), func: String(t.fn) })),
      functions: functions.map((f) => ({
        name: String(f.name), secdef: f.sd === true, config: (f.cfg as string[]) ?? [], ownedByApp: f.owned === true,
        appExec: f.ax === true, publicExec: f.px === true, ownerName: String(f.owner), ownerBypass: f.ob === true,
      })),
      apiRoles: apiRoles.map((r) => ({ name: String(r.name), tables: Number(r.tables), functions: Number(r.functions) })),
    };
  });
}

async function discover(sql: postgres.Sql): Promise<Discovery> {
  const orgIds = await tx(sql, true, undefined, async (q) =>
    (await q(`select id::text as id from orgs order by created_at, id limit ${MAX_ORGS}`)).map((r) => String(r.id)));
  const data: Discovery = { orgIds, sampleCase: null, draftReports: [], publishedReports: [], signedOffReports: [], tableOwner: null };
  for (const orgId of orgIds) {
    await tx(sql, true, { orgId, role: "lead" }, async (q) => {
      if (!data.sampleCase) {
        const [c] = await q("select id::text as id, receipt_code_hash as h from cases order by received_at limit 1");
        if (c) data.sampleCase = { orgId, caseId: String(c.id), codeHash: String(c.h) };
      }
      for (const r of await q(`select id::text as id, (status = 'signed_off' and published_at is not null) as pub,
          (status = 'signed_off') as so from reports order by created_at desc limit 10`)) {
        (r.pub === true ? data.publishedReports : data.draftReports).push({ orgId, id: String(r.id) });
        if (r.so === true) data.signedOffReports.push({ orgId, id: String(r.id) });
      }
    });
  }
  data.tableOwner = await tx(sql, true, undefined, async (q) =>
    ((await q("select pg_get_userbyid(relowner)::text as o from pg_class where oid = to_regclass('public.cases')"))[0]?.o as string) ?? null);
  return data;
}

function pgError(e: unknown): { code?: string; message: string } {
  const err = e as { code?: unknown; message?: unknown };
  return { code: typeof err?.code === "string" ? err.code : undefined, message: typeof err?.message === "string" ? err.message : String(e) };
}

/** Run every check against an open connection. Exported for the PGlite integration test (tests/remote-smoke.test.ts). */
export async function runChecks(sql: postgres.Sql, checks: Check[] = CHECKS, onResult: (r: Result) => void = () => {}): Promise<Result[]> {
  const catalog = await readCatalog(sql);
  // A role that can't read the tables (wrong role, grants not applied) still gets every catalog check, which say
  // what is wrong; the checks that need data then FAIL with the reason instead of stopping the whole run.
  let data: Discovery;
  let unreadable: string | null = null;
  try {
    data = await discover(sql);
  } catch (e) {
    const { code, message } = pgError(e);
    unreadable = `could not read the data as this role: ${code ?? "error"} ${sanitize(message)}`;
    data = { orgIds: [], sampleCase: null, draftReports: [], publishedReports: [], signedOffReports: [], tableOwner: null };
  }
  const readOnly: ReadCtx["readOnly"] = (fn, org) => tx(sql, true, org, fn);
  const ctx: RefusalCtx = {
    catalog, data, readOnly,
    attempt: async (fn, opts) => {
      try {
        await tx(sql, opts?.readOnly === true, opts?.org, fn);
        return { refused: false };
      } catch (e) {
        const { code, message } = pgError(e);
        return { refused: true, code, message };
      }
    },
  };
  const results: Result[] = [];
  for (const c of checks) {
    let o: Outcome;
    if (unreadable && c.mode !== "catalog") {
      o = fail(unreadable);
    } else {
      try {
        o = c.mode === "catalog" ? c.run(catalog)
          : c.mode === "read-only" ? await c.run({ catalog, data, readOnly })
          : await c.run(ctx);
      } catch (e) {
        const { code, message } = pgError(e);
        o = fail(`error ${code ?? ""} ${sanitize(message)}`.trim());
      }
    }
    const r: Result = { id: c.id, title: c.title, ...o };
    results.push(r);
    onResult(r);
  }
  return results;
}

export async function main(argv = process.argv.slice(2), log: (s: string) => void = console.log): Promise<number> {
  const strict = argv.includes("--strict");
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("db:remote-smoke: DATABASE_URL is not set (the app role's connection string).");
    return 2;
  }
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {}, connect_timeout: 15, idle_timeout: 5, connection: { application_name: "accessloop-remote-smoke" } });
  try {
    let facts: RoleFacts;
    try {
      facts = await readRoleFacts(sql);
    } catch (e) {
      log(`db:remote-smoke: could not connect or read the role (${pgError(e).code ?? "error"}).`);
      return 2;
    }
    const refusal = roleRefusal(facts);
    if (refusal) {
      log(`REFUSED: ${refusal}`);
      return 2;
    }
    log(`AccessLoop remote smoke: read-only checks as "${facts.currentUser}" (every transaction is rolled back)`);
    const results = await runChecks(sql, CHECKS, (r) => log(formatLine(r)));
    log(summaryLine(results));
    const code = exitCode(results, strict);
    log(code === 0 ? "db:remote-smoke: all checks passed" : "db:remote-smoke: FAILED");
    return code;
  } catch (e) {
    log(`db:remote-smoke: stopped by an error (${pgError(e).code ?? "error"}: ${sanitize(pgError(e).message)})`);
    return 1;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

if (process.argv[1] && /remote-smoke\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().then((code) => process.exit(code)).catch(() => process.exit(1));
}
