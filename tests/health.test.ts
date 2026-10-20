// lib/health.ts: the body of GET /api/health carries modes and a commit id only (docs/decisions.md 2026-10-20).
import { describe, expect, it } from "vitest";
import { describeHealth } from "@/lib/health";

const LOCAL = { AUTH_MODE: "local", AI_BACKEND: "fake", FAKE_LLM: "1", FAKE_EMAIL: "1" };

describe("describeHealth", () => {
  it("says what this instance runs with, and whether the database answered", () => {
    expect(describeHealth(true, LOCAL)).toEqual({ ok: true, db: "ok", aiBackend: "fake", emailMode: "fake", authMode: "local", commit: null });
    expect(describeHealth(false, LOCAL)).toMatchObject({ ok: false, db: "unreachable" });
  });

  it("reports the effective AI backend and the email and auth modes", () => {
    expect(describeHealth(true, { ...LOCAL, FAKE_LLM: "0", AI_BACKEND: "api" }).aiBackend).toBe("api");
    expect(describeHealth(true, { ...LOCAL, FAKE_LLM: "1", AI_BACKEND: "api" }).aiBackend).toBe("fake");
    expect(describeHealth(true, { ...LOCAL, FAKE_LLM: "0", AI_BACKEND: "nope" }).aiBackend).toBe("invalid");
    expect(describeHealth(true, { ...LOCAL, FAKE_EMAIL: "0" }).emailMode).toBe("resend");
    expect(describeHealth(true, { ...LOCAL, AUTH_MODE: "clerk" }).authMode).toBe("clerk");
    expect(describeHealth(true, { ...LOCAL, AUTH_MODE: undefined }).authMode).toBe("unset");
  });

  it("shortens a deployed commit and ignores anything that isn't one", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(describeHealth(true, { ...LOCAL, VERCEL_GIT_COMMIT_SHA: sha }).commit).toBe("0123456789ab");
    expect(describeHealth(true, { ...LOCAL, GITHUB_SHA: sha.toUpperCase() }).commit).toBe("0123456789ab");
    expect(describeHealth(true, { ...LOCAL, VERCEL_GIT_COMMIT_SHA: "<script>" }).commit).toBeNull();
  });

  it("never carries a secret or a URL, whatever the environment holds", () => {
    const env = {
      ...LOCAL,
      DATABASE_URL: "postgres://accessloop_app:DBPASSWORD@db.example:6543/postgres",
      SESSION_SECRET: "SESSIONSECRETVALUE",
      ANTHROPIC_API_KEY: "sk-ant-KEYVALUE",
      RESEND_API_KEY: "re_KEYVALUE",
      CLERK_SECRET_KEY: "sk_test_CLERKVALUE",
    };
    const text = JSON.stringify(describeHealth(true, env));
    for (const v of ["DBPASSWORD", "db.example", "SESSIONSECRETVALUE", "KEYVALUE", "CLERKVALUE"]) expect(text).not.toContain(v);
    expect(Object.keys(describeHealth(true, env)).sort()).toEqual(["aiBackend", "authMode", "commit", "db", "emailMode", "ok"]);
  });
});
