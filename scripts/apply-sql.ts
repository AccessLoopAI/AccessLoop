// Applies one SQL file with the OWNER connection (MIGRATION_DATABASE_URL), e.g. db/sql/0100_security.sql.
// Run: npm run db:security   (tsx --env-file-if-exists=.env.local scripts/apply-sql.ts <file.sql>)
// Never prints the connection URL. No top-level await: works whether or not package.json sets "type": "module".
import postgres from "postgres";
import { readFileSync } from "node:fs";
import path from "node:path";

async function main(): Promise<number> {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: tsx scripts/apply-sql.ts <file.sql>");
    return 2;
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    console.error("MIGRATION_DATABASE_URL is not set (run `npm run local:setup`, or see .env.example).");
    return 1;
  }
  const text = readFileSync(path.resolve(file), "utf8");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(text);
  } finally {
    await sql.end();
  }
  console.log(`Applied ${path.relative(process.cwd(), path.resolve(file)).replace(/\\/g, "/")}.`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    // postgres.js errors carry the server message only (no URL); still keep it short.
    console.error("apply-sql failed:", (e instanceof Error ? e.message : String(e)).slice(0, 300));
    process.exit(1);
  });
