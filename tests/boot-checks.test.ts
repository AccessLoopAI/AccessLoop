// lib/boot-checks.ts + lib/db-role.ts: the server refuses to start with a bad environment or an app role that would
// bypass row-level security (docs/decisions.md 2026-10-20). The database query is injected: no database here.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BootCheckError, describeDbError, runBootChecks } from "@/lib/boot-checks";
import { roleRefusal, type DbRoleRow } from "@/lib/db-role";
import { EnvError } from "@/lib/env";

const LOCAL_ENV: Record<string, string> = {
  AUTH_MODE: "local",
  DATABASE_URL: "postgres://accessloop_app:pw@127.0.0.1:54329/accessloop",
  SESSION_SECRET: "session-secret-0123456789abcdefghijklmnop",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  RECEIPT_PEPPER: "receipt-pepper-0123456789abcdefghijklmno",
  IP_SALT: "ip-salt-0123456789abcdefghijklmnopqrstuv",
  AI_BACKEND: "fake",
  FAKE_LLM: "1",
  FAKE_EMAIL: "1",
};

const row = (o: Partial<DbRoleRow> = {}): DbRoleRow => ({ rolname: "accessloop_app", rolsuper: false, rolbypassrls: false, rolcanlogin: true, ...o });

beforeEach(() => {
  for (const [k, v] of Object.entries(LOCAL_ENV)) vi.stubEnv(k, v);
  vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("roleRefusal", () => {
  it("accepts a NOSUPERUSER NOBYPASSRLS role and refuses the others, naming the attribute", () => {
    expect(roleRefusal(row(), "app")).toBeNull();
    expect(roleRefusal(row({ rolsuper: true }), "app")).toMatch(/"accessloop_app" has SUPERUSER, so row-level security/);
    expect(roleRefusal(row({ rolbypassrls: true }), "app")).toMatch(/has BYPASSRLS/);
    expect(roleRefusal(row({ rolname: "postgres", rolsuper: true, rolbypassrls: true }), "app")).toMatch(/"postgres" has SUPERUSER and BYPASSRLS/);
    expect(roleRefusal(undefined, "The app role")).toBe("The app role was not found in pg_roles.");
  });
});

describe("runBootChecks", () => {
  it("passes with a complete environment and the app role", async () => {
    await expect(runBootChecks(async () => [row()])).resolves.toBeUndefined();
  });

  it("checks the environment first: an EnvError, and the database is not asked", async () => {
    vi.stubEnv("IP_SALT", "");
    const query = vi.fn(async () => [row()]);
    await expect(runBootChecks(query)).rejects.toBeInstanceOf(EnvError);
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses a superuser or BYPASSRLS app role", async () => {
    await expect(runBootChecks(async () => [row({ rolname: "postgres", rolsuper: true })])).rejects.toThrow(
      /^AccessLoop can't start: The app's database role \(DATABASE_URL\) "postgres" has SUPERUSER/,
    );
    await expect(runBootChecks(async () => [row({ rolbypassrls: true })])).rejects.toBeInstanceOf(BootCheckError);
  });

  it("refuses to start when the database can't be reached, saying why without the URL", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:54329"), { code: "ECONNREFUSED" });
    const wrapped = Object.assign(new Error("Failed query: select ..."), { cause: refused });
    const err = (await runBootChecks(async () => {
      throw wrapped;
    }).then(
      () => null,
      (e: unknown) => e,
    )) as Error;
    expect(err).toBeInstanceOf(BootCheckError);
    expect(err.message).toContain("ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:54329");
    expect(err.message).not.toContain(":pw@");
  });
});

describe("describeDbError", () => {
  it("unwraps drizzle's wrapper to the driver's code and message", () => {
    expect(describeDbError(Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("boom"), { code: "57P01" }) }))).toBe("57P01: boom");
    expect(describeDbError("plain")).toBe("plain");
  });
});
