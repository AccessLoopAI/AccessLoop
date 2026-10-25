import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localAuthAllowed, signLocalSession, verifyLocalSession } from "@/lib/auth/local-session";

describe("local session", () => {
  const saved = { ...process.env };
  beforeEach(() => { process.env.SESSION_SECRET = "test-secret"; process.env.AUTH_MODE = "local"; delete process.env.VERCEL; });
  afterEach(() => { process.env = { ...saved }; });

  it("round-trips and rejects tampering", () => {
    const t = signLocalSession({ userId: "local_alex", orgClerkId: "local_org_maple" });
    expect(verifyLocalSession(t)?.userId).toBe("local_alex");
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "local_other_lead", orgClerkId: "local_org_lakeview", iat: 1 })).toString("base64url");
    expect(verifyLocalSession(`${forged}.${mac}`)).toBeNull();
    expect(verifyLocalSession(`${body}.${"0".repeat(mac.length)}`)).toBeNull();
    expect(verifyLocalSession("garbage")).toBeNull();
  });
  it("expires after 12 hours", () => {
    const t = signLocalSession({ userId: "u", orgClerkId: "o" }, 0);
    expect(verifyLocalSession(t, 13 * 3600 * 1000)).toBeNull();
  });
  it("only allowed on localhost, in local mode, off Vercel", () => {
    expect(localAuthAllowed("localhost:3000")).toBe(true);
    expect(localAuthAllowed("127.0.0.1:3000")).toBe(true);
    expect(localAuthAllowed("[::1]:3000")).toBe(true);
    expect(localAuthAllowed("accessloop.vercel.app")).toBe(false);
    expect(localAuthAllowed("localhost.evil.com")).toBe(false);
    expect(localAuthAllowed(null)).toBe(false);
    process.env.VERCEL = "1";
    expect(localAuthAllowed("localhost:3000")).toBe(false);
    delete process.env.VERCEL; process.env.AUTH_MODE = "clerk";
    expect(localAuthAllowed("localhost:3000")).toBe(false);
  });
});
