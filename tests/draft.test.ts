// lib/intake/draft.ts: what the report form keeps in the browser (domain §4), where, and what it never keeps.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DRAFT_MAX_AGE_MS,
  EMPTY_DRAFT,
  clearDraft,
  draftFromStored,
  draftKey,
  loadDraft,
  parseDraft,
  saveDraft,
  serializeDraft,
  type ReportDraft,
} from "@/lib/intake/draft";

const NOW = Date.UTC(2026, 9, 19, 12);
const FULL: ReportDraft = {
  text: "The automatic door button at the King Street branch is broken.",
  locationKind: "place",
  locationDetail: "King Street branch",
  followUp: "email",
  email: "person@example.com",
  aiOptOut: true,
};

describe("report drafts", () => {
  it("round-trip every answer except the email address", () => {
    const json = serializeDraft(FULL, NOW)!;
    expect(json).not.toContain("person@example.com");
    expect(json).not.toContain("example.com");
    expect(JSON.parse(json)).not.toHaveProperty("email");
    const back = parseDraft(json, NOW);
    expect(back).toEqual({
      text: FULL.text,
      locationKind: "place",
      locationDetail: "King Street branch",
      followUp: "email",
      aiOptOut: true,
    });
    expect(draftFromStored(back)).toEqual({ ...FULL, email: "" }); // the email field starts empty
  });

  it("keep nothing for an untouched form", () => {
    expect(serializeDraft(EMPTY_DRAFT, NOW)).toBeNull();
    expect(serializeDraft({ ...EMPTY_DRAFT, text: "   " }, NOW)).toBeNull();
    expect(serializeDraft({ ...EMPTY_DRAFT, email: "only@example.com" }, NOW)).toBeNull();
    expect(draftFromStored(null)).toEqual(EMPTY_DRAFT);
    expect(EMPTY_DRAFT.followUp).toBe(""); // no follow-up answer is chosen for the person
  });

  it("never hold the AI summary, the summary answer or the preview token", () => {
    const withExtras = { ...FULL, token: "secret-token", summary: "AI text", choice: "ai_edited" } as ReportDraft;
    const json = serializeDraft(withExtras, NOW)!;
    expect(Object.keys(JSON.parse(json)).sort()).toEqual(
      ["aiOptOut", "followUp", "locationDetail", "locationKind", "savedAt", "text", "v"].sort(),
    );
    expect(json).not.toContain("secret-token");
  });

  it("refuse anything malformed, from another version, or too old", () => {
    const json = serializeDraft(FULL, NOW)!;
    const stored = JSON.parse(json) as Record<string, unknown>;
    expect(parseDraft(null, NOW)).toBeNull();
    expect(parseDraft("not json", NOW)).toBeNull();
    expect(parseDraft("[]", NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ ...stored, v: 3 }), NOW)).toBeNull();
    expect(parseDraft(json, NOW + DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseDraft(json, NOW + DRAFT_MAX_AGE_MS - 1)).not.toBeNull();
    // Unknown values fall back to "not answered" instead of reaching the form.
    const odd = parseDraft(JSON.stringify({ ...stored, locationKind: "moon", followUp: "maybe", aiOptOut: "yes" }), NOW);
    expect(odd).toMatchObject({ locationKind: "", followUp: "", aiOptOut: false });
  });

  it("read a draft kept before step 3 became one question (version 1)", () => {
    const v1 = (wantsRetest: string, emailChoice: string) =>
      JSON.stringify({ v: 1, savedAt: NOW, text: "The ramp is too steep.", locationKind: "place", locationDetail: "", wantsRetest, emailChoice, aiOptOut: false });
    expect(parseDraft(v1("yes", "anonymous"), NOW)?.followUp).toBe("code");
    expect(parseDraft(v1("yes", "email"), NOW)?.followUp).toBe("email");
    expect(parseDraft(v1("no", "anonymous"), NOW)?.followUp).toBe("none");
    // An email reply without a re-test, or nothing chosen: the new question is asked again.
    expect(parseDraft(v1("no", "email"), NOW)?.followUp).toBe("");
    expect(parseDraft(v1("", "anonymous"), NOW)?.followUp).toBe("");
  });

  it("are kept per organization's form", () => {
    expect(draftKey("maple-harbour")).not.toBe(draftKey("lakeview-telecom"));
  });
});

/** A minimal Storage for the tests (vitest runs in Node, which has no window). */
class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

describe("where a draft is kept (Phase 7: this tab by default, this device only when asked)", () => {
  const ORG = "maple-harbour";
  let session: MemoryStorage;
  let local: MemoryStorage;

  beforeEach(() => {
    session = new MemoryStorage();
    local = new MemoryStorage();
    vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("goes to this tab's sessionStorage by default, never to localStorage", () => {
    saveDraft(ORG, FULL);
    expect(session.getItem(draftKey(ORG))).toContain("King Street");
    expect(local.getItem(draftKey(ORG))).toBeNull();
    expect(loadDraft(ORG)).toMatchObject({ place: "tab", draft: { followUp: "email" } });
  });

  it("moves to localStorage when the person asks to keep it on this device, and back again", () => {
    saveDraft(ORG, FULL, "tab");
    saveDraft(ORG, FULL, "device");
    expect(session.getItem(draftKey(ORG))).toBeNull();
    expect(local.getItem(draftKey(ORG))).toContain("King Street");
    expect(loadDraft(ORG)?.place).toBe("device");
    saveDraft(ORG, FULL, "tab");
    expect(local.getItem(draftKey(ORG))).toBeNull();
    expect(loadDraft(ORG)?.place).toBe("tab");
  });

  it("is forgotten in both places by Start over and after sending", () => {
    session.setItem(draftKey(ORG), serializeDraft(FULL, Date.now())!);
    local.setItem(draftKey(ORG), serializeDraft(FULL, Date.now())!);
    clearDraft(ORG);
    expect(session.getItem(draftKey(ORG))).toBeNull();
    expect(local.getItem(draftKey(ORG))).toBeNull();
    expect(loadDraft(ORG)).toBeNull();
  });

  it("drops what it can't use, and never throws when storage is blocked", () => {
    session.setItem(draftKey(ORG), "not json");
    expect(loadDraft(ORG)).toBeNull();
    expect(session.getItem(draftKey(ORG))).toBeNull();
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => saveDraft(ORG, FULL)).not.toThrow();
    expect(loadDraft(ORG)).toBeNull();
    expect(() => clearDraft(ORG)).not.toThrow();
  });
});
