import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redact, redactWithItems } from "@/lib/intake/redact";
import { openPreview, sealPreview } from "@/lib/intake/preview-token";
import { buildPreview, prepareCase } from "@/lib/intake/pipeline";
import type { SubmitRequest } from "@/lib/intake/types";

const SCENARIO =
  "Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken " +
  "for three weeks, so I can't get in with my wheelchair. Call me at four one six five five five zero one four two.";
const DETAIL = "King Street branch, main entrance";
const ORG = randomUUID();

const saved = { ...process.env };
beforeEach(() => {
  process.env.FAKE_LLM = "1";
  process.env.AI_BACKEND = "fake";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
});
afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
});

function aiDown() {
  process.env.FAKE_LLM = "0";
  process.env.AI_BACKEND = "api"; // no ANTHROPIC_API_KEY: every AI call throws (never a real model in tests)
  delete process.env.ANTHROPIC_API_KEY;
  vi.spyOn(console, "error").mockImplementation(() => {});
}

function submission(overrides: Partial<SubmitRequest> = {}): SubmitRequest {
  return {
    text: SCENARIO,
    locationKind: "place",
    locationDetail: DETAIL,
    wantsRetest: true,
    emailChoice: "anonymous",
    email: "",
    aiOptOut: false,
    choice: "ai_confirmed",
    editedSummary: "",
    token: null,
    ...overrides,
  };
}

describe("redaction pipeline (domain §5)", () => {
  it("removes the name (layer 2, fake) and the dictated phone number (layer 1)", async () => {
    const r = await redact(SCENARIO, { aiOptOut: false });
    expect(r.redactedText).toContain("[PERSON]");
    expect(r.redactedText).toContain("[PHONE]");
    expect(r.redactedText).not.toContain("Daniel Okafor");
    expect(r.redactedText).not.toContain("four one six");
    expect(r.spans.map((s) => s.source).sort()).toEqual(["llm", "pattern"]);
    expect(r.needsManualRedaction).toBe(false);
    for (const s of r.spans) expect(s.end).toBeLessThanOrEqual(SCENARIO.length);
  });

  it("AI opt-out: no AI call at all, layer 1 only, flagged for a person to check names", async () => {
    aiDown(); // would throw if anything called the AI
    const r = await redact(SCENARIO, { aiOptOut: true });
    expect(r.redactedText).toContain("[PHONE]");
    expect(r.redactedText).toContain("Daniel Okafor");
    expect(r.needsManualRedaction).toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("fails closed: if flagPii fails, layer 1 stays and the case needs manual redaction", async () => {
    aiDown();
    const r = await redact(SCENARIO, { aiOptOut: false });
    expect(r.redactedText).toContain("[PHONE]");
    expect(r.needsManualRedaction).toBe(true);
    expect(r.piiItems).toBeNull();
  });

  it("is deterministic for the same text and layer-2 values", () => {
    const items = [{ text: "Daniel Okafor", type: "PERSON" as const, reason: "name" }];
    expect(redactWithItems(SCENARIO, items)).toEqual(redactWithItems(SCENARIO, items));
  });
});

describe("preview token", () => {
  const payload = { orgId: ORG, maskedSha256: "a".repeat(64), pii: [], detail: null, ai: null };

  it("round-trips and rejects anything forged, tampered or foreign", () => {
    const t = sealPreview(payload);
    expect(openPreview(t)?.orgId).toBe(ORG);
    const [body, mac] = [t.slice(0, t.lastIndexOf(".")), t.slice(t.lastIndexOf(".") + 1)];
    expect(openPreview(`${body}x.${mac}`)).toBeNull();
    expect(openPreview(`${body}.${"0".repeat(64)}`)).toBeNull();
    expect(openPreview("garbage")).toBeNull();
    expect(openPreview(null)).toBeNull();
    process.env.SESSION_SECRET = "another-secret";
    expect(openPreview(t)).toBeNull();
  });

  it("a missing SESSION_SECRET is reported on the server, not hidden: no summary, no token", async () => {
    delete process.env.SESSION_SECRET;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = await buildPreview(ORG, { text: SCENARIO, locationKind: "place", locationDetail: DETAIL, aiOptOut: false });
    expect(p).toEqual({ summary: null, token: null });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("SESSION_SECRET is not set"));
    expect(String(log.mock.calls[0][0])).not.toContain("Daniel");
  });

  it("is sealed: the browser can't read the suggested areas or the layer-2 values", async () => {
    const preview = await buildPreview(ORG, { text: SCENARIO, locationKind: "place", locationDetail: DETAIL, aiOptOut: false });
    expect(Object.keys(preview).sort()).toEqual(["summary", "token"]);
    const body = preview.token!.slice(0, preview.token!.lastIndexOf("."));
    const readable = Buffer.from(body, "base64url").toString("utf8");
    expect(readable).not.toContain("built_environment");
    expect(readable).not.toContain("Daniel");
  });
});

describe("web intake: preview, then send", () => {
  async function previewToken() {
    const p = await buildPreview(ORG, { text: SCENARIO, locationKind: "place", locationDetail: DETAIL, aiOptOut: false });
    expect(p.summary).toContain("door button");
    expect(p.summary).not.toContain("Daniel Okafor");
    return p.token!;
  }

  it("confirmed AI summary: the token's fake result is used and nothing raw reaches staff fields", async () => {
    const token = await previewToken();
    const c = await prepareCase(ORG, submission({ token }), null);
    expect(c.summarySource).toBe("ai_confirmed");
    expect(c.ai?.backend).toBe("fake");
    expect(c.ai?.priorityAreas[0].area).toBe("built_environment");
    expect(c.summary).toBe(c.ai?.summary);
    expect(c.redactedText).toContain("[PERSON]");
    expect(c.redactedText).toContain("[PHONE]");
    expect(c.locationDetail).toBe(DETAIL);
    expect(c.rawText).toBe(SCENARIO);
    expect(c.isAnonymous).toBe(true);
    expect(c.intakeChannel).toBe("web");
    expect(c.needsManualRedaction).toBe(false);
    expect(c.loggedByMemberId).toBeNull();
    expect(c.codeRelayedByStaff).toBe(false);
  });

  it("sending never waits on AI: with a valid token it works even when the AI is down", async () => {
    const token = await previewToken();
    aiDown();
    const c = await prepareCase(ORG, submission({ token }), null);
    expect(c.summarySource).toBe("ai_confirmed");
    expect(c.redactedText).toContain("[PERSON]");
  });

  it("a token from another org, or for different text, is ignored", async () => {
    const token = await previewToken();
    const other = await prepareCase(randomUUID(), submission({ token }), null);
    expect(other.ai).toBeNull();
    expect(other.summarySource).toBe("reporter_words");
    expect(other.summary).toBeNull(); // no second copy of the report (domain §8)

    aiDown(); // and sending never calls the AI for text the token does not cover (domain §6.1 limit 4)
    const changed = await prepareCase(ORG, submission({ token, text: `${SCENARIO} It happened again today.` }), null);
    expect(changed.ai).toBeNull();
    expect(changed.summarySource).toBe("reporter_words");
    expect(changed.redactedText).toContain("[PHONE]"); // layer 1 ran again on the server
    expect(changed.needsManualRedaction).toBe(true); // no layer 2 for this text: the lead looks for names (domain §5)
    expect(console.error).not.toHaveBeenCalled();
  });

  it("no preview token (the preview failed or was refused): sending makes no AI call and fails closed", async () => {
    aiDown(); // would log an AI failure if anything called the AI
    const c = await prepareCase(ORG, submission({ token: null, choice: "reporter_words" }), null);
    expect(c.ai).toBeNull();
    expect(c.summary).toBeNull();
    expect(c.summarySource).toBe("reporter_words");
    expect(c.redactedText).toContain("[PHONE]");
    expect(c.redactedText).not.toContain("four one six");
    expect(c.needsManualRedaction).toBe(true);
    expect(c.locationDetail).toBe(DETAIL); // the detail too, without an AI call
    expect(console.error).not.toHaveBeenCalled();
  });

  it("an edited summary is redacted with the report's own layer-2 values", async () => {
    const token = await previewToken();
    const c = await prepareCase(
      ORG,
      submission({ token, choice: "ai_edited", editedSummary: "Daniel Okafor can't open the door. Call 416-555-0142." }),
      null,
    );
    expect(c.summarySource).toBe("ai_edited");
    expect(c.summary).toBe("[PERSON] can't open the door. Call [PHONE].");
    expect(c.needsManualRedaction).toBe(true); // the edit had no layer-2 pass of its own
  });

  it("an edited summary with a name the report never had is flagged for a person to check", async () => {
    // The report has no names (fake flagPii: no items); the edit adds one that only a layer-2 pass would find.
    const text = "The date picker on the booking page doesn't work with my keyboard.";
    const p = await buildPreview(ORG, { text, locationKind: "digital", locationDetail: "", aiOptOut: false });
    expect(openPreview(p.token)!.pii).toEqual([]);
    aiDown(); // and sending still never calls the AI
    const c = await prepareCase(
      ORG,
      submission({
        text,
        locationKind: "digital",
        locationDetail: "",
        token: p.token,
        choice: "ai_edited",
        editedSummary: "Priya Raman at the help desk said it can't be fixed.",
      }),
      null,
    );
    expect(c.summarySource).toBe("ai_edited");
    expect(c.needsManualRedaction).toBe(true); // layer 3 (the lead) must read the edit for names
    expect(console.error).not.toHaveBeenCalled();
  });

  it("'Change it' without a change counts as a confirmation", async () => {
    const token = await previewToken();
    const ai = openPreview(token)!.ai!;
    const c = await prepareCase(ORG, submission({ token, choice: "ai_edited", editedSummary: ai.value.summary }), null);
    expect(c.summarySource).toBe("ai_confirmed");
    expect(c.needsManualRedaction).toBe(false); // nothing new to check: it is the AI text
  });

  it("keep my words only, and the AI opt-out path", async () => {
    const token = await previewToken();
    const words = await prepareCase(ORG, submission({ token, choice: "reporter_words" }), null);
    expect(words.summarySource).toBe("reporter_words");
    // No copy of the pre-review report in cases.summary, so none in the append-only ai_structured payload.
    expect(words.summary).toBeNull();
    expect(words.ai?.backend).toBe("fake"); // the AI value is still logged for the correction rate

    aiDown();
    const optOut = await prepareCase(ORG, submission({ aiOptOut: true, choice: "reporter_words" }), "person@example.com");
    expect(optOut.ai).toBeNull();
    expect(optOut.summary).toBeNull();
    expect(optOut.summarySource).toBe("reporter_words");
    expect(optOut.aiOptOut).toBe(true);
    expect(optOut.needsManualRedaction).toBe(true);
    expect(optOut.redactedText).toContain("[PHONE]");
    expect(optOut.isAnonymous).toBe(false);
    expect(optOut.reporterEmail).toBe("person@example.com");
    expect(console.error).not.toHaveBeenCalled();
  });
});
