// The server's environment, checked once at boot (docs/phase7-prompt.md T3 item 1; docs/decisions.md 2026-10-20).
//
// instrumentation.ts register() calls assertEnv() when a server instance starts (`next start`, `next dev`, each
// Vercel cold start; Next never runs it during `next build`), so a missing or malformed setting stops the server with
// one clear message instead of failing every public submission in front of a user later. Every message names the
// variable and the rule it breaks, NEVER its value.
//
// It is also the ONE place the newer secrets are read: secretFromEnv("RETEST_LINK_SECRET" | "CRON_SECRET" |
// "REPORT_SIGNING_KEY"). In AUTH_MODE=local on this computer (VERCEL unset) a missing one is DERIVED from
// SESSION_SECRET with HKDF-SHA256 (deriveLocalSecret below), so an existing .env.local keeps working without edits;
// anywhere else (Vercel, AUTH_MODE=clerk) it must be set explicitly and assertEnv() refuses to start without it.
// lib/report/signing-key.ts reads REPORT_SIGNING_KEY through secretFromEnv too, and REPORT_SIGNING_KEY_CREATED through
// signingKeyCreatedIso(), so the boot check and sign-off accept exactly the same values.
//
// Server-only (node:crypto). Never import it from a client component.
import { createPrivateKey, hkdfSync } from "node:crypto";
import { z } from "zod";
import { effectiveBackend } from "@/lib/ai/backend";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export interface EnvProblem {
  /** The variable's name, e.g. "IP_SALT". */
  name: string;
  /** What is wrong, in words. Never contains the value. */
  problem: string;
}

/** Secrets added in Phase 7 that local mode may derive from SESSION_SECRET instead of reading them. */
export const DERIVABLE_SECRETS = ["RETEST_LINK_SECRET", "CRON_SECRET", "REPORT_SIGNING_KEY"] as const;
export type DerivableSecret = (typeof DERIVABLE_SECRETS)[number];

/** Minimum length of every random string secret (`npm run local:setup` writes 43 characters). */
export const MIN_SECRET_LENGTH = 32;

const GENERATE_HINT = `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;

// Every field is a trimmed string or undefined (an empty `KEY=` line counts as unset). The rules themselves run in
// ONE superRefine below, so every problem is reported at once and each message is ours (zod's own messages can
// quote the input).
const text = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined), z.string().optional());

const FIELDS = [
  "AUTH_MODE",
  "DATABASE_URL",
  "SESSION_SECRET",
  "ENCRYPTION_KEY",
  "RECEIPT_PEPPER",
  "IP_SALT",
  "FAKE_EMAIL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "FAKE_LLM",
  "AI_BACKEND",
  "ANTHROPIC_API_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "VERCEL",
  "VERCEL_ENV",
  "SEED_ALLOW_RESET",
  "APP_URL",
  "AI_GLOBAL_HOURLY_LIMIT",
  "ORG_DAILY_SUBMISSION_LIMIT",
  "CRON_EXPIRE_RETEST",
  ...DERIVABLE_SECRETS,
  "REPORT_SIGNING_KEY_CREATED",
] as const;
type Field = (typeof FIELDS)[number];
type Fields = Partial<Record<Field, string>>;

const ENV_SCHEMA = z
  .object(Object.fromEntries(FIELDS.map((f) => [f, text])) as Record<Field, typeof text>)
  .superRefine((raw, ctx) => {
    const env = raw as Fields;
    const add = (name: Field, problem: string) => ctx.addIssue({ code: "custom", path: [name], message: problem });
    const onVercel = !!env.VERCEL;

    // Auth mode. Local sign-in is for this computer only (CLAUDE.md "Auth"), so it is refused on Vercel.
    if (!env.AUTH_MODE) add("AUTH_MODE", 'is not set. Use "local" on this computer, "clerk" when going live.');
    else if (env.AUTH_MODE !== "local" && env.AUTH_MODE !== "clerk") add("AUTH_MODE", 'must be "local" or "clerk".');
    else if (env.AUTH_MODE === "local" && onVercel) {
      add("AUTH_MODE", 'is "local", which only works on this computer and is refused on Vercel. Use "clerk".');
    }
    if (env.AUTH_MODE === "clerk") {
      if (!env.CLERK_SECRET_KEY) add("CLERK_SECRET_KEY", "is not set (needed when AUTH_MODE=clerk).");
      if (!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
        add("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "is not set (needed when AUTH_MODE=clerk).");
      }
    }

    // Database: the app role's URL. On Vercel the database is remote, so TLS is required (.env.example).
    if (!env.DATABASE_URL) add("DATABASE_URL", "is not set (the app role's connection, see .env.example).");
    else {
      const url = parseUrl(env.DATABASE_URL);
      if (!url || (url.protocol !== "postgres:" && url.protocol !== "postgresql:")) {
        add("DATABASE_URL", "must be a postgres:// or postgresql:// URL.");
      } else if (onVercel && !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) {
        add("DATABASE_URL", "must end with ?sslmode=require (or verify-full) on Vercel: the database is reached over the internet.");
      }
    }

    // Secrets every mode needs.
    for (const name of ["SESSION_SECRET", "RECEIPT_PEPPER", "IP_SALT"] as const) {
      const v = env[name];
      if (!v) add(name, `is not set. Generate one with: ${GENERATE_HINT}`);
      else if (v.length < MIN_SECRET_LENGTH) add(name, `must be at least ${MIN_SECRET_LENGTH} characters. Generate one with: ${GENERATE_HINT}`);
    }
    if (!env.ENCRYPTION_KEY) add("ENCRYPTION_KEY", `is not set (32 random bytes, base64). Generate one with: ${GENERATE_HINT}`);
    else if (!decodesTo32Bytes(env.ENCRYPTION_KEY)) {
      add("ENCRYPTION_KEY", `must be base64 that decodes to exactly 32 bytes. Generate one with: ${GENERATE_HINT}`);
    }

    // Email: FAKE_EMAIL=1 logs to the Outbox; anything else sends through Resend (lib/email/send.ts reads the same).
    if (env.FAKE_EMAIL !== "1") {
      if (!env.RESEND_API_KEY) add("RESEND_API_KEY", "is not set (needed unless FAKE_EMAIL=1).");
      if (!env.EMAIL_FROM) add("EMAIL_FROM", 'is not set (needed unless FAKE_EMAIL=1), e.g. "AccessLoop <noreply@mail.your-domain.ca>".');
    }

    // AI: the effective backend is FAKE_LLM=1 ? fake : AI_BACKEND (lib/ai/backend.ts decides, the same function).
    let backend: string | null = null;
    try {
      backend = effectiveBackend(env);
    } catch {
      add("AI_BACKEND", 'is not a known AI backend. Use "fake", "claude-cli" or "api" (docs/domain.md §6.1), or set FAKE_LLM=1.');
    }
    if (backend === "api" && !env.ANTHROPIC_API_KEY) add("ANTHROPIC_API_KEY", "is not set (needed when the AI backend is api).");
    if (backend === "claude-cli" && onVercel) {
      add("AI_BACKEND", 'is "claude-cli", which is for the team\'s own local development only (docs/domain.md §6.1). Use "api" or set FAKE_LLM=1.');
    }

    // A production database is never reset by the seed.
    if (env.VERCEL_ENV === "production" && env.SEED_ALLOW_RESET === "1") {
      add("SEED_ALLOW_RESET", "is 1 in production (VERCEL_ENV=production). Set it to 0: only the dev/demo database may be reset.");
    }

    // The public base URL (lib/app-url.ts): an origin, https on Vercel. Self-hosted in clerk mode nothing else names
    // the app's address, and the last fallback (localhost) would put localhost links in every email.
    if (env.APP_URL) {
      const url = parseUrl(env.APP_URL);
      const origin = url && (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
      if (!origin || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
        add("APP_URL", "must be the app's address alone, like https://accessloop.example.ca (no path, query or login).");
      } else if (onVercel && url.protocol !== "https:") add("APP_URL", "must start with https:// on Vercel.");
    } else if (env.AUTH_MODE === "clerk" && !onVercel) {
      add("APP_URL", "is not set. Off Vercel, set it to the address people use (https://...), so emails link to the app and not to localhost.");
    }

    // Abuse and spend limits (lib/rate-limit.ts): whole numbers when set; unset means the default.
    for (const name of ["AI_GLOBAL_HOURLY_LIMIT", "ORG_DAILY_SUBMISSION_LIMIT"] as const) {
      const v = env[name];
      if (v !== undefined && !/^\d{1,9}$/.test(v)) add(name, "must be a whole number (0 or more), or unset for the default.");
    }

    // The daily job (app/api/cron/daily) expires re-test rounds only when this is exactly 1 (docs/domain.md §10).
    if (env.CRON_EXPIRE_RETEST !== undefined && env.CRON_EXPIRE_RETEST !== "0" && env.CRON_EXPIRE_RETEST !== "1") {
      add("CRON_EXPIRE_RETEST", "must be 1 (the daily job expires re-test rounds open for 60 days) or 0, or unset (it does not).");
    }

    // Phase 7 secrets: format-checked when set; required where they can't be derived.
    const derive = canDeriveSecrets(env);
    for (const name of DERIVABLE_SECRETS) {
      const v = env[name];
      if (!v) {
        if (!derive) add(name, `is not set. It is derived from SESSION_SECRET only in AUTH_MODE=local on this computer. ${secretHint(name)}`);
      } else {
        const problem = secretFormatProblem(name, v);
        if (problem) add(name, problem);
      }
    }
    // When the signing key was made (optional; shown in /.well-known/accessloop-signing-keys.json, docs/domain.md §8).
    if (env.REPORT_SIGNING_KEY_CREATED !== undefined && signingKeyCreatedIso(env.REPORT_SIGNING_KEY_CREATED) === null) {
      add("REPORT_SIGNING_KEY_CREATED", "is not a date. Use YYYY-MM-DD (or an ISO date-time), or leave it unset.");
    }
  });

/** Every problem with the environment, or none. Pure: pass any record (tests do). */
export function envProblems(source: EnvSource = process.env): EnvProblem[] {
  const result = ENV_SCHEMA.safeParse(source);
  if (result.success) return [];
  return result.error.issues.map((i) => ({ name: String(i.path[0] ?? "environment"), problem: i.message }));
}

export class EnvError extends Error {
  readonly problems: EnvProblem[];
  constructor(problems: EnvProblem[]) {
    super(formatEnvProblems(problems));
    this.name = "EnvError";
    this.problems = problems;
  }
}

/** The startup message: one line per problem, names only. */
export function formatEnvProblems(problems: EnvProblem[]): string {
  const n = problems.length;
  return [
    `AccessLoop can't start: ${n} setting${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} fixing (values are never printed).`,
    ...problems.map((p) => `  - ${p.name} ${p.problem}`),
    "Set them in .env.local (`npm run local:setup` writes the local ones) or in the host's environment settings.",
    ".env.example documents every variable.",
  ].join("\n");
}

/** Throws an EnvError listing every problem; returns quietly when the environment is complete. */
export function assertEnv(source: EnvSource = process.env): void {
  const problems = envProblems(source);
  if (problems.length > 0) throw new EnvError(problems);
}

// ---------- Phase 7 secrets ----------

/** True when a missing Phase 7 secret may be derived: AUTH_MODE=local on this computer (VERCEL unset). */
export function canDeriveSecrets(source: EnvSource = process.env): boolean {
  return (source.AUTH_MODE ?? "").trim() === "local" && !source.VERCEL;
}

/**
 * The shared local derivation: HKDF-SHA256 with ikm = SESSION_SECRET (UTF-8), an empty salt and info = the
 * variable's name (UTF-8, e.g. "CRON_SECRET"), `length` bytes. Deterministic, so every process on this computer
 * (the app, tsx scripts, e2e) gets the same value from the same .env.local, and a different one for each name.
 */
export function deriveLocalSecret(sessionSecret: string, name: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(sessionSecret, "utf8"), Buffer.alloc(0), Buffer.from(name, "utf8"), length));
}

// PKCS#8 DER for an Ed25519 private key is this fixed 16-byte header followed by the 32-byte seed (RFC 8410).
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** An Ed25519 private key in PKCS#8 DER, from a 32-byte seed (node:crypto reads it with createPrivateKey). */
export function ed25519Pkcs8FromSeed(seed: Buffer): Buffer {
  if (seed.length !== 32) throw new Error("an Ed25519 seed is 32 bytes");
  return Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
}

/**
 * A Phase 7 secret: the variable when set, else (AUTH_MODE=local on this computer only) its local derivation:
 * RETEST_LINK_SECRET and CRON_SECRET as 32 bytes in base64url, REPORT_SIGNING_KEY as an Ed25519 PKCS#8 key in
 * base64 (the format the variable itself takes). Anywhere else a missing one throws an EnvError naming it.
 */
export function secretFromEnv(name: DerivableSecret, source: EnvSource = process.env): string {
  const set = source[name]?.trim();
  if (set) return set;
  const session = source.SESSION_SECRET?.trim();
  if (!canDeriveSecrets(source) || !session) {
    throw new EnvError([{ name, problem: `is not set. It is derived from SESSION_SECRET only in AUTH_MODE=local on this computer. ${secretHint(name)}` }]);
  }
  const bytes = deriveLocalSecret(session, name);
  return name === "REPORT_SIGNING_KEY" ? ed25519Pkcs8FromSeed(bytes).toString("base64") : bytes.toString("base64url");
}

/**
 * REPORT_SIGNING_KEY_CREATED as an ISO date-time: YYYY-MM-DD means midnight UTC that day; anything else must parse as
 * a date-time. null when it doesn't (or is blank).
 */
export function signingKeyCreatedIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : new Date(v);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function secretHint(name: DerivableSecret): string {
  return name === "REPORT_SIGNING_KEY"
    ? `Generate one with: node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64'))"`
    : `Generate one with: ${GENERATE_HINT}`;
}

function secretFormatProblem(name: DerivableSecret, value: string): string | null {
  if (name !== "REPORT_SIGNING_KEY") {
    return value.length < MIN_SECRET_LENGTH ? `must be at least ${MIN_SECRET_LENGTH} characters. ${secretHint(name)}` : null;
  }
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error("not base64");
    const key = createPrivateKey({ key: Buffer.from(value, "base64"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
    return null;
  } catch {
    return `must be an Ed25519 private key in PKCS#8 DER, base64. ${secretHint(name)}`;
  }
}

// ---------- helpers ----------

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The same decoding lib/crypto.ts uses (Buffer base64, which also reads base64url), plus a strict alphabet. */
function decodesTo32Bytes(value: string): boolean {
  return /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32;
}
