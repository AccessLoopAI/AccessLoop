// scripts/local-hints.ts: the plain fix printed by scripts/local-run.ts when local Postgres can't start on a
// minimal Linux machine (docs/phase7-prompt.md T3 item 16; docs/decisions.md 2026-10-20).
import { describe, expect, it } from "vitest";
import { INIT_MESSAGE, LOCALE_MESSAGE, ROOT_MESSAGE, hasEnUsUtf8, localFailureHint } from "../scripts/local-hints";

// What scripts/local.ts prints when embedded-postgres' initdb fails (its own catch, console.error).
const INIT_FAILED = "Postgres init script exited with code 1. Please check the logs for extra info. The data directory might already exist.";

describe("hasEnUsUtf8", () => {
  it("reads `locale -a` output in glibc's spelling and the canonical one", () => {
    expect(hasEnUsUtf8("C\nC.utf8\nPOSIX\nen_US.utf8\n")).toBe(true);
    expect(hasEnUsUtf8("C\r\nen_US.UTF-8\r\n")).toBe(true);
    expect(hasEnUsUtf8("C\nC.UTF-8\nPOSIX\n")).toBe(false);
    expect(hasEnUsUtf8("")).toBe(false);
  });
});

describe("localFailureHint", () => {
  it("says how to install the locale when initdb failed on Linux without en_US.UTF-8", () => {
    const hint = localFailureHint(INIT_FAILED, "linux", "C\nC.utf8\nPOSIX\n");
    expect(hint).toBe(LOCALE_MESSAGE);
    expect(hint).toContain("locale-gen");
    expect(hint).toContain("glibc-langpack-en");
    expect(hint).toMatch(/can't run as root/);
  });

  it("names the locale whenever initdb's own message is seen", () => {
    expect(localFailureHint('initdb: error: invalid locale name "en_US.UTF-8"', "darwin", null)).toBe(LOCALE_MESSAGE);
  });

  it("gives the general initdb hint when the locale is there or can't be listed", () => {
    expect(localFailureHint(INIT_FAILED, "linux", "C\nen_US.utf8\n")).toBe(INIT_MESSAGE);
    expect(localFailureHint(INIT_FAILED, "linux", null)).toBe(INIT_MESSAGE);
    expect(localFailureHint(INIT_FAILED, "win32", null)).toBe(INIT_MESSAGE);
  });

  it("explains root", () => {
    expect(localFailureHint("Error: You are running this script as root. Postgres does not support running as root.", "linux", null)).toBe(ROOT_MESSAGE);
    expect(localFailureHint("Postgres cannot run as a root user. embedded-postgres could not find a postgres user", "linux", "en_US.utf8")).toBe(ROOT_MESSAGE);
  });

  it("stays quiet for other failures", () => {
    expect(localFailureHint("db/migrations is missing. Run `npm run db:generate` first.", "linux", "")).toBeNull();
    expect(localFailureHint("", "linux", "")).toBeNull();
  });
});
