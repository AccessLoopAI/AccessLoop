// FROZEN. Append-only, per-case hash chain (docs/domain.md §8).
// hash_n = sha256(hash_{n-1} + "\n" + canonicalJson({orgId, caseId, seq, type, actorKind, actorId, payload, createdAt}))
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { caseEvents } from "@/db/schema";
import type { Tx } from "@/db/client";
import { sha256Hex } from "./crypto";

export const GENESIS_HASH = "0".repeat(64);

export type EventType = (typeof caseEvents.$inferInsert)["type"];
export type ActorKind = (typeof caseEvents.$inferInsert)["actorKind"];

export interface NewEvent {
  orgId: string;
  caseId: string;
  type: EventType;
  actorKind: ActorKind;
  actorId: string | null;
  payload: Record<string, unknown>; // REDACTED content only. Never raw text, emails, names.
  createdAt?: Date;                 // defaults to now; seed passes historical dates
}

/** Deterministic JSON: sorted keys, no whitespace, Dates as ISO strings, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function computeHash(prevHash: string, e: {
  orgId: string; caseId: string; seq: number; type: string; actorKind: string;
  actorId: string | null; payload: unknown; createdAt: Date;
}): string {
  return sha256Hex(prevHash + "\n" + canonicalJson({
    orgId: e.orgId, caseId: e.caseId, seq: e.seq, type: e.type, actorKind: e.actorKind,
    actorId: e.actorId, payload: e.payload, createdAt: e.createdAt.toISOString(),
  }));
}

/** Append one event. Must run inside withOrg(). Serializes per case with an advisory lock. */
export async function appendCaseEvent(tx: Tx, e: NewEvent) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"case_events:" + e.caseId}))`);
  const [last] = await tx
    .select({ seq: caseEvents.seq, hash: caseEvents.hash })
    .from(caseEvents)
    .where(eq(caseEvents.caseId, e.caseId))
    .orderBy(desc(caseEvents.seq))
    .limit(1);
  const seq = last ? last.seq + 1 : 1;
  const prevHash = last ? last.hash : GENESIS_HASH;
  // Millisecond precision: matches the timestamp(3) column so the hash round-trips.
  const createdAt = new Date(Math.floor((e.createdAt ?? new Date()).getTime()));
  const hash = computeHash(prevHash, { ...e, seq, createdAt });
  const [row] = await tx.insert(caseEvents).values({
    orgId: e.orgId, caseId: e.caseId, seq, type: e.type, actorKind: e.actorKind,
    actorId: e.actorId, payload: e.payload, createdAt, prevHash, hash,
  }).returning();
  return row;
}

export interface ChainCheck {
  ok: boolean;
  headHash: string;
  length: number;
  brokenAtSeq?: number;
}

/** Recompute a case's chain from the stored rows. */
export async function verifyCaseChain(tx: Tx, orgId: string, caseId: string): Promise<ChainCheck> {
  const rows = await tx.select().from(caseEvents)
    .where(and(eq(caseEvents.orgId, orgId), eq(caseEvents.caseId, caseId)))
    .orderBy(asc(caseEvents.seq));
  let prev = GENESIS_HASH;
  for (const [i, r] of rows.entries()) {
    const expected = computeHash(prev, {
      orgId: r.orgId, caseId: r.caseId, seq: r.seq, type: r.type, actorKind: r.actorKind,
      actorId: r.actorId, payload: r.payload, createdAt: r.createdAt,
    });
    if (r.seq !== i + 1 || r.prevHash !== prev || r.hash !== expected) {
      return { ok: false, headHash: prev, length: i, brokenAtSeq: r.seq };
    }
    prev = r.hash;
  }
  return { ok: true, headHash: prev, length: rows.length };
}
