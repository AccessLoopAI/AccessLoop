// The pilot tenant's data (data/pilot/submissions.json through lib/pilot.ts; docs/decisions.md 2026-10-28): 40-60
// made-up submissions for a made-up transport operator, each from a public source we read, in our own words, spread
// like real feedback (channels, areas, where each case ends up), with nobody from a decision named.
import { describe, expect, it } from "vitest";
import { PRIORITY_AREAS } from "@/lib/report/headings";
import {
  PILOT_LEAD,
  PILOT_ORG,
  PILOT_OWNERS,
  PILOT_SOURCES,
  PILOT_SUBMISSIONS,
  pilotForCase,
  pilotRef,
  pilotSource,
  pilotSourcesUsed,
  pilotStage,
} from "@/lib/pilot";
import { SCENARIO_NOTE_END, SCENARIO_ORG, SCENARIO_SOURCES, scenarioNote } from "@/lib/scenarios";

const count = <T,>(xs: readonly T[], f: (x: T) => boolean) => xs.filter(f).length;
const BANNED = /\b(compliant|compliance|certified|guarantee[sd]?|priority area|barrier classification)\b/i;

describe("the pilot organization", () => {
  it("is a made-up fourth organization, named after no source", () => {
    expect(PILOT_ORG.slug).toBe("northbound");
    expect(["maple-harbour", "lakeview-telecom", SCENARIO_ORG.slug]).not.toContain(PILOT_ORG.slug);
    for (const src of [...PILOT_SOURCES, ...SCENARIO_SOURCES]) {
      expect(PILOT_ORG.name.toLowerCase()).not.toContain(src.org.toLowerCase());
    }
  });

  it("has staff names that don't start like another org's member (e2e signs in by name prefix)", () => {
    const others = ["Alex Rivera", "Web team", "Facilities team", "Internal audit", "Other org lead", "Riley Brennan", "Operations team"];
    for (const name of [PILOT_LEAD, ...Object.values(PILOT_OWNERS)]) {
      for (const o of others) expect(name.startsWith(o) || o.startsWith(name), `${name} vs ${o}`).toBe(false);
    }
  });
});

describe("the pilot submissions", () => {
  it("are 40 to 60, in file order, each becoming the next case ref", () => {
    expect(PILOT_SUBMISSIONS.length).toBeGreaterThanOrEqual(40);
    expect(PILOT_SUBMISSIONS.length).toBeLessThanOrEqual(60);
    PILOT_SUBMISSIONS.forEach((s, i) => expect(s.id).toBe(`P${String(i + 1).padStart(2, "0")}`));
    expect(pilotRef(0)).toBe("BAR-0001");
  });

  it("each come from a source we read, and the pilot's own sources are new ones (CTA decisions, Statistics Canada)", () => {
    for (const s of PILOT_SUBMISSIONS) expect(pilotSource(s).status).toBe("read");
    const orgs = new Set(PILOT_SOURCES.map((s) => s.org));
    expect([...orgs].sort()).toEqual(["Canadian Transportation Agency", "Statistics Canada"]);
    for (const src of PILOT_SOURCES) expect(src.url.startsWith("https://")).toBe(true);
    for (const src of pilotSourcesUsed()) expect(PILOT_SUBMISSIONS.some((s) => s.source === src.id)).toBe(true);
  });

  it("are spread like real feedback: several channels, most areas, and every kind of ending", () => {
    const s = PILOT_SUBMISSIONS;
    const channels = new Set(s.map((x) => x.channel));
    expect(channels.size).toBeGreaterThanOrEqual(4);
    expect(count(s, (x) => x.channel === "web")).toBeGreaterThan(s.length / 3);
    const areas = new Set(s.map((x) => x.area));
    expect(areas.size).toBeGreaterThanOrEqual(PRIORITY_AREAS.length - 1);
    expect(count(s, (x) => x.area === "transportation")).toBeGreaterThanOrEqual(8); // a transport operator

    const stages = s.map(pilotStage);
    const has = (start: string) => count(stages, (x) => x.startsWith(start));
    expect(has("New")).toBeGreaterThanOrEqual(3);
    expect(has("Triaged")).toBeGreaterThanOrEqual(2);
    expect(has("Assigned")).toBeGreaterThanOrEqual(3);
    expect(has("Fixed and confirmed")).toBeGreaterThanOrEqual(10);
    expect(has("Fixed: waiting")).toBeGreaterThanOrEqual(3); // stuck waiting for the reporter
    expect(has("Closed as a duplicate")).toBeGreaterThanOrEqual(2);
    expect(has("Closed: no action")).toBeGreaterThanOrEqual(1);
    expect(has("Partly fixed") + has("Not fixed")).toBeGreaterThanOrEqual(1);
  });

  it("name nobody from a decision and use only made-up contact details", () => {
    const words = PILOT_SUBMISSIONS.map((s) => `${s.text} ${s.publicSummary} ${s.theme} ${s.contact ?? ""}`).join("\n");
    // The applicants in the CTA decisions we used (never to appear in our wording).
    for (const name of ["Murphy", "Anderson", "Richman"]) expect(words).not.toContain(name);
    for (const phone of words.match(/\b\d{3}-\d{3}-\d{4}\b/g) ?? []) expect(phone.slice(4, 7)).toBe("555");
    for (const s of PILOT_SUBMISSIONS) if (s.contact?.startsWith("Mail:")) expect(s.contact).toContain("Example");
  });

  it("keep the product's words: no promises, no jargon for reporters", () => {
    for (const s of PILOT_SUBMISSIONS) {
      expect(`${s.text} ${s.publicSummary} ${s.theme}`, s.id).not.toMatch(BANNED);
    }
    for (const src of PILOT_SOURCES) expect(src.used).not.toMatch(BANNED);
  });
});

describe("the note on a pilot case", () => {
  it("is found by (org slug, ref) only in the pilot org", () => {
    const hit = pilotForCase(PILOT_ORG.slug, "BAR-0001");
    expect(hit?.submission.id).toBe("P01");
    expect(scenarioNote(hit!.source)).toContain(SCENARIO_NOTE_END);
    expect(pilotForCase(PILOT_ORG.slug, pilotRef(PILOT_SUBMISSIONS.length - 1))?.submission.id).toBe(PILOT_SUBMISSIONS.at(-1)!.id);
    expect(pilotForCase(PILOT_ORG.slug, pilotRef(PILOT_SUBMISSIONS.length))).toBeNull();
    expect(pilotForCase(SCENARIO_ORG.slug, "BAR-0001")).toBeNull();
    expect(pilotForCase("maple-harbour", "BAR-0001")).toBeNull();
  });
});
