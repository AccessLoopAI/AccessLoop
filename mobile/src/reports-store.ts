// "My reports": the receipt codes this device keeps (Phase 7 Wave 3). Codes are kept ONLY in expo-secure-store
// (the iOS Keychain / Android Keystore), never in AsyncStorage, files, URLs, route params or logs. Screens refer
// to a report by a random local id; the code is read from the store only when a call needs it.
//
// Where expo-secure-store isn't available (Expo web), nothing is written anywhere: codes live in memory for this
// tab only, and the screens say so. A code someone typed on "Check a report" also stays in memory until they
// choose "Keep it in My reports".
import * as SecureStore from "expo-secure-store";
import { normalizeReceiptCode } from "./receipt-code";

export interface SavedReport {
  /** Local id (not secret, not the code). Used in routes such as /reports/{id}. */
  id: string;
  /** Normalized receipt code (16 characters). Never shown in a URL; never logged. */
  code: string;
  ref: string;
  orgName: string;
  orgSlug: string;
  /** ISO 8601, when this device kept it. */
  savedAt: string;
  /** false = only in memory (Expo web, or a checked code the person hasn't kept). */
  kept: boolean;
}

const INDEX_KEY = "accessloop.reports.v1";
const itemKey = (id: string) => `accessloop.report.v1.${id}`;
/** Plenty for one person; keeps every stored value tiny (SecureStore values should stay small). */
export const MAX_KEPT_REPORTS = 50;

/** Not synced to other devices or backups, readable only while the device is unlocked. */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const memory = new Map<string, SavedReport>();
let available: Promise<boolean> | null = null;

/** True on iOS and Android; false on the web build, where nothing is ever stored. */
export function canKeepCodes(): Promise<boolean> {
  available ??= SecureStore.isAvailableAsync().catch(() => false);
  return available;
}

/** What one secure-store value holds (well under 300 bytes). */
function stored(r: SavedReport): string {
  return JSON.stringify({ code: r.code, ref: r.ref, orgName: r.orgName, orgSlug: r.orgSlug, savedAt: r.savedAt });
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function readIndex(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(INDEX_KEY, OPTIONS);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^[a-z0-9]+$/.test(x)) : [];
  } catch {
    return [];
  }
}

async function readItem(id: string): Promise<SavedReport | null> {
  try {
    const raw = await SecureStore.getItemAsync(itemKey(id), OPTIONS);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedReport>;
    const code = typeof v.code === "string" ? normalizeReceiptCode(v.code) : null;
    if (!code || typeof v.ref !== "string") return null;
    return {
      id,
      code,
      ref: v.ref,
      orgName: typeof v.orgName === "string" ? v.orgName : "",
      orgSlug: typeof v.orgSlug === "string" ? v.orgSlug : "",
      savedAt: typeof v.savedAt === "string" ? v.savedAt : "",
      kept: true,
    };
  } catch {
    return null;
  }
}

/** Every report this device knows about, newest first (kept ones and this session's ones). */
export async function listReports(): Promise<SavedReport[]> {
  const out: SavedReport[] = [...memory.values()];
  if (await canKeepCodes()) {
    for (const id of await readIndex()) {
      const item = await readItem(id);
      if (item) out.push(item);
    }
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function getReport(id: string): Promise<SavedReport | null> {
  const inMemory = memory.get(id);
  if (inMemory) return inMemory;
  if (!/^[a-z0-9]+$/.test(id) || !(await canKeepCodes())) return null;
  return (await readIndex()).includes(id) ? readItem(id) : null;
}

export interface ReportFacts {
  code: string;
  ref: string;
  orgName: string;
  orgSlug: string;
}

async function findByCode(code: string): Promise<SavedReport | null> {
  return (await listReports()).find((r) => r.code === code) ?? null;
}

/**
 * Keep a report's code on this device (secure store), or in memory where that isn't possible. The same code is
 * never kept twice. `kept` in the result says whether it was really stored.
 */
export async function keepReport(facts: ReportFacts): Promise<SavedReport> {
  const code = normalizeReceiptCode(facts.code);
  if (!code) throw new Error("not a receipt code");
  const existing = await findByCode(code);
  if (existing?.kept) return existing;
  const report: SavedReport = {
    id: existing?.id ?? newId(),
    code,
    ref: facts.ref,
    orgName: facts.orgName,
    orgSlug: facts.orgSlug,
    savedAt: new Date().toISOString(),
    kept: false,
  };
  if (!(await canKeepCodes())) {
    memory.set(report.id, report);
    return report;
  }
  const ids = await readIndex();
  if (ids.length >= MAX_KEPT_REPORTS) throw new Error("too many kept reports");
  await SecureStore.setItemAsync(itemKey(report.id), stored(report), OPTIONS);
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...ids.filter((x) => x !== report.id), report.id]), OPTIONS);
  memory.delete(report.id);
  return { ...report, kept: true };
}

/** A code someone typed on "Check a report": in memory only, until they choose to keep it. */
export async function holdForSession(facts: ReportFacts): Promise<SavedReport> {
  const code = normalizeReceiptCode(facts.code);
  if (!code) throw new Error("not a receipt code");
  const existing = await findByCode(code);
  if (existing) return existing;
  const report: SavedReport = { id: newId(), code, ...pick(facts), savedAt: new Date().toISOString(), kept: false };
  memory.set(report.id, report);
  return report;
}

function pick(f: ReportFacts) {
  return { ref: f.ref, orgName: f.orgName, orgSlug: f.orgSlug };
}

/** Update the non-secret facts (ref, org) after a status call, without touching the code. */
export async function refreshFacts(id: string, facts: Omit<ReportFacts, "code">): Promise<void> {
  const inMemory = memory.get(id);
  if (inMemory) {
    memory.set(id, { ...inMemory, ...facts });
    return;
  }
  const item = await readItem(id);
  if (!item || (item.ref === facts.ref && item.orgName === facts.orgName && item.orgSlug === facts.orgSlug)) return;
  await SecureStore.setItemAsync(itemKey(id), stored({ ...item, ...facts }), OPTIONS);
}

/** "Remove from this device": deletes the code from the secure store (and from memory). */
export async function forgetReport(id: string): Promise<void> {
  memory.delete(id);
  if (!(await canKeepCodes())) return;
  const ids = await readIndex();
  await SecureStore.deleteItemAsync(itemKey(id), OPTIONS);
  if (ids.includes(id)) await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)), OPTIONS);
}
