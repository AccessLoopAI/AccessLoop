// `npm run db:deploy` (docs/phase7-prompt.md T3 item 14): brings a database up to date as its OWNER
// (MIGRATION_DATABASE_URL), for a hosted database such as Supabase at "Going live" or any copy you set up by hand.
// The same two steps scripts/local.ts (frozen) runs for the local database, lifted here without editing it:
//   1. the drizzle migrations in db/migrations (drizzle-orm's migrator: each one once, in order);
//   2. db/sql/0100_security.sql (idempotent: grants, the append-only trigger, row-level security, lookups).
// Before anything changes it checks that the app role accessloop_app exists, can log in and is NOSUPERUSER
// NOBYPASSRLS. It never creates or alters a role: on a hosted database a human creates it once (docs/handoff.md),
// and the message says how. Afterwards it checks that every table in public has row-level security on and forced.
// Never prints a connection URL. Exit 0 = done, 1 = a check or step failed (nothing after it ran).
// Run: npm run db:deploy   (tsx --env-file-if-exists=.env.local scripts/migrate.ts)
// No top-level await: works whether or not package.json sets "type": "module".
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { APP_ROLE, NAMED_ROLE_SQL, UNPROTECTED_TABLES_SQL, roleRefusal, type DbRoleRow } from "../lib/db-role";

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "db", "migrations");
const SECURITY_SQL = path.join(ROOT, "db", "sql", "0100_security.sql");

const CREATE_ROLE_HINT =
  `Create it once as the owner (pick a strong password; it goes into DATABASE_URL):\n` +
  `  CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS;`;

async function main(): Promise<number> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error("MIGRATION_DATABASE_URL is not set (the owner connection; see .env.example).");
    return 1;
  }
  if (!existsSync(path.join(MIGRATIONS, "meta", "_journal.json"))) {
    console.error("db/migrations is missing its journal. Run `npm run db:generate` first.");
    return 1;
  }

  const owner = postgres(url, { max: 1, onnotice: () => {} });
  try {
    // 1. The app role, before anything is changed (the security SQL grants to it by name).
    const [role] = await owner.unsafe<DbRoleRow[]>(NAMED_ROLE_SQL, [APP_ROLE]);
    if (!role) {
      console.error(`The app role ${APP_ROLE} does not exist. ${CREATE_ROLE_HINT}`);
      return 1;
    }
    const refusal = roleRefusal(role, "The app role");
    if (refusal) {
      console.error(`${refusal}\nFix it as the owner: ALTER ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS;`);
      return 1;
    }
    if (role.rolcanlogin === false) {
      console.error(`The app role ${APP_ROLE} cannot log in. Fix it as the owner: ALTER ROLE ${APP_ROLE} LOGIN;`);
      return 1;
    }
    console.log(`App role ${APP_ROLE}: exists, can log in, NOSUPERUSER NOBYPASSRLS.`);

    // 2. Migrations, then the security SQL (exactly as scripts/local.ts applies them).
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(owner), { migrationsFolder: MIGRATIONS });
    console.log("Migrations applied (db/migrations).");
    await owner.unsafe(readFileSync(SECURITY_SQL, "utf8"));
    console.log("Security SQL applied (db/sql/0100_security.sql).");

    // 3. Nothing in public is left without forced row-level security.
    const open = await owner.unsafe<{ relname: string }[]>(UNPROTECTED_TABLES_SQL);
    if (open.length > 0) {
      console.error(
        `These tables in public have no forced row-level security: ${open.map((r) => r.relname).join(", ")}. ` +
          "Add them to db/sql/0100_security.sql and run this again.",
      );
      return 1;
    }
    console.log("Every table in public has row-level security on and forced.");
    return 0;
  } finally {
    await owner.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // postgres.js errors carry the server's message (never the URL); keep it short.
    const code = typeof e === "object" && e !== null && "code" in e ? `${String((e as { code: unknown }).code)}: ` : "";
    console.error("db:deploy failed:", `${code}${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    process.exit(1);
  });
