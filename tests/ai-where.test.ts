// The point-of-collection sentence on the report form (docs/phase7-prompt.md Wave 4 item 1, docs/domain.md §4): where
// the words go when AI is on, truthful for each AI setting of this copy, in plain words, never an env value.
import { describe, expect, it } from "vitest";
import { AI_WHERE, aiWhereSentence } from "@/lib/public-info/ai-where";
import { describeThisCopy } from "@/lib/public-info/this-copy";

const LOCAL_DB = "postgres://accessloop_app:pw@127.0.0.1:54329/accessloop";
const HOSTED_DB = "postgres://app:pw@aws-0-ca-central-1.pooler.supabase.com:6543/postgres";
const sentence = (env: Record<string, string>) => aiWhereSentence(describeThisCopy(env));

describe("aiWhereSentence", () => {
  it("with real AI (api), names Anthropic and the United States, and what is taken out first", () => {
    const s = sentence({ FAKE_LLM: "0", AI_BACKEND: "api", DATABASE_URL: HOSTED_DB });
    expect(s).toBe(AI_WHERE.api);
    expect(s).toContain("Anthropic");
    expect(s).toContain("United States");
    expect(s).toContain("after we take out contact details and ID numbers");
  });

  it("with the team's claude-cli tool, says it is a test copy and still names Anthropic in the United States", () => {
    const s = sentence({ FAKE_LLM: "0", AI_BACKEND: "claude-cli", DATABASE_URL: LOCAL_DB });
    expect(s).toBe(AI_WHERE["claude-cli"]);
    expect(s).toMatch(/test copy/);
    expect(s).toContain("Anthropic, an AI company in the United States");
  });

  it("with the fake backend, says it is simulated; 'this computer' only when the database is on this computer", () => {
    expect(sentence({ FAKE_LLM: "1", AI_BACKEND: "api", DATABASE_URL: LOCAL_DB })).toBe(AI_WHERE.simulated_here);
    expect(AI_WHERE.simulated_here).toMatch(/simulated .*don't leave this computer/);
    // A hosted preview with fake AI still sends the words to its host: never "this computer" there.
    expect(sentence({ FAKE_LLM: "1", DATABASE_URL: HOSTED_DB })).toBe(AI_WHERE.simulated);
    expect(sentence({ FAKE_LLM: "1" })).toBe(AI_WHERE.simulated); // no database URL: not "this computer" either
    expect(AI_WHERE.simulated).not.toMatch(/this computer|Anthropic/);
  });

  it("with a bad AI setting, says no AI company gets the words (never 'simulated')", () => {
    const s = sentence({ FAKE_LLM: "0", AI_BACKEND: "something-else", DATABASE_URL: LOCAL_DB });
    expect(s).toBe(AI_WHERE.misconfigured);
    expect(s).not.toMatch(/simulated|Anthropic/);
  });

  it("every version is one plain sentence with no banned word and no env value", () => {
    for (const s of Object.values(AI_WHERE)) {
      expect(s.match(/[.!?](\s|$)/g)).toHaveLength(1); // exactly one sentence
      expect(s).not.toMatch(/compliant|compliance|certified|guarantee|priority area|barrier classification/i);
      expect(s).not.toMatch(/claude-sonnet|claude-haiku|sk-ant|postgres|localhost|127\.0\.0\.1/i);
      expect(s.split(/\s+/).length).toBeLessThanOrEqual(32);
    }
  });
});
