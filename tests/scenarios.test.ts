// The scenario cases' data (data/scenarios.json through lib/scenarios.ts; docs/archive/phase7-prompt.md T6 item 1): 10-15
// scenarios in a third made-up organization, each from a report we actually read, in our own words, with the note
// the staff case page shows, and nothing in them that names a real organization or person or could identify anyone.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPatterns } from "@/lib/redaction/patterns";
import fakePii from "@/lib/ai/fakes/flag-pii.json";
import { PRIORITY_AREAS } from "@/lib/report/headings";
import {
  SCENARIO_NOTE_END,
  SCENARIO_NOTE_START,
  SCENARIO_ORG,
  SCENARIO_SOURCES,
  SCENARIOS,
  scenarioForCase,
  scenarioNote,
  scenarioSource,
  scenarioStage,
  type Scenario,
} from "@/lib/scenarios";

const PROMPT = readFileSync(path.join(process.cwd(), "docs", "archive", "phase7-prompt.md"), "utf8");
const BANNED = /\b(compliant|compliance|certified|guarantee[sd]?)\b/i;

/** The status db/seed.ts gives the case (same rules as its steps). */
function expectedStatus(s: Scenario): string {
  if (!s.publicSummary) return "new";
  const last = s.steps.at(-1)?.[1];
  if (last === "close_no_action") return "closed";
  if (last === "fixed") return "verified";
  if (last === "fix") return s.wantsRetest ? "retest_open" : "fixed_unverified";
  return s.owner ? "assigned" : "triaged";
}

describe("the scenario organization", () => {
  it("is a third made-up organization, never Maple Harbour or Lakeview", () => {
    expect(SCENARIO_ORG.slug).toBe("kestrel-bay");
    expect(["maple-harbour", "lakeview-telecom"]).not.toContain(SCENARIO_ORG.slug);
    for (const src of SCENARIO_SOURCES) expect(SCENARIO_ORG.name.toLowerCase()).not.toContain(src.org.toLowerCase());
  });
});

describe("the scenarios", () => {
  it("are 10 to 15, in file order BAR-0001, BAR-0002, ... (the seed relies on it)", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(10);
    expect(SCENARIOS.length).toBeLessThanOrEqual(15);
    SCENARIOS.forEach((s, i) => {
      expect(s.ref).toBe(`BAR-${String(i + 1).padStart(4, "0")}`);
      expect(s.id).toBe(`SC${String(i + 1).padStart(2, "0")}`);
    });
  });

  it("each come from a report we read, and every report is one the T6 task lists", () => {
    for (const s of SCENARIOS) expect(scenarioSource(s).status).toBe("read");
    for (const src of SCENARIO_SOURCES) expect(PROMPT, `${src.id} is not a listed source`).toContain(src.url);
  });

  it("cover the themes the task names", () => {
    const themes = SCENARIOS.map((s) => `${s.theme} ${s.text}`.toLowerCase()).join("\n");
    for (const re of [/phone (line|menu|system)/, /card number/, /deaf/, /motion-sensor door/, /wheelchair (help|assistance)/, /pdf/, /video meeting/, /nowhere to sit|seating/]) {
      expect(themes).toMatch(re);
    }
  });

  it("are spread over the statuses (all seven), several channels and areas", () => {
    expect(new Set(SCENARIOS.map(expectedStatus))).toEqual(
      new Set(["new", "triaged", "assigned", "retest_open", "fixed_unverified", "verified", "closed"]),
    );
    expect(new Set(SCENARIOS.map((s) => s.channel)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(SCENARIOS.map((s) => s.area)).size).toBeGreaterThanOrEqual(5);
    for (const s of SCENARIOS) expect(PRIORITY_AREAS).toContain(s.area);
  });

  it("name no real organization and hold nothing that identifies a person", () => {
    const names = SCENARIO_SOURCES.map((s) => s.org.toLowerCase());
    for (const s of SCENARIOS) {
      const words = [s.theme, s.text, s.summary, s.publicSummary].join(" ");
      for (const n of names) expect(words.toLowerCase(), `${s.id} names ${n}`).not.toContain(n);
      expect(detectPatterns(s.text), `${s.id} has a contact detail or ID`).toEqual([]);
      for (const e of fakePii.entries) expect(s.text).not.toContain(e.match);
      expect(words, `${s.id}`).not.toMatch(BANNED);
    }
  });

  it("keep the reporter's words out of the public summary (the summary is the lead's)", () => {
    for (const s of SCENARIOS) if (s.publicSummary) expect(s.publicSummary).not.toBe(s.text);
  });
});

describe("the note on a scenario case", () => {
  it("reads exactly 'Scenario derived from public report: {org}, {year}, {url}; wording ours; not a real submission'", () => {
    const s = SCENARIOS[0];
    const src = scenarioSource(s);
    expect(scenarioNote(src)).toBe(`Scenario derived from public report: ${src.org}, ${src.year}, ${src.url}; wording ours; not a real submission`);
    expect(SCENARIO_NOTE_START).toBe("Scenario derived from public report:");
    expect(SCENARIO_NOTE_END).toBe("wording ours; not a real submission");
  });

  it("belongs only to the scenario org's seeded refs (refs repeat across orgs)", () => {
    expect(scenarioForCase("kestrel-bay", "BAR-0001")?.scenario.id).toBe("SC01");
    expect(scenarioForCase("kestrel-bay", SCENARIOS.at(-1)!.ref)?.scenario.id).toBe(SCENARIOS.at(-1)!.id);
    expect(scenarioForCase("maple-harbour", "BAR-0001")).toBeNull();
    expect(scenarioForCase("lakeview-telecom", "BAR-0001")).toBeNull();
    expect(scenarioForCase("kestrel-bay", `BAR-${String(SCENARIOS.length + 1).padStart(4, "0")}`)).toBeNull();
  });

  it("says where each case stands in plain words (for /sources)", () => {
    const words = SCENARIOS.map(scenarioStage);
    expect(words).toContain("New: waiting for the lead's redaction review");
    expect(words).toContain("Fixed and confirmed by the person who reported it");
    for (const w of words) expect(w).not.toMatch(/priority area|barrier classification/i);
  });
});
