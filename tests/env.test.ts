// lib/env.ts: the boot-time environment check and the Phase 7 secret derivation (docs/decisions.md 2026-10-20).
import { createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DERIVABLE_SECRETS,
  EnvError,
  assertEnv,
  canDeriveSecrets,
  deriveLocalSecret,
  ed25519Pkcs8FromSeed,
  envProblems,
  formatEnvProblems,
  secretFromEnv,
  signingKeyCreatedIso,
  type EnvSource,
} from "@/lib/env";
import { loadReportSigner, SigningKeyError } from "@/lib/report/signing-key";

// Distinctive values, so a test can prove no message ever contains one.
const SECRET_VALUES = {
  SESSION_SECRET: "SESSIONvalue-never-printed-0123456789abcdef",
  RECEIPT_PEPPER: "PEPPERvalue-never-printed-0123456789abcdefg",
  IP_SALT: "SALTvalue-never-printed-0123456789abcdefghij",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  DATABASE_URL: "postgres://accessloop_app:DBPASSWORDnever@127.0.0.1:54329/accessloop",
};

/** What `npm run local:setup` writes (the parts lib/env.ts reads). */
const LOCAL: EnvSource = {
  AUTH_MODE: "local",
  ...SECRET_VALUES,
  AI_BACKEND: "fake",
  FAKE_LLM: "1",
  FAKE_EMAIL: "1",
  SEED_ALLOW_RESET: "1",
};

/** A going-live shape on Vercel: everything explicit. */
const VERCEL: EnvSource = {
  ...SECRET_VALUES,
  AUTH_MODE: "clerk",
  VERCEL: "1",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres://accessloop_app.ref:DBPASSWORDnever@pooler.example.com:6543/postgres?sslmode=require",
  CLERK_SECRET_KEY: "sk_test_CLERKSECRETnever",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_x",
  AI_BACKEND: "api",
  FAKE_LLM: "0",
  ANTHROPIC_API_KEY: "sk-ant-APIKEYnever",
  FAKE_EMAIL: "0",
  RESEND_API_KEY: "re_RESENDKEYnever",
  EMAIL_FROM: "AccessLoop <noreply@mail.example.ca>",
  SEED_ALLOW_RESET: "0",
  RETEST_LINK_SECRET: "RETESTvalue-never-printed-0123456789abcdef",
  CRON_SECRET: "CRONvalue-never-printed-0123456789abcdefghi",
  REPORT_SIGNING_KEY: ed25519Pkcs8FromSeed(randomBytes(32)).toString("base64"),
};

const names = (env: EnvSource) => envProblems(env).map((p) => p.name);

describe("envProblems", () => {
  it("accepts what local:setup writes, with no Phase 7 secret set (they are derived)", () => {
    expect(envProblems(LOCAL)).toEqual([]);
    expect(() => assertEnv(LOCAL)).not.toThrow();
  });

  it("accepts a complete going-live environment on Vercel", () => {
    expect(envProblems(VERCEL)).toEqual([]);
  });

  it("names every missing required setting at once", () => {
    expect(names({})).toEqual(
      expect.arrayContaining(["AUTH_MODE", "DATABASE_URL", "SESSION_SECRET", "ENCRYPTION_KEY", "RECEIPT_PEPPER", "IP_SALT", "RESEND_API_KEY", "EMAIL_FROM"]),
    );
    for (const name of ["DATABASE_URL", "SESSION_SECRET", "ENCRYPTION_KEY", "RECEIPT_PEPPER", "IP_SALT"]) {
      expect(names({ ...LOCAL, [name]: undefined }), name).toEqual([name]);
      expect(names({ ...LOCAL, [name]: "   " }), `${name} blank`).toEqual([name]);
    }
  });

  it("checks the form of each value", () => {
    // Not "local", so the Phase 7 secrets can't be derived either.
    expect(names({ ...LOCAL, AUTH_MODE: "both" })).toEqual(["AUTH_MODE", ...DERIVABLE_SECRETS]);
    expect(names({ ...LOCAL, DATABASE_URL: "mysql://x@y/z" })).toEqual(["DATABASE_URL"]);
    expect(names({ ...LOCAL, DATABASE_URL: "not a url" })).toEqual(["DATABASE_URL"]);
    expect(names({ ...LOCAL, IP_SALT: "short" })).toEqual(["IP_SALT"]);
    expect(names({ ...LOCAL, ENCRYPTION_KEY: randomBytes(16).toString("base64") })).toEqual(["ENCRYPTION_KEY"]);
    expect(names({ ...LOCAL, ENCRYPTION_KEY: "!".repeat(44) })).toEqual(["ENCRYPTION_KEY"]);
    // lib/crypto.ts decodes with Buffer's base64, which also reads base64url: so does the check.
    expect(names({ ...LOCAL, ENCRYPTION_KEY: randomBytes(32).toString("base64url") })).toEqual([]);
  });

  it("needs Resend only when FAKE_EMAIL is not 1", () => {
    expect(names({ ...LOCAL, FAKE_EMAIL: "0" })).toEqual(["RESEND_API_KEY", "EMAIL_FROM"]);
    expect(names({ ...LOCAL, FAKE_EMAIL: undefined, RESEND_API_KEY: "re_x", EMAIL_FROM: "a <b@c.ca>" })).toEqual([]);
  });

  it("needs ANTHROPIC_API_KEY only when the EFFECTIVE backend is api", () => {
    expect(names({ ...LOCAL, FAKE_LLM: "0", AI_BACKEND: "api" })).toEqual(["ANTHROPIC_API_KEY"]);
    expect(names({ ...LOCAL, FAKE_LLM: "1", AI_BACKEND: "api" })).toEqual([]); // FAKE_LLM=1 forces fake
    expect(names({ ...LOCAL, FAKE_LLM: "0", AI_BACKEND: "claude-cli" })).toEqual([]);
    expect(names({ ...LOCAL, FAKE_LLM: "0", AI_BACKEND: "gpt" })).toEqual(["AI_BACKEND"]);
  });

  it("needs the Clerk keys and explicit Phase 7 secrets in clerk mode (and, self-hosted, APP_URL)", () => {
    const clerk = { ...LOCAL, AUTH_MODE: "clerk" };
    expect(names(clerk)).toEqual(["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "APP_URL", ...DERIVABLE_SECRETS]);
  });

  it("checks APP_URL's form: an origin alone, https on Vercel; self-hosted clerk mode must set it", () => {
    expect(names({ ...LOCAL, APP_URL: "http://localhost:3101" })).toEqual([]);
    expect(names({ ...VERCEL, APP_URL: "https://accessloop.example.ca/" })).toEqual([]);
    for (const bad of ["accessloop.example.ca", "https://accessloop.example.ca/app", "https://x.ca/?a=1", "https://x.ca/#top", "ftp://x.ca", "https://u:p@x.ca"]) {
      expect(names({ ...LOCAL, APP_URL: bad }), bad).toEqual(["APP_URL"]);
    }
    expect(names({ ...VERCEL, APP_URL: "http://accessloop.example.ca" })).toEqual(["APP_URL"]);
    // On Vercel the deployment's own variables give the address (lib/app-url.ts), so it may stay unset.
    expect(names({ ...VERCEL, APP_URL: undefined })).toEqual([]);
    const selfHosted = { ...VERCEL, VERCEL: undefined, VERCEL_ENV: undefined };
    expect(names(selfHosted)).toEqual(["APP_URL"]);
    expect(names({ ...selfHosted, APP_URL: "https://accessloop.example.ca" })).toEqual([]);
  });

  it("checks the abuse and spend limits are whole numbers when set", () => {
    expect(names({ ...LOCAL, AI_GLOBAL_HOURLY_LIMIT: "300", ORG_DAILY_SUBMISSION_LIMIT: "0" })).toEqual([]);
    expect(names({ ...LOCAL, AI_GLOBAL_HOURLY_LIMIT: "-1" })).toEqual(["AI_GLOBAL_HOURLY_LIMIT"]);
    expect(names({ ...LOCAL, ORG_DAILY_SUBMISSION_LIMIT: "2.5" })).toEqual(["ORG_DAILY_SUBMISSION_LIMIT"]);
    expect(names({ ...LOCAL, ORG_DAILY_SUBMISSION_LIMIT: "lots" })).toEqual(["ORG_DAILY_SUBMISSION_LIMIT"]);
  });

  it("accepts CRON_EXPIRE_RETEST only as 1, 0 or unset (the daily job expires re-tests only with 1)", () => {
    for (const ok of ["1", "0", undefined, ""]) expect(names({ ...LOCAL, CRON_EXPIRE_RETEST: ok }), String(ok)).toEqual([]);
    for (const bad of ["yes", "true", "2"]) expect(names({ ...LOCAL, CRON_EXPIRE_RETEST: bad }), bad).toEqual(["CRON_EXPIRE_RETEST"]);
  });

  it("refuses local auth, a claude-cli backend and a missing sslmode on Vercel, and a seed reset in production", () => {
    expect(names({ ...VERCEL, AUTH_MODE: "local" })).toEqual(["AUTH_MODE"]);
    expect(names({ ...VERCEL, AI_BACKEND: "claude-cli" })).toEqual(["AI_BACKEND"]);
    expect(names({ ...VERCEL, DATABASE_URL: VERCEL.DATABASE_URL!.replace("?sslmode=require", "") })).toEqual(["DATABASE_URL"]);
    expect(names({ ...VERCEL, DATABASE_URL: VERCEL.DATABASE_URL!.replace("require", "verify-full") })).toEqual([]);
    expect(names({ ...VERCEL, SEED_ALLOW_RESET: "1" })).toEqual(["SEED_ALLOW_RESET"]);
    expect(names({ ...VERCEL, VERCEL_ENV: "preview", SEED_ALLOW_RESET: "1" })).toEqual([]);
    // sslmode is not required on this computer.
    expect(names({ ...LOCAL, DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" })).toEqual([]);
  });

  it("requires every Phase 7 secret on Vercel and checks its form wherever it is set", () => {
    for (const name of DERIVABLE_SECRETS) {
      expect(names({ ...VERCEL, [name]: undefined }), name).toEqual([name]);
    }
    expect(names({ ...LOCAL, CRON_SECRET: "short" })).toEqual(["CRON_SECRET"]);
    expect(names({ ...LOCAL, REPORT_SIGNING_KEY: randomBytes(48).toString("base64") })).toEqual(["REPORT_SIGNING_KEY"]);
    const ed = createPrivateKey({ key: ed25519Pkcs8FromSeed(randomBytes(32)), format: "der", type: "pkcs8" });
    expect(ed.asymmetricKeyType).toBe("ed25519"); // the helper's own output is Ed25519...
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" });
    expect(names({ ...LOCAL, REPORT_SIGNING_KEY: ec.toString("base64") })).toEqual(["REPORT_SIGNING_KEY"]); // ...an EC key is not
  });

  it("checks REPORT_SIGNING_KEY_CREATED is a date when set (optional everywhere), without printing it", () => {
    for (const ok of ["2026-10-20", "2026-10-20T14:30:00Z", undefined, ""]) {
      expect(names({ ...VERCEL, REPORT_SIGNING_KEY_CREATED: ok }), String(ok)).toEqual([]);
    }
    expect(names({ ...LOCAL, REPORT_SIGNING_KEY_CREATED: "2026-10-20" })).toEqual([]);
    for (const bad of ["soonNEVERprinted", "2026-13-45", "yesterday"]) {
      expect(names({ ...VERCEL, REPORT_SIGNING_KEY_CREATED: bad }), bad).toEqual(["REPORT_SIGNING_KEY_CREATED"]);
    }
    expect(new EnvError(envProblems({ ...VERCEL, REPORT_SIGNING_KEY_CREATED: "soonNEVERprinted" })).message).not.toContain("soonNEVERprinted");
    expect(signingKeyCreatedIso("2026-10-20")).toBe("2026-10-20T00:00:00.000Z");
    expect(signingKeyCreatedIso("   ")).toBeNull();
  });

  it("agrees with the report signer: what the boot check accepts, sign-off can use, and the reverse", () => {
    // The local derivation is the same key whether lib/env.ts or lib/report/signing-key.ts is asked.
    const derived = loadReportSigner(LOCAL);
    expect(derived.source).toBe("local-derived");
    expect(loadReportSigner({ ...LOCAL, REPORT_SIGNING_KEY: secretFromEnv("REPORT_SIGNING_KEY", LOCAL) }).keyId).toBe(derived.keyId);
    // A complete going-live environment signs with its configured key and creation date.
    const live = loadReportSigner({ ...VERCEL, REPORT_SIGNING_KEY_CREATED: "2026-10-20" });
    expect(live).toMatchObject({ source: "configured", created: "2026-10-20T00:00:00.000Z" });
    // Where the boot check refuses the key or its date, sign-off refuses it too.
    for (const env of [{ ...VERCEL, REPORT_SIGNING_KEY: undefined }, { ...LOCAL, AUTH_MODE: "clerk" }, { ...VERCEL, REPORT_SIGNING_KEY_CREATED: "soon" }]) {
      expect(envProblems(env).length).toBeGreaterThan(0);
      expect(() => loadReportSigner(env)).toThrow(SigningKeyError);
    }
  });

  it("never puts a value into a message", () => {
    const broken: EnvSource = {
      ...VERCEL,
      AUTH_MODE: "local",
      IP_SALT: "SHORTsaltNEVER",
      AI_BACKEND: "UNKNOWNbackendNEVER",
      FAKE_LLM: "0",
      CRON_SECRET: "SHORTcronNEVER",
      REPORT_SIGNING_KEY: "BADkeyNEVER",
      DATABASE_URL: "postgres://u:DBPASSWORDnever@host/db",
    };
    const text = new EnvError(envProblems(broken)).message;
    expect(envProblems(broken).length).toBeGreaterThan(4);
    for (const v of [...Object.values(SECRET_VALUES), ...Object.values(broken)]) {
      if (v && v.length > 4 && !["local", "clerk", "production"].includes(v)) expect(text).not.toContain(v);
    }
    expect(text).not.toContain("DBPASSWORD");
  });
});

describe("formatEnvProblems", () => {
  it("says how many settings, one line each, and where to set them", () => {
    const one = formatEnvProblems([{ name: "IP_SALT", problem: "is not set." }]);
    expect(one).toMatch(/^AccessLoop can't start: 1 setting needs fixing \(values are never printed\)\.\n {2}- IP_SALT is not set\.\n/);
    expect(formatEnvProblems([{ name: "A", problem: "x" }, { name: "B", problem: "y" }])).toContain("2 settings need fixing");
    expect(one).toContain(".env.example");
  });

  it("is what assertEnv throws", () => {
    try {
      assertEnv({ ...LOCAL, IP_SALT: undefined });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      expect((e as EnvError).problems.map((p) => p.name)).toEqual(["IP_SALT"]);
    }
  });
});

describe("Phase 7 secrets", () => {
  it("derive only in AUTH_MODE=local off Vercel", () => {
    expect(canDeriveSecrets(LOCAL)).toBe(true);
    expect(canDeriveSecrets({ ...LOCAL, VERCEL: "1" })).toBe(false);
    expect(canDeriveSecrets({ ...LOCAL, AUTH_MODE: "clerk" })).toBe(false);
  });

  it("is HKDF-SHA256(SESSION_SECRET, empty salt, info = the name), 32 bytes, deterministic and per name", () => {
    const expected = Buffer.from(hkdfSync("sha256", SECRET_VALUES.SESSION_SECRET, "", "CRON_SECRET", 32));
    expect(deriveLocalSecret(SECRET_VALUES.SESSION_SECRET, "CRON_SECRET").equals(expected)).toBe(true);
    expect(secretFromEnv("CRON_SECRET", LOCAL)).toBe(expected.toString("base64url"));
    expect(secretFromEnv("CRON_SECRET", LOCAL)).toBe(secretFromEnv("CRON_SECRET", { ...LOCAL }));
    expect(secretFromEnv("CRON_SECRET", LOCAL)).not.toBe(secretFromEnv("RETEST_LINK_SECRET", LOCAL));
    expect(secretFromEnv("CRON_SECRET", LOCAL)).not.toBe(secretFromEnv("CRON_SECRET", { ...LOCAL, SESSION_SECRET: `${SECRET_VALUES.SESSION_SECRET}x` }));
    expect(secretFromEnv("CRON_SECRET", LOCAL)).toHaveLength(43);
  });

  it("derives REPORT_SIGNING_KEY as a working Ed25519 PKCS#8 key (base64)", () => {
    const b64 = secretFromEnv("REPORT_SIGNING_KEY", LOCAL);
    expect(names({ ...LOCAL, REPORT_SIGNING_KEY: b64 })).toEqual([]);
    const key = createPrivateKey({ key: Buffer.from(b64, "base64"), format: "der", type: "pkcs8" });
    const sig = sign(null, Buffer.from("root"), key);
    expect(verify(null, Buffer.from("root"), createPublicKey(key), sig)).toBe(true);
    expect(() => ed25519Pkcs8FromSeed(randomBytes(31))).toThrow();
  });

  it("uses a value that is set, and refuses to derive elsewhere (naming the variable, not SESSION_SECRET's value)", () => {
    expect(secretFromEnv("CRON_SECRET", { ...LOCAL, CRON_SECRET: "  explicit-cron-secret-0123456789abcdef  " })).toBe("explicit-cron-secret-0123456789abcdef");
    for (const env of [{ ...LOCAL, VERCEL: "1" }, { ...LOCAL, AUTH_MODE: "clerk" }, { ...LOCAL, SESSION_SECRET: undefined }]) {
      try {
        secretFromEnv("RETEST_LINK_SECRET", env);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(EnvError);
        expect((e as Error).message).toContain("RETEST_LINK_SECRET");
        expect((e as Error).message).not.toContain(SECRET_VALUES.SESSION_SECRET);
      }
    }
  });
});
