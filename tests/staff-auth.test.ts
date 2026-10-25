// lib/auth/staff.ts: "no adapter" (AUTH_MODE=clerk before Going live) is signed out, never a throw, so the public
// /verify page renders (review: app/verify/[reportId]/page.tsx called getStaffOrg() and it threw); and a local
// session never counts through a proxy (lib/auth/local-request.ts). docs/decisions.md 2026-10-20.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ headers: new Headers(), cookie: undefined as string | undefined, dbUsed: 0 }));

vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined) }),
}));
vi.mock("@/db/client", () => {
  // Any query: count it and find nothing (no org row), so getStaff() ends in null after reaching the database.
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "from", "where"]) chain[k] = () => chain;
  chain.limit = async () => [];
  return {
    db: new Proxy(chain, {
      get(target, prop) {
        if (prop === "select") state.dbUsed++;
        return target[prop as string];
      },
    }),
  };
});
vi.mock("@/db/tenant", () => ({ withOrg: async () => [] }));

import { signLocalSession } from "@/lib/auth/local-session";
import { getStaff, getStaffOrg } from "@/lib/auth/staff";

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-0123456789abcdefghijkl");
  vi.stubEnv("VERCEL", "");
  state.headers = new Headers({ host: "localhost:3000" });
  state.cookie = signLocalSession({ userId: "local_alex", orgClerkId: "local_org_maple" });
  state.dbUsed = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("getStaffOrg with no auth adapter (AUTH_MODE=clerk before Going live)", () => {
  it("is signed out: resolves null, does not throw, and never reads the local cookie's org", async () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(getStaffOrg()).resolves.toBeNull();
    await expect(getStaff()).resolves.toBeNull();
    expect(state.dbUsed).toBe(0);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1); // said once per server, with no request details
    warn.mockRestore();
  });
});

describe("getStaffOrg in AUTH_MODE=local", () => {
  beforeEach(() => vi.stubEnv("AUTH_MODE", "local"));

  it("looks the session up for a plain local request", async () => {
    await expect(getStaffOrg()).resolves.toBeNull(); // the mocked database has no such org
    expect(state.dbUsed).toBe(1);
  });

  it.each<Record<string, string>>([
    { "x-forwarded-host": "evil.example" },
    { "x-forwarded-for": "203.0.113.9" },
    { "x-real-ip": "198.51.100.4" },
    { forwarded: "for=203.0.113.9;host=evil.example" },
  ])("is signed out through a proxy (%o), before any database read", async (extra) => {
    state.headers = new Headers({ host: "localhost:3000", ...extra });
    await expect(getStaffOrg()).resolves.toBeNull();
    expect(state.dbUsed).toBe(0);
  });
});
