// `npm run db:retention` (docs/archive/phase7-prompt.md T3 item 13; lib/retention.ts has the rules):
//   1. after a case's keep-until date (received + 7 years, ACR s.19): wipe its private copy (original words, email,
//      contact details) and record it on the case's log;
//   2. 30 days after a case was verified or closed: remove the reporter's email and contact details, and record it.
// DRY RUN BY DEFAULT: it lists what it would do and writes nothing. `npm run db:retention -- --apply` writes.
// It runs as the database OWNER (MIGRATION_DATABASE_URL) and refuses the app role: the app itself never deletes or
// wipes anything. Each org is read in its own context with app.role = 'lead' (the policies on case_private), so it
// also works where the owner has no BYPASSRLS (Supabase). Prints organization names, case references and counts
// only: never report text, an address, a code or a connection URL. Exit 0 = done, 1 = it could not run or a case failed.
// No top-level await: works whether or not package.json sets "type": "module".
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import type { Tx } from "../db/client";
import { APP_ROLE, CURRENT_ROLE_SQL, type DbRoleRow } from "../lib/db-role";
import { runRetention, type PrivatePart, type RetentionRule } from "../lib/retention";

const RULE_WORDS: Record<RetentionRule, string> = {
  retention_ended: "past the 7-year keep-until date: wipe the private copy",
  contact_after_finished: "finished 30+ days ago: remove the contact details",
};

const PART_WORDS: Record<PrivatePart, string> = {
  original_text: "original words",
  reporter_email: "email",
  reporter_contact: "contact details",
};

async function main(): Promise<number> {
  const apply = process.argv.slice(2).includes("--apply");
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error("MIGRATION_DATABASE_URL is not set (the owner connection; see .env.example). Retention never runs as the app role.");
    return 1;
  }
  if (apply && !process.env.ENCRYPTION_KEY) {
    console.error("ENCRYPTION_KEY is not set: it is needed to write the note that replaces a wiped original.");
    return 1;
  }

  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const [role] = await client.unsafe<DbRoleRow[]>(CURRENT_ROLE_SQL);
    if (!role || role.rolname === APP_ROLE) {
      console.error(`Retention runs as the database owner, never as the app role ${APP_ROLE}. Check MIGRATION_DATABASE_URL.`);
      return 1;
    }

    const db = drizzle(client, { schema });
    const orgs = await db.select({ id: schema.orgs.id, name: schema.orgs.name }).from(schema.orgs).orderBy(schema.orgs.name);
    const results = await runRetention({
      orgs,
      apply,
      inOrgTx: (orgId, fn) =>
        db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.org_id', ${orgId}, true), set_config('app.role', 'lead', true)`);
          return fn(tx as unknown as Tx);
        }),
    });

    console.log(apply ? "Retention: applying the rules." : "Retention: DRY RUN, nothing is written. Add --apply to write.");
    let total = 0;
    let failed = 0;
    for (const r of results) {
      total += r.candidates.length;
      failed += r.failed;
      console.log(`\n${r.org.name}: ${r.candidates.length === 0 ? "nothing to do" : `${r.candidates.length} case(s)`}`);
      for (const c of r.candidates) {
        console.log(`  ${c.ref}  ${RULE_WORDS[c.rule]} (${c.removes.map((p) => PART_WORDS[p]).join(", ")})`);
      }
      if (apply && r.candidates.length > 0) console.log(`  applied ${r.applied}${r.failed ? `, failed ${r.failed}` : ""}`);
    }
    console.log(`\n${total} case(s) ${apply ? "handled" : "would be handled"} in ${results.length} organization(s).`);
    return failed > 0 ? 1 : 0;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // postgres.js errors carry the server's message (never the URL); keep it short.
    const code = typeof e === "object" && e !== null && "code" in e ? `${String((e as { code: unknown }).code)}: ` : "";
    console.error("db:retention failed:", `${code}${(e instanceof Error ? e.message : String(e)).slice(0, 300)}`);
    process.exit(1);
  });
