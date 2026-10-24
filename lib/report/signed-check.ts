// /verify's fifth check, "Signed by AccessLoop at sign-off" (docs/domain.md §8), the pure part. Pure apart from
// node:crypto (the signature check in lib/report/signing.ts): the caller loads the report row as stored, the
// published keys and, for every case history the signature sealed, whether that history still holds the signed
// record and still verifies up to it (lib/report/verify.ts loadSignedHeads).
//
// A draft is not signed yet (information, never an error). A signed-off report passes only when the root
// recomputed from the row as stored NOW equals the signed root, the Ed25519 signature over that root checks with a
// published key, and every sealed case history still contains its signed record, unbroken up to it. Records added
// after sign-off are fine (check 4 "Later updates"). Words only, never payloads: the public sees this check.
import type { KeyObject } from "node:crypto";
import { checkSignature, readSigning, type SignatureCheck } from "./signing";

export type SignedState =
  /** Not signed off yet: signing happens at sign-off. */
  | "draft"
  /** Signed off, but the row carries no readable signature. */
  | "unsigned"
  /** Signed off with a signature, checked below. */
  | "checked";

/** What one sealed case history holds now. */
export interface HeadNow {
  /** A record is stored at the signed position (case, record number) with the signed fingerprint. */
  found: boolean;
  /** The history verifies (the frozen verifyCaseChain) at least up to and including that record. */
  intact: boolean;
}

export interface SignedHeadResult {
  caseId: string;
  /** The case's reference when the report's snapshot names it, else null (a case outside the report). */
  ref: string | null;
  seq: number;
  found: boolean;
  intact: boolean;
  ok: boolean;
}

export interface SignedCheck {
  state: SignedState;
  keyId: string | null;
  /** The signed root (the fingerprint for the ACR s.16 notice). */
  root: string | null;
  /** ISO, when it was signed (= signed_off_at). */
  signedAt: string | null;
  /** This server has at least one published key to check signatures with. */
  keysAvailable: boolean;
  /** The stored row against its signature (null unless `checked`). */
  signature: SignatureCheck | null;
  /**
   * Every sealed case history (the org's, at sign-off): which cases, those that no longer hold their record, and the
   * cases the report cites whose history the signature did not seal at all (`unsealed`, refs or ids; a sign-off seals
   * every history of the org, so a cited case missing from the heads means the stored heads are not what was signed).
   */
  heads: { total: number; caseIds: string[]; changed: SignedHeadResult[]; unsealed: string[] };
  /** checked, the signature holds, every sealed history still holds its signed record, and every cited case was sealed. */
  ok: boolean;
}

export const NOT_SIGNED_YET: SignedCheck = {
  state: "draft",
  keyId: null,
  root: null,
  signedAt: null,
  keysAvailable: false,
  signature: null,
  heads: { total: 0, caseIds: [], changed: [], unsealed: [] },
  ok: false,
};

export interface SignedRow {
  id: string;
  status: "draft" | "signed_off";
  signedOffAt: Date | null;
  manifestHash: string;
  /** The snapshot as stored (it must still hash to the signed fingerprint). */
  snapshot?: unknown;
  content: unknown;
  areaText: unknown;
  consultationsText: unknown;
}

/**
 * The fifth check. `headsNow`: by case id, for each head in content.signing.heads (a missing entry counts as gone).
 * `refsById`: the snapshot's refs, for the words. `citedIds`: the cases the report cites, each of which must be among
 * the sealed heads (as tools/verify-bundle.mjs requires offline: "the signature sealed no record of this case").
 */
export function checkSigned(a: {
  row: SignedRow;
  keys: ReadonlyMap<string, KeyObject>;
  headsNow: ReadonlyMap<string, HeadNow>;
  refsById?: ReadonlyMap<string, string>;
  citedIds?: readonly string[];
}): SignedCheck {
  const keysAvailable = a.keys.size > 0;
  if (a.row.status !== "signed_off") return { ...NOT_SIGNED_YET, keysAvailable };
  const s = readSigning(a.row.content);
  if (!s) return { ...NOT_SIGNED_YET, state: "unsigned", keysAvailable };

  const signature = checkSignature(a.row, a.keys);
  const results: SignedHeadResult[] = s.heads.map((h) => {
    const now = a.headsNow.get(h.caseId);
    const found = !!now?.found;
    const intact = !!now?.intact;
    return { caseId: h.caseId, ref: a.refsById?.get(h.caseId) ?? null, seq: h.seq, found, intact, ok: found && intact };
  });
  const changed = results.filter((r) => !r.ok);
  const sealed = new Set(results.map((r) => r.caseId));
  const unsealed = [...new Set(a.citedIds ?? [])].filter((id) => !sealed.has(id)).map((id) => a.refsById?.get(id) ?? id);
  return {
    state: "checked",
    keyId: s.keyId,
    root: s.root,
    signedAt: s.signedAt,
    keysAvailable,
    signature,
    heads: { total: results.length, caseIds: results.map((r) => r.caseId), changed, unsealed },
    ok: signature.ok && changed.length === 0 && unsealed.length === 0,
  };
}

/** The fifth check for one cited case (the "Records" table's column). */
export type RowSigned =
  /** A draft: not signed yet. */
  | "draft"
  /** This case's signed record is there and its history unbroken up to it, and the signature holds. */
  | "ok"
  /** The report-level signature fails (or there is none), whatever this case's history says. */
  | "report"
  /** The signature holds, but this case's history no longer holds its signed record unbroken. */
  | "history"
  /** The signature holds, but it sealed no record of this case. */
  | "absent";

export function rowSigned(c: SignedCheck, caseId: string): RowSigned {
  if (c.state === "draft") return "draft";
  if (c.state === "unsigned" || !c.signature?.ok) return "report";
  if (c.heads.changed.some((h) => h.caseId === caseId)) return "history";
  return c.heads.caseIds.includes(caseId) ? "ok" : "absent";
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * "BAR-0003", "BAR-0003, BAR-0007 and 2 others": refs only for cases the report names (at most 3), the rest counted.
 * Empty when the report names none of them.
 */
export function headsPhrase(changed: readonly SignedHeadResult[]): string {
  const shown = changed.map((h) => h.ref).filter((r): r is string => !!r).slice(0, 3);
  if (shown.length === 0) return "";
  const rest = changed.length - shown.length;
  const parts = rest > 0 ? [...shown, `${rest} ${plural(rest, "other", "others")}`] : shown;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Why the fifth check fails, as short plain clauses ("the lead's own text changed", ...). Empty when it passes or
 * the report is a draft.
 */
export function signedReasons(c: SignedCheck): string[] {
  if (c.state === "draft" || c.ok) return [];
  if (c.state === "unsigned") return ["it was signed off without AccessLoop's signature"];
  const sig = c.signature!;
  const out: string[] = [];
  if (!c.keysAvailable) out.push("this server has no signing key to check the signature with");
  else if (!sig.keyKnown) out.push("it was signed with a key AccessLoop doesn't publish");
  else if (!sig.signatureOk) out.push("the signature doesn't match the signed fingerprint");
  if (!sig.parts.manifest) out.push("its frozen records changed");
  if (!sig.parts.content) out.push("its sentences changed");
  if (!sig.parts.leadText) out.push("the lead's own text changed");
  if (!sig.parts.signedAt) out.push("its sign-off date changed");
  if (!sig.rootOk && Object.values(sig.parts).every(Boolean)) out.push("the signed values were changed");
  const n = c.heads.changed.length;
  if (n > 0) {
    const which = headsPhrase(c.heads.changed);
    out.push(`${n} case ${plural(n, "history", "histories")} changed after sign-off${which ? ` (${which})` : ""}`);
  }
  const u = c.heads.unsealed.length;
  if (u > 0) {
    const shown = c.heads.unsealed.slice(0, 3);
    const rest = u - shown.length;
    const which = rest > 0 ? [...shown, `${rest} ${plural(rest, "other", "others")}`] : shown;
    const words = which.length === 1 ? which[0] : `${which.slice(0, -1).join(", ")} and ${which[which.length - 1]}`;
    out.push(`${u} cited ${plural(u, "case was", "cases were")} not sealed at sign-off (${words})`);
  }
  return out;
}

/** The status line's clause for a failing fifth check, or null. */
export function signedClause(c: SignedCheck): string | null {
  const reasons = signedReasons(c);
  if (reasons.length === 0) return null;
  if (c.state === "unsigned") return `${reasons[0]}, so it can't be checked against what was signed`;
  return `it no longer matches what AccessLoop signed at sign-off (${reasons.join("; ")})`;
}
