// The public keys that check a progress report's signature (docs/domain.md §8 "Signed at sign-off"): key ID,
// algorithm, created, the key as SPKI DER base64 and as a JWK. Public values only, never the private key. The key
// comes from the environment at request time (lib/report/signing-key.ts: REPORT_SIGNING_KEY, or in AUTH_MODE=local
// the key derived from SESSION_SECRET), so a build without secrets still works. No signing key: 503 in words.
import { loadReportSigner, publishedKey, SigningKeyError } from "@/lib/report/signing-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "access-control-allow-origin": "*",
};

export function GET() {
  try {
    const key = publishedKey(loadReportSigner());
    const body = {
      issuer: "AccessLoop",
      purpose: "Ed25519 keys that sign the root of a progress report at sign-off. The signature is over the 64 ASCII characters of the root.",
      keys: [key],
    };
    return new Response(`${JSON.stringify(body, null, 2)}\n`, { status: 200, headers: { ...HEADERS, "cache-control": "public, max-age=300" } });
  } catch (err) {
    if (!(err instanceof SigningKeyError)) throw err;
    console.error(`[signing-keys] no key to publish: ${err.message}`); // the variable's name only, never a value
    return new Response(`${JSON.stringify({ issuer: "AccessLoop", keys: [], error: "No report signing key is set up on this server." }, null, 2)}\n`, {
      status: 503,
      headers: { ...HEADERS, "cache-control": "no-store" },
    });
  }
}
