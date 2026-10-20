// FROZEN. Single DB client. Server-only (Node runtime). Connects as accessloop_app (no BYPASSRLS).
// Server-only: never import from a client component. (No "server-only" import, so tsx scripts like db/seed.ts can use it.)
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// prepare:false is required behind transaction-mode poolers (Supabase :6543, PgBouncer).
const sql = postgres(url, { prepare: false, max: 5 });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
