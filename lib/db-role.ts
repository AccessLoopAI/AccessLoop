// Database security checks shared by the boot check, `npm run db:deploy` and `npm run db:smoke`
// (docs/archive/phase7-prompt.md T3 items 2 and 14; docs/domain.md §9). The app must connect as a role that row-level
// security applies to: a superuser or a BYPASSRLS role reads every tenant's rows, so the fail-closed RLS of
// db/sql/0100_security.sql would silently stop protecting anything. Used at boot (lib/boot-checks.ts, on the app's
// own connection), by scripts/migrate.ts (owner connection, about accessloop_app) and scripts/db-smoke.ts.
// Pure apart from the SQL text: no imports, so tsx scripts can use it as they are.

/** The role and the attributes that matter for the app: the two that switch row-level security off, and LOGIN. */
export interface DbRoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcanlogin?: boolean;
}

/** The app role named in db/sql/0100_security.sql (its grants and policies name it). */
export const APP_ROLE = "accessloop_app";

/** The role this connection runs as (current_user), from pg_roles. */
export const CURRENT_ROLE_SQL = "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = current_user";

/** A named role, from pg_roles (no row when it does not exist). Bind the name as $1. */
export const NAMED_ROLE_SQL = "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = $1";

/** Tables in schema public whose row-level security is not both enabled and forced (should be none). */
export const UNPROTECTED_TABLES_SQL =
  "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
  "where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity) order by 1";

/**
 * Why this role must not serve the app, or null when it is fine. `who` names the connection in the message, e.g.
 * "The app's database role (DATABASE_URL)". Role names are not secrets; no URL or password is ever part of it.
 */
export function roleRefusal(row: DbRoleRow | undefined, who: string): string | null {
  if (!row) return `${who} was not found in pg_roles.`;
  const flags = [row.rolsuper ? "SUPERUSER" : null, row.rolbypassrls ? "BYPASSRLS" : null].filter(Boolean);
  if (flags.length === 0) return null;
  return (
    `${who} "${row.rolname}" has ${flags.join(" and ")}, so row-level security would not apply to it and every ` +
    `organization's records would be readable through the app. Connect as a role created NOSUPERUSER NOBYPASSRLS ` +
    `(${APP_ROLE}; docs/domain.md §9).`
  );
}
