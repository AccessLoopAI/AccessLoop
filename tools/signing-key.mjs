#!/usr/bin/env node
// Make or inspect the report signing key (docs/domain.md §8 "Signed at sign-off"). Dependency-free (node:crypto).
// scripts/local.ts is frozen, so key generation lives here.
//
//   node tools/signing-key.mjs --write <env file>   add a NEW Ed25519 key to that file as REPORT_SIGNING_KEY (PKCS8
//                                                   DER, base64) and REPORT_SIGNING_KEY_CREATED (today), only if the
//                                                   file has no REPORT_SIGNING_KEY yet. Prints the key ID and the
//                                                   public key, never the private key.
//   node --env-file=<env file> tools/signing-key.mjs --show
//                                                   print the key ID and public key of REPORT_SIGNING_KEY.
//
// In AUTH_MODE=local the app derives a key from SESSION_SECRET when REPORT_SIGNING_KEY is unset, so the local
// prototype needs none. A deployed site needs one: write it to a file, then copy the two lines into the host's
// environment settings yourself (never commit the file).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

function describe(publicKey) {
  const x = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return {
    keyId: `ed25519-${createHash("sha256").update(x).digest("hex").slice(0, 16)}`,
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [mode, file] = process.argv.slice(2);

if (mode === "--write") {
  if (!file) fail("Usage: node tools/signing-key.mjs --write <env file>");
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (/^\s*REPORT_SIGNING_KEY\s*=/m.test(current)) fail(`${file} already has a REPORT_SIGNING_KEY. Nothing was changed.`);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const created = new Date().toISOString().slice(0, 10);
  const sep = current && !current.endsWith("\n") ? "\n" : "";
  appendFileSync(file, `${sep}REPORT_SIGNING_KEY=${pkcs8}\nREPORT_SIGNING_KEY_CREATED=${created}\n`, { mode: 0o600 });
  const d = describe(publicKey);
  console.log(`Added REPORT_SIGNING_KEY and REPORT_SIGNING_KEY_CREATED to ${file}.`);
  console.log(`Key ID: ${d.keyId}`);
  console.log(`Public key (SPKI, base64): ${d.publicKey}`);
} else if (mode === "--show") {
  const value = process.env.REPORT_SIGNING_KEY?.trim();
  if (!value) fail("REPORT_SIGNING_KEY is not set. (In AUTH_MODE=local the app derives its key; see /.well-known/accessloop-signing-keys.json.)");
  let key;
  try {
    key = createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
  } catch {
    fail("REPORT_SIGNING_KEY is not a PKCS8 private key (DER, base64).");
  }
  if (key.asymmetricKeyType !== "ed25519") fail("REPORT_SIGNING_KEY is not an Ed25519 key.");
  const d = describe(createPublicKey(key));
  console.log(`Key ID: ${d.keyId}`);
  console.log(`Public key (SPKI, base64): ${d.publicKey}`);
} else {
  fail("Usage: node tools/signing-key.mjs --write <env file> | --show");
}
