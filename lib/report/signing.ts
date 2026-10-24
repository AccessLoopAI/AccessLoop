// The signed root (docs/domain.md §8 "Signed at sign-off"). Pure apart from node:crypto: no database, no env.
//
// At sign-off (lib/report/edit.ts) AccessLoop seals, in one hash, the report and every case history of the org:
//
//   heads        = the hash of the last record of EVERY case history of the org at that moment, sorted (ASCII)
//   leadTextHash = sha256(canonicalJson({ areaText, consultationsText }))        the lead's own words
//   contentHash  = sha256(canonicalJson(reports.content without `signing`))     the sentences, sections, settings
//   root         = sha256(canonicalJson({ kind: "accessloop.report-root", version: 1, reportId, signedAt, heads,
//                                         manifestHash, leadTextHash, contentHash }))
//   signature    = Ed25519 over the 64 ASCII characters of `root` (base64)
//
// canonicalJson is the frozen one from lib/case-events.ts (sorted keys, no whitespace), so a third party can
// recompute every value with any JSON library. The root is the fingerprint the lead gives the regulator in the
// ACR s.16 notice: whoever controls the database later cannot rewrite a case history, the snapshot, the sentences
// or the lead's text without changing it, and cannot sign a new one without the key.
import { createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@/lib/case-events";
import { sha256Hex } from "@/lib/crypto";
import { keyIdOf } from "./signing-key";
import type { ReportSigning, SignedHead } from "./types";

export const ROOT_KIND = "accessloop.report-root";
export const ROOT_VERSION = 1;

export interface RootInputs {
  reportId: string;
  /** ISO date-time (= reports.signed_off_at). */
  signedAt: string;
  /** Head hashes in any order (sorted here). */
  heads: readonly string[];
  manifestHash: string;
  leadTextHash: string;
  contentHash: string;
}

/** The exact object whose canonical JSON is hashed into the root. */
export function rootStatement(i: RootInputs) {
  return {
    kind: ROOT_KIND,
    version: ROOT_VERSION,
    reportId: i.reportId,
    signedAt: i.signedAt,
    heads: [...i.heads].sort(),
    manifestHash: i.manifestHash,
    leadTextHash: i.leadTextHash,
    contentHash: i.contentHash,
  };
}

export function reportRoot(i: RootInputs): string {
  return sha256Hex(canonicalJson(rootStatement(i)));
}

/** The lead's text as stored (reports.area_text, reports.consultations_text). */
export function leadTextHash(areaText: unknown, consultationsText: unknown): string {
  return sha256Hex(canonicalJson({ areaText: areaText ?? {}, consultationsText: consultationsText ?? null }));
}

/** reports.content without its `signing` key (what the root covers). Anything that is not an object is kept as is. */
export function contentForSigning(content: unknown): unknown {
  if (!content || typeof content !== "object" || Array.isArray(content)) return content;
  const rest: Record<string, unknown> = { ...(content as Record<string, unknown>) };
  delete rest.signing;
  return rest;
}

export function contentHash(content: unknown): string {
  return sha256Hex(canonicalJson(contentForSigning(content)));
}

/** What is signed: the root's 64 hex characters as ASCII bytes. */
export function signedMessage(root: string): Buffer {
  return Buffer.from(root, "ascii");
}

export function signRoot(root: string, privateKey: KeyObject): string {
  return sign(null, signedMessage(root), privateKey).toString("base64");
}

/** Never throws: a malformed key or signature is simply not valid. */
export function rootSignatureValid(root: string, signature: string, publicKey: KeyObject): boolean {
  try {
    return verify(null, signedMessage(root), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

/** A public key from /.well-known/accessloop-signing-keys.json (`publicKey`: SPKI DER base64), or null. */
export function publicKeyFromSpki(spkiBase64: string): KeyObject | null {
  try {
    const key = createPublicKey({ key: Buffer.from(spkiBase64, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

/** Heads sorted by hash (the stored order; the root sorts the hashes again). */
export function sortHeads(heads: readonly SignedHead[]): SignedHead[] {
  return [...heads].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : a.caseId < b.caseId ? -1 : 1));
}

/** Seal and sign a report at sign-off. Pure: the caller loads the heads, the stored row and the signer. */
export function buildSigning(a: {
  reportId: string;
  signedAt: Date;
  heads: readonly SignedHead[];
  manifestHash: string;
  areaText: unknown;
  consultationsText: unknown;
  content: unknown;
  signer: { keyId: string; privateKey: KeyObject };
}): ReportSigning {
  const heads = sortHeads(a.heads);
  const signedAt = a.signedAt.toISOString();
  const lead = leadTextHash(a.areaText, a.consultationsText);
  const body = contentHash(a.content);
  const root = reportRoot({ reportId: a.reportId, signedAt, heads: heads.map((h) => h.hash), manifestHash: a.manifestHash, leadTextHash: lead, contentHash: body });
  return {
    version: 1,
    alg: "Ed25519",
    keyId: a.signer.keyId,
    signedAt,
    root,
    signature: signRoot(root, a.signer.privateKey),
    manifestHash: a.manifestHash,
    leadTextHash: lead,
    contentHash: body,
    heads,
  };
}

const HEX64 = /^[0-9a-f]{64}$/;

export const SigningShape = z.object({
  version: z.literal(1),
  alg: z.literal("Ed25519"),
  keyId: z.string().min(1).max(100),
  signedAt: z.string(),
  root: z.string().regex(HEX64),
  signature: z.string().min(1).max(200),
  manifestHash: z.string(),
  leadTextHash: z.string(),
  contentHash: z.string(),
  heads: z.array(z.object({ caseId: z.string(), seq: z.number().int(), hash: z.string() })),
});

/** content.signing when it has the stored shape, else null (none, or changed beyond reading). */
export function readSigning(content: unknown): ReportSigning | null {
  if (!content || typeof content !== "object") return null;
  const parsed = SigningShape.safeParse((content as { signing?: unknown }).signing);
  return parsed.success ? ((content as { signing: ReportSigning }).signing) : null;
}

/** What the stored row says now, checked against its signature (the database part, the heads, is the caller's). */
export interface SignatureCheck {
  /** The report carries a readable signature. */
  present: boolean;
  /** The signature's key is one of the published keys (and its id matches that key). */
  keyKnown: boolean;
  /** The root recomputed from the stored values equals the signed root. */
  rootOk: boolean;
  /** That recomputed root ("" when there is no signature to recompute it for). */
  recomputedRoot: string;
  /** The Ed25519 signature over the root is valid for that key. */
  signatureOk: boolean;
  /**
   * Each part, recomputed from the row as stored now. `manifest`: reports.manifest_hash is the signed one and, when
   * the snapshot is given, the snapshot as stored still hashes to it (so a changed snapshot fails here as in check 1).
   */
  parts: { manifest: boolean; leadText: boolean; content: boolean; signedAt: boolean };
  ok: boolean;
}

/**
 * Check a stored report's signature. `keys`: the published keys by key id. Uses the row as it is stored now (a
 * changed snapshot fingerprint, lead text or sentence makes the recomputed root differ). The heads are taken as
 * signed; whether every case history still contains its signed head is checked against case_events by the caller.
 */
export function checkSignature(
  row: { id: string; signedOffAt: Date | null; manifestHash: string; content: unknown; areaText: unknown; consultationsText: unknown; snapshot?: unknown },
  keys: ReadonlyMap<string, KeyObject>,
): SignatureCheck {
  const s = readSigning(row.content);
  const none: SignatureCheck = {
    present: false,
    keyKnown: false,
    rootOk: false,
    recomputedRoot: "",
    signatureOk: false,
    parts: { manifest: false, leadText: false, content: false, signedAt: false },
    ok: false,
  };
  if (!s) return none;
  const key = keys.get(s.keyId) ?? null;
  let keyKnown = false;
  try {
    keyKnown = !!key && keyIdOf(key) === s.keyId;
  } catch {
    keyKnown = false;
  }
  const parts = {
    manifest: row.manifestHash === s.manifestHash && (row.snapshot === undefined || sha256Hex(canonicalJson(row.snapshot)) === s.manifestHash),
    leadText: leadTextHash(row.areaText, row.consultationsText) === s.leadTextHash,
    content: contentHash(row.content) === s.contentHash,
    signedAt: !!row.signedOffAt && row.signedOffAt.toISOString() === s.signedAt,
  };
  const recomputed = reportRoot({
    reportId: row.id,
    signedAt: row.signedOffAt ? row.signedOffAt.toISOString() : s.signedAt,
    heads: s.heads.map((h) => h.hash),
    manifestHash: row.manifestHash,
    leadTextHash: leadTextHash(row.areaText, row.consultationsText),
    contentHash: contentHash(row.content),
  });
  const rootOk = recomputed === s.root;
  const signatureOk = keyKnown && !!key && rootSignatureValid(s.root, s.signature, key);
  return { present: true, keyKnown, rootOk, recomputedRoot: recomputed, signatureOk, parts, ok: rootOk && signatureOk && Object.values(parts).every(Boolean) };
}

/** "3f2a 9c1b ..." for reading aloud or typing into a notice (the value is the 64 characters without spaces). */
export function groupedHex(hex: string, size = 4): string {
  return hex.match(new RegExp(`.{1,${size}}`, "g"))?.join(" ") ?? hex;
}
