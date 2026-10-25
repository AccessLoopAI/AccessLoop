// scripts/remote-smoke.ts: the pure parts (check list, catalog rules, role refusal, output) with fixtures, then
// every check against a seeded in-memory Postgres (PGlite, seeded exactly like db:smoke) as accessloop_app,
// including proof that a run writes nothing and that a weakened database turns the right checks red.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  API_ROLES,
  APP_ROLE,
  BEFORE_ROW_UPDATE,
  BEFORE_ROW_UPDATE_DELETE,
  CHECKS,
  TENANT_TABLES,
  exitCode,
  expectRefusal,
  formatLine,
  main,
  readRoleFacts,
  roleRefusal,
  runChecks,
  sanitize,
  summaryLine,
  type Catalog,
  type CatalogCheck,
  type Check,
  type Discovery,
  type Q,
  type RefusalCheck,
  type RefusalCtx,
  type Result,
  type RoleFacts,
  type TableInfo,
} from "../scripts/remote-smoke";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

// ---------------------------------------------------------------- fixtures

const table = (name: string, o: Partial<TableInfo> = {}, p: Partial<TableInfo["priv"]> = {}): TableInfo => ({
  name, rls: true, force: true, ownedByApp: false, hasOrgId: true, orgIdNotNull: true,
  priv: { select: true, insert: true, update: true, delete: false, truncate: false, trigger: false, ...p }, ...o,
});
const ORG = "(org_id = app_org())";
const LEAD = "((org_id = app_org()) AND (app_role() = 'lead'::text))";

function goodCatalog(): Catalog {
  return {
    currentUser: APP_ROLE, schemaCreate: false, databaseCreate: false, schemaOwnedByApp: false,
    tables: [
      ...TENANT_TABLES.map((t) => (t === "case_events" ? table(t, {}, { update: false }) : table(t))),
      // D7(b): RLS forced on the two tables without org_id too, with policies for the app role and the owner only.
      table("orgs", { hasOrgId: false, orgIdNotNull: false }),
      table("rate_limits", { hasOrgId: false, orgIdNotNull: false }, { delete: true }),
    ],
    policies: [
      ...TENANT_TABLES.filter((t) => t !== "case_private").map((t) => ({ table: t, name: "tenant_isolation", cmd: "ALL", roles: ["public"], qual: ORG, withCheck: ORG })),
      { table: "case_private", name: "private_insert", cmd: "INSERT", roles: ["public"], qual: null, withCheck: ORG },
      { table: "case_private", name: "private_lead_read", cmd: "SELECT", roles: ["public"], qual: LEAD, withCheck: null },
      { table: "case_private", name: "private_lead_update", cmd: "UPDATE", roles: ["public"], qual: LEAD, withCheck: ORG },
      { table: "orgs", name: "orgs_app_read", cmd: "SELECT", roles: [APP_ROLE], qual: "true", withCheck: null },
      { table: "orgs", name: "orgs_app_insert", cmd: "INSERT", roles: [APP_ROLE], qual: null, withCheck: "true" },
      { table: "orgs", name: "orgs_app_update", cmd: "UPDATE", roles: [APP_ROLE], qual: "true", withCheck: "true" },
      { table: "orgs", name: "orgs_owner", cmd: "ALL", roles: ["postgres"], qual: "true", withCheck: "true" },
      { table: "rate_limits", name: "rate_limits_app", cmd: "ALL", roles: [APP_ROLE], qual: "true", withCheck: "true" },
      { table: "rate_limits", name: "rate_limits_owner", cmd: "ALL", roles: ["postgres"], qual: "true", withCheck: "true" },
    ],
    triggers: [
      { table: "case_events", name: "case_events_no_update", enabled: "O", type: BEFORE_ROW_UPDATE_DELETE, func: "case_events_immutable" },
      { table: "reports", name: "reports_signed_off_lock", enabled: "O", type: BEFORE_ROW_UPDATE, func: "reports_signed_off_immutable" },
    ],
    functions: [
      ...["resolve_receipt", "resolve_published_report"].map((name) => ({
        name, secdef: true, config: ["search_path=public"], ownedByApp: false, appExec: true, publicExec: false, ownerName: "postgres", ownerBypass: true,
      })),
      { name: "app_org", secdef: false, config: [], ownedByApp: false, appExec: true, publicExec: true, ownerName: "postgres", ownerBypass: true },
    ],
    apiRoles: [],
  };
}

const catalogChecks = CHECKS.filter((c): c is CatalogCheck => c.mode === "catalog");
const byId = (id: string) => {
  const c = CHECKS.find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
};
const runCatalog = (id: string, c: Catalog) => (byId(id) as CatalogCheck).run(c);

const goodFacts: RoleFacts = {
  currentUser: APP_ROLE, sessionUser: APP_ROLE, currentSuper: false, currentBypass: false,
  sessionSuper: false, sessionBypass: false, privilegedMemberships: [],
};

// ---------------------------------------------------------------- the check list

describe("the check list", () => {
  it("has unique ids and titles, a known mode and what each one covers", () => {
    expect(new Set(CHECKS.map((c) => c.id)).size).toBe(CHECKS.length);
    expect(new Set(CHECKS.map((c) => c.title)).size).toBe(CHECKS.length);
    for (const c of CHECKS) {
      expect(["catalog", "read-only", "refusal"]).toContain(c.mode);
      expect(c.title.length).toBeGreaterThan(10);
      expect(c.covers.length).toBeGreaterThan(5);
    }
  });

  it("covers every RLS, guard and definer property of scripts/db-smoke.ts that can be checked without writing", () => {
    // db-smoke line -> the remote check that covers it
    const covered: Record<string, string> = {
      "no org context -> 0 cases (fails closed)": "rls.fails-closed",
      "demo org context -> 16 cases / other org context -> 0 demo cases": "rls.isolation",
      "owner cannot read case_private / lead can read case_private": "rls.case-private",
      "app role cannot UPDATE case_events": "write.update-events",
      "app role cannot DELETE (7-year retention)": "write.delete-cases",
      "cross-org INSERT blocked by RLS": "write.cross-org-insert",
      "UPDATE/DELETE case_events blocked (trigger, even for the owner)": "trigger.append-only",
      "resolve_receipt works for app role without org context": "definer.receipt-resolves",
      "resolve_published_report hides drafts": "definer.published-hides-drafts",
      "resolve_published_report finds published report's org": "definer.published-finds",
      "security SQL applied": "rls.forced",
      // Phase 7 T3 (D7(b), D7(c)) and T5 (D7(a)), merged into db-smoke before T9:
      "orgs and rate_limits: RLS enabled and forced": "rls.forced-all",
      "every table in public has forced RLS": "rls.forced-all",
      "a role with a grant but no policy reads no orgs or rate_limits": "rls.global-policies",
      "app role reads orgs by slug without an org context": "orgs.public-lookup",
      "Supabase roles (anon, authenticated): no table, sequence or lookup privileges left": "api-roles.closed",
      "signed-off report: UPDATE blocked (owner)": "trigger.sign-off-lock",
      "signed-off report: UPDATE blocked (app role)": "write.signed-off-report",
    };
    for (const id of Object.values(covered)) expect(CHECKS.map((c) => c.id)).toContain(id);
  });

  it("every catalog check passes on a correctly secured catalog", () => {
    for (const c of catalogChecks) expect(c.run(goodCatalog()), c.id).toMatchObject({ status: "PASS" });
  });
});

// ---------------------------------------------------------------- catalog rules

describe("catalog rules turn red on a weakened database", () => {
  const mutate = (fn: (c: Catalog) => void) => { const c = goodCatalog(); fn(c); return c; };
  const t = (c: Catalog, name: string) => c.tables.find((x) => x.name === name)!;

  it("connected as another role", () => {
    expect(runCatalog("role.app", mutate((c) => { c.currentUser = "postgres"; }))).toMatchObject({ status: "FAIL" });
  });
  it("the app role owns a table, a function or the schema", () => {
    expect(runCatalog("role.owns-nothing", mutate((c) => { t(c, "cases").ownedByApp = true; })).note).toMatch(/cases/);
    expect(runCatalog("role.owns-nothing", mutate((c) => { c.functions[0].ownedByApp = true; })).status).toBe("FAIL");
    expect(runCatalog("role.owns-nothing", mutate((c) => { c.schemaOwnedByApp = true; })).status).toBe("FAIL");
  });
  it("the app role may CREATE", () => {
    expect(runCatalog("role.no-create", mutate((c) => { c.schemaCreate = true; })).status).toBe("FAIL");
    expect(runCatalog("role.no-create", mutate((c) => { c.databaseCreate = true; })).status).toBe("FAIL");
  });
  it("a grant the app needs is missing", () => {
    expect(runCatalog("grants.app-works", mutate((c) => { t(c, "cases").priv.update = false; })).note).toMatch(/UPDATE cases/);
    expect(runCatalog("grants.app-works", mutate((c) => { t(c, "rate_limits").priv.delete = false; })).note).toMatch(/DELETE rate_limits/);
    expect(runCatalog("grants.app-works", mutate((c) => { c.tables = []; })).status).toBe("FAIL");
  });
  it("DELETE, TRUNCATE or TRIGGER is granted", () => {
    expect(runCatalog("grants.no-delete", mutate((c) => { t(c, "cases").priv.delete = true; })).note).toMatch(/DELETE cases/);
    expect(runCatalog("grants.no-delete", mutate((c) => { t(c, "rate_limits").priv.truncate = true; })).status).toBe("FAIL");
    expect(runCatalog("grants.no-delete", mutate((c) => { t(c, "reports").priv.trigger = true; })).status).toBe("FAIL");
  });
  it("UPDATE on case_events is granted", () => {
    expect(runCatalog("grants.no-update-events", mutate((c) => { t(c, "case_events").priv.update = true; })).status).toBe("FAIL");
  });
  it("RLS is off or not forced on a tenant table, including a new table with org_id", () => {
    expect(runCatalog("rls.forced", mutate((c) => { t(c, "cases").force = false; })).note).toMatch(/cases \(not forced\)/);
    expect(runCatalog("rls.forced", mutate((c) => { t(c, "reports").rls = false; })).note).toMatch(/reports \(off\)/);
    expect(runCatalog("rls.forced", mutate((c) => { c.tables.push(table("org_locations", { rls: false, force: false })); })).note).toMatch(/org_locations/);
    expect(runCatalog("rls.forced", mutate((c) => { c.tables = c.tables.filter((x) => x.name !== "attachments"); })).note).toMatch(/missing tables: attachments/);
  });
  it("RLS is off or not forced on any table in public, orgs and rate_limits included (D7(b))", () => {
    expect(runCatalog("rls.forced-all", goodCatalog()).note).toBe(`${goodCatalog().tables.length} tables`);
    expect(runCatalog("rls.forced-all", mutate((c) => { t(c, "orgs").force = false; })).note).toMatch(/orgs \(not forced\)/);
    expect(runCatalog("rls.forced-all", mutate((c) => { t(c, "rate_limits").rls = false; })).note).toMatch(/rate_limits \(off\)/);
    expect(runCatalog("rls.forced-all", mutate((c) => { t(c, "cases").force = false; })).note).toMatch(/cases \(not forced\)/);
    expect(runCatalog("rls.forced-all", mutate((c) => { c.tables.push(table("later_table", { rls: false, force: false, hasOrgId: false })); })).note).toMatch(/later_table/);
    expect(runCatalog("rls.forced-all", mutate((c) => { c.tables = c.tables.filter((x) => x.name !== "orgs"); })).note).toMatch(/missing tables: orgs/);
  });
  it("a policy on orgs or rate_limits applies to PUBLIC or a Data API role, or the app role lost one it needs", () => {
    const pol = (c: Catalog, table: string, name: string) => c.policies.find((p) => p.table === table && p.name === name)!;
    expect(runCatalog("rls.global-policies", mutate((c) => { pol(c, "orgs", "orgs_app_read").roles = ["public"]; })).note)
      .toMatch(/orgs\.orgs_app_read applies to PUBLIC/);
    expect(runCatalog("rls.global-policies", mutate((c) => { c.policies.push({ table: "rate_limits", name: "open", cmd: "ALL", roles: ["public"], qual: "true", withCheck: "true" }); })).note)
      .toMatch(/rate_limits\.open applies to PUBLIC/);
    expect(runCatalog("rls.global-policies", mutate((c) => { pol(c, "orgs", "orgs_owner").roles = ["postgres", "anon"]; })).note).toMatch(/applies to anon/);
    expect(runCatalog("rls.global-policies", mutate((c) => { c.policies = c.policies.filter((p) => p.name !== "orgs_app_read"); })).note)
      .toMatch(new RegExp(`orgs: no SELECT policy for ${APP_ROLE}`));
    expect(runCatalog("rls.global-policies", mutate((c) => { pol(c, "rate_limits", "rate_limits_app").cmd = "SELECT"; })).note)
      .toMatch(/rate_limits: no INSERT policy/);
    // Tenant tables' PUBLIC policies are scoped by org_id (rls.policies), so they don't count here.
    expect(runCatalog("rls.global-policies", goodCatalog())).toMatchObject({ status: "PASS", note: "6 policies" });
  });
  it("the sign-off lock is missing, disabled or not BEFORE UPDATE (D7(a))", () => {
    const lock = (c: Catalog) => c.triggers.find((x) => x.table === "reports")!;
    expect(runCatalog("trigger.sign-off-lock", goodCatalog())).toMatchObject({ status: "PASS", note: "reports_signed_off_lock" });
    expect(runCatalog("trigger.sign-off-lock", mutate((c) => { lock(c).enabled = "D"; })).note).toMatch(/disabled/);
    expect(runCatalog("trigger.sign-off-lock", mutate((c) => { lock(c).type = 1 | 16; })).status).toBe("FAIL"); // AFTER, too late
    expect(runCatalog("trigger.sign-off-lock", mutate((c) => { lock(c).func = "something_else"; })).status).toBe("FAIL");
    expect(runCatalog("trigger.sign-off-lock", mutate((c) => { c.triggers = c.triggers.filter((x) => x.table !== "reports"); })).status).toBe("FAIL");
  });
  it("a tenant table's org_id is nullable", () => {
    expect(runCatalog("rls.org-id", mutate((c) => { t(c, "attachments").orgIdNotNull = false; })).note).toBe("attachments");
  });
  it("a policy is not scoped to the org, has an OR, or case_private is readable by everyone", () => {
    const pol = (c: Catalog, table: string, name: string) => c.policies.find((p) => p.table === table && p.name === name)!;
    expect(runCatalog("rls.policies", mutate((c) => { c.policies.push({ table: "cases", name: "open", cmd: "SELECT", roles: ["public"], qual: "true", withCheck: null }); })).note).toMatch(/cases\.open USING/);
    expect(runCatalog("rls.policies", mutate((c) => { pol(c, "reports", "tenant_isolation").qual = "((org_id = app_org()) OR true)"; })).status).toBe("FAIL");
    expect(runCatalog("rls.policies", mutate((c) => { pol(c, "case_private", "private_lead_read").qual = ORG; })).note).toMatch(/not lead-only/);
    expect(runCatalog("rls.policies", mutate((c) => { c.policies = c.policies.filter((p) => p.table !== "outbound_messages"); })).note).toMatch(/outbound_messages: no policy/);
  });
  it("the append-only trigger is missing, disabled or not BEFORE UPDATE OR DELETE", () => {
    expect(runCatalog("trigger.append-only", mutate((c) => { c.triggers[0].enabled = "D"; })).note).toMatch(/disabled/);
    expect(runCatalog("trigger.append-only", mutate((c) => { c.triggers[0].type = 1 | 2 | 16; })).status).toBe("FAIL");
    expect(runCatalog("trigger.append-only", mutate((c) => { c.triggers = []; })).status).toBe("FAIL");
  });
  it("a SECURITY DEFINER function is missing, not definer, unpinned, or callable by PUBLIC", () => {
    expect(runCatalog("definer.catalog", mutate((c) => { c.functions.shift(); })).note).toMatch(/resolve_receipt\(\) missing/);
    expect(runCatalog("definer.catalog", mutate((c) => { c.functions[0].config = []; })).note).toMatch(/no SET search_path/);
    expect(runCatalog("definer.catalog", mutate((c) => { c.functions[1].publicExec = true; })).note).toMatch(/PUBLIC/);
    expect(runCatalog("definer.catalog", mutate((c) => { c.functions[0].appExec = false; })).status).toBe("FAIL");
    expect(runCatalog("definer.catalog", mutate((c) => { c.functions.push({ ...c.functions[2], name: "later_fn", secdef: true }); })).note).toMatch(/later_fn/);
  });
  it("Supabase's Data API roles reach a table or function (and pass where they don't exist)", () => {
    expect(runCatalog("api-roles.closed", goodCatalog()).note).toMatch(/not present/);
    expect(runCatalog("api-roles.closed", mutate((c) => { c.apiRoles = API_ROLES.map((name) => ({ name, tables: 0, functions: 0 })); })).status).toBe("PASS");
    expect(runCatalog("api-roles.closed", mutate((c) => { c.apiRoles = [{ name: "anon", tables: 9, functions: 0 }]; })).note).toMatch(/anon: 9 tables/);
  });
});

// ---------------------------------------------------------------- refusal checks (fake connection)

describe("refusal checks", () => {
  const refusals = CHECKS.filter((c): c is RefusalCheck => c.mode === "refusal");
  const data: Discovery = {
    orgIds: ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"],
    sampleCase: null, draftReports: [], publishedReports: [], tableOwner: "postgres",
    signedOffReports: [{ orgId: "00000000-0000-4000-8000-000000000001", id: "00000000-0000-4000-8000-0000000000aa" }],
  };
  // What each refusal check expects the database to answer (the sign-off lock raises; the rest are privileges/RLS).
  const expectedCode = (id: string) => (id === "write.signed-off-report" ? "P0001" : "42501");
  function fakeCtx(answer: (text: string) => Error | null) {
    const seen: { text: string; readOnly: boolean }[] = [];
    const ctx: RefusalCtx = {
      catalog: goodCatalog(), data,
      readOnly: () => { throw new Error("refusal checks must not use readOnly"); },
      attempt: async (fn, opts) => {
        const q: Q = async (text) => {
          seen.push({ text: text.replace(/\s+/g, " ").trim(), readOnly: opts?.readOnly === true });
          const e = answer(text);
          if (e) throw e;
          return [];
        };
        try { await fn(q); return { refused: false }; } catch (e) {
          const err = e as Error & { code?: string };
          return { refused: true, code: err.code, message: err.message };
        }
      },
    };
    return { ctx, seen };
  }
  const pgErr = (code: string, message: string) => Object.assign(new Error(message), { code });
  const refuse = (text: string) => (/^insert/i.test(text)
    ? pgErr("42501", 'new row violates row-level security policy for table "org_members"')
    : /^set local role/i.test(text) ? pgErr("42501", 'permission denied to set role "postgres"')
      : /^update reports/i.test(text) ? pgErr("P0001", "reports: report 1 is signed off and locked (only published_at may be set, once)")
        : pgErr("42501", "permission denied for table case_events"));

  it("pass when the database refuses with the expected error", async () => {
    const { ctx } = fakeCtx(refuse);
    for (const c of refusals) expect(await c.run(ctx), c.id).toMatchObject({ status: "PASS", note: expectedCode(c.id) });
  });

  it("the sign-off lock check fails on a permission error (the lock must be what refuses) and skips without a signed-off report", async () => {
    const c = byId("write.signed-off-report") as RefusalCheck;
    const { ctx } = fakeCtx(() => pgErr("42501", "permission denied for table reports"));
    expect((await c.run(ctx)).status).toBe("FAIL");
    const { ctx: ok } = fakeCtx(refuse);
    expect((await c.run({ ...ok, data: { ...data, signedOffReports: [] } })).status).toBe("SKIP");
  });

  it("fail when a statement is NOT refused", async () => {
    const { ctx } = fakeCtx(() => null);
    for (const c of refusals) expect((await c.run(ctx)).status, c.id).toBe("FAIL");
  });

  it("fail when refused for another reason (a read-only error or a foreign key is not the guard)", async () => {
    const { ctx } = fakeCtx(() => pgErr("25006", "cannot execute UPDATE in a read-only transaction"));
    for (const c of refusals) expect((await c.run(ctx)).status, c.id).toBe("FAIL");
    expect(expectRefusal({ refused: true, code: "23503", message: "insert violates foreign key" }, "42501", /row-level security/).status).toBe("FAIL");
  });

  it("only ever attempt statements that touch no row, an INSERT that RLS must refuse, or a no-op UPDATE the lock must refuse (no sequences)", async () => {
    const { ctx, seen } = fakeCtx(refuse);
    for (const c of refusals) await c.run(ctx);
    expect(seen.length).toBe(refusals.length);
    for (const s of seen) {
      expect(s.text).toMatch(/ where false$|^insert into org_members |^set local role "|^update reports set title = title where id = \$1$/);
      // Writes can't run READ ONLY (Postgres reports read-only before privileges); SET ROLE can and does.
      expect(s.readOnly).toBe(/^set local role/.test(s.text));
    }
  });

  it("SET ROLE is skipped without a table owner and fails if the app role owns the tables", async () => {
    const c = byId("role.no-set-owner") as RefusalCheck;
    const { ctx } = fakeCtx(refuse);
    expect((await c.run({ ...ctx, data: { ...data, tableOwner: null } })).status).toBe("SKIP");
    expect((await c.run({ ...ctx, data: { ...data, tableOwner: APP_ROLE } })).status).toBe("FAIL");
  });
});

// ---------------------------------------------------------------- role refusal and output

describe("role refusal", () => {
  it("allows the plain app role", () => {
    expect(roleRefusal(goodFacts)).toBeNull();
  });
  it("refuses a superuser, a BYPASSRLS role, a privileged session user or a member of a privileged role", () => {
    expect(roleRefusal({ ...goodFacts, currentUser: "postgres", currentSuper: true })).toMatch(/"postgres" is a SUPERUSER/);
    expect(roleRefusal({ ...goodFacts, currentBypass: true })).toMatch(/BYPASSRLS/);
    expect(roleRefusal({ ...goodFacts, sessionUser: "postgres", sessionSuper: true })).toMatch(/"postgres" is a SUPERUSER/);
    expect(roleRefusal({ ...goodFacts, sessionUser: "svc", sessionBypass: true })).toMatch(/"svc" has BYPASSRLS/);
    expect(roleRefusal({ ...goodFacts, privilegedMemberships: ["postgres"] })).toMatch(/member of "postgres".*SET ROLE/);
  });
});

describe("output", () => {
  it("removes URLs, addresses, ids, hashes and IPs from anything printed", () => {
    const s = sanitize('connect postgres://accessloop_app:hunter2@db.example.supabase.co:6543/postgres failed for 10.1.2.3:5432 '
      + "case 3f2a1c9e-8b7d-4c6e-9f00-1a2b3c4d5e6f hash 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 "
      + "mail sam@example.org Key (clerk_user_id)=(secret) already exists");
    for (const leak of ["hunter2", "supabase", "10.1.2.3", "3f2a1c9e", "9f86d081", "sam@", "secret"]) expect(s).not.toContain(leak);
    expect(s).toContain("[url]");
    expect(sanitize("x".repeat(500)).length).toBeLessThanOrEqual(160);
  });
  it("prints one aligned line per check and a summary", () => {
    const results: Result[] = [
      { id: "a", title: "first check", status: "PASS" },
      { id: "b", title: "second check", status: "FAIL", note: "rows visible in cases" },
      { id: "c", title: "third check", status: "SKIP", note: "no published report in the database" },
    ];
    expect(results.map(formatLine)).toEqual([
      "PASS  first check",
      "FAIL  second check (rows visible in cases)",
      "SKIP  third check (no published report in the database)",
    ]);
    expect(summaryLine(results)).toBe("1 PASS, 1 FAIL, 1 SKIP (3 checks)");
  });
  it("exits 1 on any FAIL, and on a SKIP only with --strict", () => {
    const ok: Result = { id: "a", title: "a", status: "PASS" };
    const skipped: Result = { id: "b", title: "b", status: "SKIP" };
    expect(exitCode([ok])).toBe(0);
    expect(exitCode([ok, skipped])).toBe(0);
    expect(exitCode([ok, skipped], true)).toBe(1);
    expect(exitCode([ok, { id: "c", title: "c", status: "FAIL" }])).toBe(1);
  });
});

// ---------------------------------------------------------------- against a real (in-memory) database

describe("against a seeded database as the app role (PGlite)", () => {
  let seeded: SeededDb;
  let sql: postgres.Sql;
  // PGlite runs every connection as the superuser "postgres", so the app role is entered with SET ROLE. SET ROLE
  // permission is decided by the SESSION user, which is a superuser here, so role.no-set-owner can only be
  // checked against a real login (the fake-connection tests above cover it).
  const checks: Check[] = CHECKS.filter((c) => c.id !== "role.no-set-owner");
  const asApp = async <T>(fn: () => Promise<T>) => {
    await sql.unsafe(`set role ${APP_ROLE}`);
    try { return await fn(); } finally { await sql.unsafe("reset role"); }
  };
  async function snapshot() {
    const tables = (await sql<{ t: string }[]>`select tablename::text as t from pg_tables where schemaname = 'public' order by 1`).map((r) => r.t);
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = Number((await sql.unsafe(`select count(*) as n from "${t}"`))[0].n);
    const [{ max }] = await sql`select coalesce(max(id), 0)::text as max from case_events`;
    const [{ seq }] = await sql`select last_value::text as seq from case_events_id_seq`;
    return { counts, max, seq };
  }

  beforeAll(async () => {
    seeded = await startSeededDb();
    sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
    // A draft and a published report, as db-smoke makes them, so the definer checks have something to find.
    const [demo] = await sql<{ id: string }[]>`select id from orgs where slug = 'maple-harbour'`;
    const [lead] = await sql<{ id: string }[]>`select id from org_members where org_id = ${demo.id} and role = 'lead' limit 1`;
    for (const published of [false, true]) {
      await sql`insert into reports (org_id, period_start, period_end, title, snapshot, manifest_hash, content, heading_check, created_by,
          status, published_at)
        values (${demo.id}, '2026-01-01', '2026-12-31', 'smoke', '{}'::jsonb, 'x', '{}'::jsonb, '[]'::jsonb, ${lead.id},
          ${published ? "signed_off" : "draft"}, ${published ? new Date() : null})`;
    }
  }, 180_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 }).catch(() => {});
    await seeded?.stop();
  });

  it("every check passes as accessloop_app, and the run writes nothing", async () => {
    const before = await snapshot();
    const results = await asApp(() => runChecks(sql, checks));
    const after = await snapshot();
    expect(results.filter((r) => r.status !== "PASS").map(formatLine)).toEqual([]);
    expect(results).toHaveLength(checks.length);
    expect(after).toEqual(before);
  }, 60_000);

  it("a weakened database turns the right checks red", async () => {
    await sql.unsafe("alter table cases disable row level security");
    await sql.unsafe(`grant delete on cases to ${APP_ROLE}`);
    await sql.unsafe("alter table case_events disable trigger case_events_no_update");
    // D7(a) and D7(b), merged from T5 and T3: the sign-off lock off, orgs not forced, an open policy on rate_limits.
    await sql.unsafe("alter table reports disable trigger reports_signed_off_lock");
    await sql.unsafe("alter table orgs no force row level security");
    await sql.unsafe("create policy remote_smoke_open on rate_limits using (true) with check (true)");
    try {
      const results = await asApp(() => runChecks(sql, checks));
      const failed = results.filter((r) => r.status === "FAIL").map((r) => r.id);
      expect(failed).toEqual(expect.arrayContaining([
        "rls.forced", "rls.fails-closed", "rls.unknown-org", "grants.no-delete", "write.delete-cases", "trigger.append-only",
        "rls.forced-all", "rls.global-policies", "trigger.sign-off-lock", "write.signed-off-report",
      ]));
      expect(failed).not.toContain("write.update-events"); // still no UPDATE grant on case_events
      expect(results.find((r) => r.id === "rls.forced-all")!.note).toMatch(/orgs \(not forced\)/);
      expect(results.find((r) => r.id === "rls.global-policies")!.note).toMatch(/rate_limits\.remote_smoke_open applies to PUBLIC/);
    } finally {
      await sql.unsafe("alter table cases enable row level security");
      await sql.unsafe(`revoke delete on cases from ${APP_ROLE}`);
      await sql.unsafe("alter table case_events enable trigger case_events_no_update");
      await sql.unsafe("alter table reports enable trigger reports_signed_off_lock");
      await sql.unsafe("alter table orgs force row level security");
      await sql.unsafe("drop policy if exists remote_smoke_open on rate_limits");
    }
    const again = await asApp(() => runChecks(sql, checks));
    expect(again.filter((r) => r.status !== "PASS").map(formatLine)).toEqual([]);
  }, 60_000);

  it("a role without the app's grants still gets every catalog check; the data checks FAIL with the reason", async () => {
    const before = await snapshot();
    await sql.unsafe("create role remote_smoke_plain nologin");
    try {
      await sql.unsafe("set role remote_smoke_plain");
      let results: Result[];
      try { results = await runChecks(sql, checks); } finally { await sql.unsafe("reset role"); }
      expect(results).toHaveLength(checks.length);
      const byResult = (id: string) => results.find((r) => r.id === id)!;
      expect(byResult("role.app")).toMatchObject({ status: "FAIL", note: 'connected as "remote_smoke_plain"' });
      expect(byResult("grants.app-works")).toMatchObject({ status: "FAIL" });
      expect(byResult("rls.forced").status).toBe("PASS"); // the catalog itself is still read
      for (const r of results.filter((x) => checks.find((c) => c.id === x.id)!.mode !== "catalog")) {
        expect(r.status, r.id).toBe("FAIL");
        expect(r.note, r.id).toMatch(/^could not read the data as this role: 42501 permission denied/);
      }
    } finally {
      await sql.unsafe("drop role remote_smoke_plain");
    }
    expect(await snapshot()).toEqual(before);
  }, 60_000);

  it("lookups owned by a role without BYPASSRLS (the review's managed-Postgres risk) FAIL with the fix in the note", async () => {
    const lookups = checks.filter((c) => c.id === "definer.receipt-resolves" || c.id === "definer.published-finds");
    expect(lookups).toHaveLength(2);
    const [{ owner }] = await sql<{ owner: string }[]>`select pg_get_userbyid(proowner)::text as owner from pg_proc where proname = 'resolve_receipt'`;
    // Like Supabase's table owner under FORCE row-level security: it may read the tables, but RLS applies to it.
    await sql.unsafe("create role remote_smoke_fn_owner nologin");
    await sql.unsafe("grant select on cases, reports to remote_smoke_fn_owner");
    const setOwner = async (role: string) => {
      await sql.unsafe(`alter function resolve_receipt(text) owner to ${role}`);
      await sql.unsafe(`alter function resolve_published_report(uuid) owner to ${role}`);
    };
    try {
      await setOwner("remote_smoke_fn_owner");
      const results = await asApp(() => runChecks(sql, lookups));
      for (const r of results) {
        expect(r.status, r.id).toBe("FAIL");
        expect(r.note, r.id).toMatch(/owner role "remote_smoke_fn_owner" has no BYPASSRLS: add explicit policies/);
      }
    } finally {
      await setOwner(owner);
      await sql.unsafe("revoke all on cases, reports from remote_smoke_fn_owner");
      await sql.unsafe("drop role remote_smoke_fn_owner");
    }
    expect((await asApp(() => runChecks(sql, lookups))).map((r) => r.status)).toEqual(["PASS", "PASS"]);
  }, 60_000);

  it("reads the role facts the refusal is based on, and refuses the superuser", async () => {
    const su = await readRoleFacts(sql);
    expect(su.currentSuper).toBe(true);
    expect(roleRefusal(su)).toMatch(/SUPERUSER/);
    const app = await asApp(() => readRoleFacts(sql));
    expect(app).toMatchObject({ currentUser: APP_ROLE, currentSuper: false, currentBypass: false, privilegedMemberships: [] });
  });

  it("Data API roles: present with no grants passes; a table grant or a definer function grant fails", async () => {
    const apiCheck = [byId("api-roles.closed")];
    const run = async () => (await asApp(() => runChecks(sql, apiCheck)))[0];
    await sql.unsafe("create role anon nologin");
    await sql.unsafe("create role authenticated nologin");
    try {
      expect(await run()).toMatchObject({ status: "PASS", note: "anon, authenticated" }); // app_org() via PUBLIC doesn't count
      await sql.unsafe("grant select on reports to anon");
      expect(await run()).toMatchObject({ status: "FAIL", note: "anon: 1 tables, 0 definer functions" });
      await sql.unsafe("revoke select on reports from anon");
      await sql.unsafe("grant execute on function resolve_receipt(text) to authenticated");
      expect(await run()).toMatchObject({ status: "FAIL", note: "authenticated: 0 tables, 1 definer functions" });
    } finally {
      await sql.unsafe("revoke all on function resolve_receipt(text) from authenticated");
      await sql.unsafe("revoke all on reports from anon");
      await sql.unsafe("drop role anon");
      await sql.unsafe("drop role authenticated");
    }
  });

  it("main() refuses a superuser connection (exit 2) and needs DATABASE_URL", async () => {
    const saved = process.env.DATABASE_URL;
    const lines: string[] = [];
    try {
      process.env.DATABASE_URL = seeded.url;
      expect(await main([], (s) => lines.push(s))).toBe(2);
      expect(lines.join("\n")).toMatch(/^REFUSED: "postgres" is a SUPERUSER/m);
      expect(lines.join("\n")).not.toContain(seeded.url);
      delete process.env.DATABASE_URL;
      expect(await main([], (s) => lines.push(s))).toBe(2);
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
    }
  });
});
