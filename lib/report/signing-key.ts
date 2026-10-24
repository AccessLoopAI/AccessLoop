// The report signing key (docs/domain.md §8 "Signed at sign-off"). Server-only (node:crypto, no dependency).
//
//   REPORT_SIGNING_KEY          an Ed25519 private key, PKCS8 DER, base64 (tools/signing-key.mjs makes one). Required
//                               on Vercel and whenever AUTH_MODE is not "local".
//   REPORT_SIGNING_KEY_CREATED  optional: when that key was made (YYYY-MM-DD or ISO), shown in the published key list.
//
// Both are read and checked through lib/env.ts, so the boot check (assertEnv) and sign-off accept exactly the same
// values: secretFromEnv("REPORT_SIGNING_KEY") gives the configured key, or, in AUTH_MODE=local on this computer
// (VERCEL unset), the shared local derivation: seed = HKDF-SHA256(ikm = SESSION_SECRET, salt = empty,
// info = "REPORT_SIGNING_KEY", 32 bytes) used as the Ed25519 private key's seed (lib/env.ts deriveLocalSecret). Same
// machine, same secret, same key, so local signatures stay checkable across restarts and an existing .env.local
// keeps working.
//
// Errors name the variable, never a value. The key ID is public: "ed25519-" + the first 16 hex characters of
// sha256(the raw 32-byte public key).
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { canDeriveSecrets, ed25519Pkcs8FromSeed, EnvError, secretFromEnv, signingKeyCreatedIso } from "@/lib/env";

/** The variables read (process.env, or a plain object in tests). */
export type Env = Readonly<Record<string, string | undefined>>;

export class SigningKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SigningKeyError";
  }
}

export interface ReportSigner {
  keyId: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** REPORT_SIGNING_KEY_CREATED as an ISO date-time, or null (not given; always null for a derived local key). */
  created: string | null;
  /** configured: REPORT_SIGNING_KEY; local-derived: AUTH_MODE=local without one (a prototype key, never for a live site). */
  source: "configured" | "local-derived";
}

/** An Ed25519 private key from its 32-byte seed (the PKCS8 wrapping is lib/env.ts ed25519Pkcs8FromSeed). */
export function ed25519FromSeed(seed: Buffer): KeyObject {
  if (seed.length !== 32) throw new SigningKeyError("An Ed25519 seed must be 32 bytes");
  return createPrivateKey({ key: ed25519Pkcs8FromSeed(seed), format: "der", type: "pkcs8" });
}

/** The raw 32-byte Ed25519 public key (the JWK `x`). */
export function rawPublicKey(publicKey: KeyObject): Buffer {
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new SigningKeyError("Not an Ed25519 public key");
  return Buffer.from(jwk.x, "base64url");
}

export function keyIdOf(publicKey: KeyObject): string {
  return `ed25519-${createHash("sha256").update(rawPublicKey(publicKey)).digest("hex").slice(0, 16)}`;
}

const NOT_ED25519 = "REPORT_SIGNING_KEY is not an Ed25519 private key (PKCS8 DER, base64)";

function signerFrom(privateKey: KeyObject, created: string | null, source: ReportSigner["source"]): ReportSigner {
  if (privateKey.asymmetricKeyType !== "ed25519") throw new SigningKeyError(NOT_ED25519);
  const publicKey = createPublicKey(privateKey);
  return { keyId: keyIdOf(publicKey), privateKey, publicKey, created, source };
}

function createdFrom(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  const at = signingKeyCreatedIso(value);
  if (!at) throw new SigningKeyError("REPORT_SIGNING_KEY_CREATED is not a date (YYYY-MM-DD or an ISO date-time)");
  return at;
}

let cached: { from: string; signer: ReportSigner } | null = null;

/**
 * The signer the app uses now, from the environment. Throws SigningKeyError (a text-free configuration message)
 * when there is none: REPORT_SIGNING_KEY missing outside local mode, malformed, not Ed25519, or SESSION_SECRET
 * missing when the key would be derived.
 */
export function loadReportSigner(env: Env = process.env): ReportSigner {
  const configured = env.REPORT_SIGNING_KEY?.trim();
  const session = env.SESSION_SECRET?.trim();
  const derived = !configured && canDeriveSecrets(env);
  const from = configured
    ? `configured:${createHash("sha256").update(configured).digest("hex")}:${env.REPORT_SIGNING_KEY_CREATED ?? ""}`
    : derived && session
      ? `derived:${createHash("sha256").update(session).digest("hex")}`
      : "";
  if (from && cached?.from === from) return cached.signer;

  if (derived && !session) throw new SigningKeyError("SESSION_SECRET is not set (in AUTH_MODE=local, REPORT_SIGNING_KEY is derived from it)");
  let pkcs8: string;
  try {
    pkcs8 = secretFromEnv("REPORT_SIGNING_KEY", env);
  } catch (err) {
    if (err instanceof EnvError) {
      throw new SigningKeyError("REPORT_SIGNING_KEY is not set (an Ed25519 private key, PKCS8 DER, base64: see tools/signing-key.mjs)");
    }
    throw err;
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: Buffer.from(pkcs8, "base64"), format: "der", type: "pkcs8" });
  } catch {
    throw new SigningKeyError(NOT_ED25519);
  }
  const signer = derived ? signerFrom(key, null, "local-derived") : signerFrom(key, createdFrom(env.REPORT_SIGNING_KEY_CREATED), "configured");
  cached = { from, signer };
  return signer;
}

/**
 * The public keys a stored signature is checked with (/verify's fifth check): the keys this server publishes at
 * /.well-known/accessloop-signing-keys.json, by key ID. Empty when no signing key is set up (never throws). One key
 * for now; listing retired keys is roadmap (docs/decisions.md).
 */
export function verificationKeys(env: Env = process.env): Map<string, KeyObject> {
  try {
    const signer = loadReportSigner(env);
    return new Map([[signer.keyId, signer.publicKey]]);
  } catch (err) {
    if (err instanceof SigningKeyError) return new Map();
    throw err;
  }
}

/** One entry of /.well-known/accessloop-signing-keys.json. Public values only. */
export interface PublishedSigningKey {
  keyId: string;
  algorithm: "Ed25519";
  created: string | null;
  source: ReportSigner["source"];
  /** SubjectPublicKeyInfo DER, base64 (node:crypto createPublicKey({ key, format: "der", type: "spki" })). */
  publicKey: string;
  /** The same key as a JWK (RFC 8037). */
  jwk: { kty: "OKP"; crv: "Ed25519"; x: string; kid: string; alg: "EdDSA"; use: "sig" };
}

export function publishedKey(signer: Pick<ReportSigner, "keyId" | "publicKey" | "created" | "source">): PublishedSigningKey {
  return {
    keyId: signer.keyId,
    algorithm: "Ed25519",
    created: signer.created,
    source: signer.source,
    publicKey: signer.publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    jwk: { kty: "OKP", crv: "Ed25519", x: rawPublicKey(signer.publicKey).toString("base64url"), kid: signer.keyId, alg: "EdDSA", use: "sig" },
  };
}
