// The dashboard's evidence-integrity card (docs/domain.md §10 item 6: "All N records verify", from verifyCaseChain
// over the period's cases, cached for 60 s). Server-only: it reads case_events inside the caller's withOrg
// transaction through the frozen verifyCaseChain (lib/case-events.ts), which recomputes every hash from the stored
// rows. The cache is per server process, per org + period + the chain heads the page just loaded: a new event
// changes a head, so the count can never lag behind the rest of the page; an edited row (same stored hashes) is
// found within 60 s.
import { createHash } from "node:crypto";
import type { Tx } from "@/db/client";
import { verifyCaseChain } from "@/lib/case-events";
import type { CaseSet } from "./compute";
import type { Period } from "./period";
import type { MetricCase } from "./replay";

export const INTEGRITY_CACHE_MS = 60_000;
const MAX_ENTRIES = 200;

export interface BrokenChain {
  caseId: string;
  ref: string;
  /** The first event whose stored hash does not match the recomputed one. */
  brokenAtSeq: number | undefined;
}

export interface IntegrityCheck {
  /** Records checked: one per case of the period (= the period's cases, CaseSet `total`). */
  checked: number;
  /** Records whose whole chain recomputes to the stored hashes. */
  intact: number;
  broken: BrokenChain[];
  /** When the chains were last recomputed (cached up to 60 s). */
  checkedAt: Date;
}

interface Entry {
  key: string;
  at: number;
  value: IntegrityCheck;
}

// On globalThis: one cache per server process even if the module is bundled twice.
const STORE = Symbol.for("accessloop.metrics.integrity-cache");
type Store = Map<string, Entry>;
function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>;
  return (g[STORE] ??= new Map());
}

/** Which chains, and their heads as loaded: any appended event changes the key. */
function cacheKey(orgId: string, period: Period, cases: readonly MetricCase[]): string {
  const h = createHash("sha256");
  for (const c of cases) {
    const head = c.events.reduce((best, e) => (e.seq > best.seq ? e : best), c.events[0] ?? { seq: 0, hash: "" });
    h.update(`${c.id}:${head?.seq ?? 0}:${head?.hash ?? ""}\n`);
  }
  return `${orgId}|${period.start}|${period.end}|${h.digest("hex")}`;
}

/**
 * Verify the chain of every case in `set` (the period's cases) with verifyCaseChain, inside the caller's withOrg
 * transaction. `cases` are the loaded metric cases (for refs and the cache key). Cached for 60 s.
 */
export async function verifyPeriodChains(
  tx: Tx,
  orgId: string,
  period: Period,
  set: CaseSet,
  cases: readonly MetricCase[],
  now: Date = new Date(),
): Promise<IntegrityCheck> {
  const inSet = new Set(set.caseIds);
  const scope = cases.filter((c) => inSet.has(c.id));
  const key = cacheKey(orgId, period, scope);
  const cache = store();
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < INTEGRITY_CACHE_MS) return hit.value;

  const broken: BrokenChain[] = [];
  for (const c of scope) {
    const check = await verifyCaseChain(tx, orgId, c.id);
    if (!check.ok) broken.push({ caseId: c.id, ref: c.ref, brokenAtSeq: check.brokenAtSeq });
  }
  const value: IntegrityCheck = { checked: scope.length, intact: scope.length - broken.length, broken, checkedAt: now };

  for (const [k, e] of cache) if (now.getTime() - e.at >= INTEGRITY_CACHE_MS) cache.delete(k);
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, { key, at: now.getTime(), value });
  return value;
}
