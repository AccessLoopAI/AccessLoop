// lib/report/headings.ts (frozen): ACR s.14 rules R1-R5 for the progress report (domain §1.4, §7 step 6).
import { describe, expect, it } from "vitest";
import {
  AREA_HEADINGS,
  checkProgressReport,
  passes,
  type CheckResult,
  type DraftSection,
  type OrgReportSettings,
} from "@/lib/report/headings";

const ORG: OrgReportSettings = {
  planAreas: ["built_environment", "ict", "procurement"],
  feedbackDesignateTitle: "Director, Accessibility and Inclusion",
  contactMailingAddress: "100 Example Street, Toronto, ON M5V 0A0",
  contactPhone: "1-800-555-0100",
  contactEmail: "accessibility@example.com",
};

const GENERAL_TEXT =
  "Feedback goes to the Director, Accessibility and Inclusion. Write to 100 Example Street, Toronto, ON M5V 0A0, " +
  "call 1-800-555-0100 or email accessibility@example.com. You can ask for this report in an alternate format.";

function draft(): DraftSection[] {
  return [
    { heading: "General", level: 2, text: GENERAL_TEXT },
    { heading: "The built environment", level: 2, text: "We fixed the door at the King Street branch." },
    { heading: "Information and communication technologies", level: 2, text: "We fixed the booking page." },
    { heading: "The procurement of goods, services and facilities", level: 2, text: "We added criteria." },
    { heading: "Consultations", level: 2, text: "We met with a panel of people with disabilities." },
    { heading: "Feedback", level: 2, text: "We received 17 pieces of feedback." },
  ];
}

const byId = (results: CheckResult[], id: string) => {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`no check ${id} in ${results.map((x) => x.id).join(", ")}`);
  return r;
};
const failing = (results: CheckResult[]) => results.filter((r) => !r.ok).map((r) => r.id);
const without = (heading: string) => draft().filter((s) => s.heading !== heading);
const edit = (heading: string, patch: Partial<DraftSection>) =>
  draft().map((s) => (s.heading === heading ? { ...s, ...patch } : s));

describe("checkProgressReport: a complete draft", () => {
  it("passes every rule with no warnings", () => {
    const r = checkProgressReport(draft(), ORG);
    expect(failing(r)).toEqual([]);
    expect(passes(r)).toBe(true);
    expect(r.map((x) => x.id)).toEqual([
      "R1", "R2:built_environment", "R2:ict", "R2:procurement", "R3", "R4",
      "R5:title", "R5:mail", "R5:phone", "R5:email", "R5:formats",
    ]);
  });

  it("cites the regulation on every check and marks R1-R5 as errors", () => {
    for (const c of checkProgressReport(draft(), ORG)) {
      expect(c.citation).toMatch(/^AC[RA] s\./);
      expect(c.severity).toBe("error");
      expect(c.label.length).toBeGreaterThan(5);
    }
  });
});

describe("checkProgressReport: missing required headings (R1-R4)", () => {
  it("flags a missing General (and then nothing in General can be found)", () => {
    const r = checkProgressReport(without("General"), ORG);
    expect(byId(r, "R1").ok).toBe(false);
    expect(failing(r)).toEqual(["R1", "R5:title", "R5:mail", "R5:phone", "R5:email", "R5:formats"]);
    expect(passes(r)).toBe(false);
  });

  it("flags a missing Consultations", () => {
    const r = checkProgressReport(without("Consultations"), ORG);
    expect(failing(r)).toEqual(["R3"]);
    expect(passes(r)).toBe(false);
  });

  it("flags a missing Feedback", () => {
    const r = checkProgressReport(without("Feedback"), ORG);
    expect(failing(r)).toEqual(["R4"]);
    expect(passes(r)).toBe(false);
  });

  it("flags a missing heading for one plan area, and only that area", () => {
    const r = checkProgressReport(without("Information and communication technologies"), ORG);
    expect(failing(r)).toEqual(["R2:ict"]);
    expect(byId(r, "R2:ict").label).toContain(AREA_HEADINGS.ict.canonical);
    expect(byId(r, "R2:ict").citation).toBe("ACR s.14(1)(b); ACA s.5(c)");
  });

  it("needs a heading for every plan area, and none for areas outside the plan", () => {
    const r = checkProgressReport(draft(), { ...ORG, planAreas: [...ORG.planAreas, "transportation"] });
    expect(failing(r)).toEqual(["R2:transportation"]);
    const fewer = checkProgressReport(draft(), { ...ORG, planAreas: [] });
    expect(fewer.some((x) => x.id.startsWith("R2:"))).toBe(false);
    expect(passes(fewer)).toBe(true);
  });

  it("requires level-2 headings: a level-3 heading fails and says why", () => {
    for (const heading of ["General", "Consultations", "Feedback", "The built environment"]) {
      const r = checkProgressReport(edit(heading, { level: 3 }), ORG);
      const id = { General: "R1", Consultations: "R3", Feedback: "R4", "The built environment": "R2:built_environment" }[heading]!;
      expect(byId(r, id).ok).toBe(false);
      expect(byId(r, id).label).toContain("(must be a level-2 heading)");
      expect(passes(r)).toBe(false);
    }
    expect(byId(checkProgressReport(edit("General", { level: 1 }), ORG), "R1").ok).toBe(false);
  });

  it("flags an empty Feedback body (ACA s.71(5))", () => {
    for (const text of ["", "   ", "\n\t"]) {
      const r = checkProgressReport(edit("Feedback", { text }), ORG);
      expect(byId(r, "R4").ok).toBe(true);
      const body = byId(r, "R4:body");
      expect(body.ok).toBe(false);
      expect(body.severity).toBe("error");
      expect(body.citation).toBe("ACA s.71(5)");
      expect(passes(r)).toBe(false);
    }
  });
});

describe("checkProgressReport: General contents (R5, ACR s.14(2))", () => {
  const general = (text: string) => edit("General", { text });

  it("flags a missing designate title", () => {
    const r = checkProgressReport(general(GENERAL_TEXT.replace("Director, Accessibility and Inclusion", "our team")), ORG);
    expect(failing(r)).toEqual(["R5:title"]);
  });

  it("flags a missing mailing address", () => {
    const r = checkProgressReport(general(GENERAL_TEXT.replace("100 Example Street, Toronto, ON M5V 0A0", "our office")), ORG);
    expect(failing(r)).toEqual(["R5:mail"]);
  });

  it("flags a missing phone number", () => {
    const r = checkProgressReport(general(GENERAL_TEXT.replace("1-800-555-0100", "our number")), ORG);
    expect(failing(r)).toEqual(["R5:phone"]);
  });

  it("flags a missing email", () => {
    const r = checkProgressReport(general(GENERAL_TEXT.replace("accessibility@example.com", "us")), ORG);
    expect(failing(r)).toEqual(["R5:email"]);
  });

  it("flags missing alternate formats, and accepts the usual ways of saying it", () => {
    const noFormats = GENERAL_TEXT.replace("You can ask for this report in an alternate format.", "");
    expect(failing(checkProgressReport(general(noFormats), ORG))).toEqual(["R5:formats"]);
    for (const phrase of ["in an alternative format", "in large print", "in Braille", "as an AUDIO file", "in Alternate Formats"]) {
      expect(failing(checkProgressReport(general(`${noFormats} Ask for it ${phrase}.`), ORG))).toEqual([]);
    }
  });

  it("an empty org setting can never be satisfied", () => {
    const r = checkProgressReport(draft(), { ...ORG, contactPhone: "  " });
    expect(failing(r)).toEqual(["R5:phone"]);
  });

  it("matches the contact details case- and whitespace-insensitively", () => {
    const shouty = GENERAL_TEXT.toUpperCase().replace(/ /g, "   ");
    expect(failing(checkProgressReport(general(shouty), ORG))).toEqual([]);
  });

  it("only looks inside General, not in other sections", () => {
    const sections = draft().map((s) =>
      s.heading === "General" ? { ...s, text: "Contact us." } : s.heading === "Feedback" ? { ...s, text: GENERAL_TEXT } : s,
    );
    expect(failing(checkProgressReport(sections, ORG))).toEqual(["R5:title", "R5:mail", "R5:phone", "R5:email", "R5:formats"]);
  });
});

describe("checkProgressReport: placeholders are warnings only", () => {
  it("warns for a plan-area placeholder without failing the heading", () => {
    const r = checkProgressReport(edit("The built environment", { placeholder: true, text: "" }), ORG);
    const w = byId(r, "W:built_environment");
    expect(w.ok).toBe(false);
    expect(w.severity).toBe("warning");
    expect(byId(r, "R2:built_environment").ok).toBe(true);
    expect(passes(r)).toBe(true);
  });

  it("warns for a Consultations placeholder (ACA s.71(4))", () => {
    const r = checkProgressReport(edit("Consultations", { placeholder: true }), ORG);
    expect(byId(r, "W:consultations")).toMatchObject({ ok: false, severity: "warning", citation: "ACA s.71(4)" });
    expect(byId(r, "R3").ok).toBe(true);
    expect(passes(r)).toBe(true);
  });

  it("a draft fresh from the generator (every lead-written section a placeholder) still passes", () => {
    const fresh = draft().map((s) =>
      s.heading === "General" || s.heading === "Feedback" ? s : { ...s, placeholder: true, text: "" },
    );
    const r = checkProgressReport(fresh, ORG);
    expect(r.filter((x) => x.severity === "warning").map((x) => x.id)).toEqual([
      "W:built_environment", "W:ict", "W:procurement", "W:consultations",
    ]);
    expect(passes(r)).toBe(true);
  });

  it("warns (only) when General does not come first", () => {
    const sections = draft();
    const reordered = [...sections.slice(1), sections[0]];
    const r = checkProgressReport(reordered, ORG);
    expect(byId(r, "W:order")).toMatchObject({ ok: false, severity: "warning" });
    expect(passes(r)).toBe(true);
  });
});

describe("checkProgressReport: heading text matching", () => {
  it("accepts every alias of every area heading", () => {
    for (const [area, h] of Object.entries(AREA_HEADINGS)) {
      for (const name of [h.canonical, ...h.aliases]) {
        const sections = [...draft(), { heading: name, level: 2, text: "Progress." }];
        const r = checkProgressReport(sections, { ...ORG, planAreas: [area as keyof typeof AREA_HEADINGS] });
        expect(byId(r, `R2:${area}`).ok, `${area} as "${name}"`).toBe(true);
      }
    }
  });

  it("ignores case, extra whitespace and straight or curly quotes", () => {
    const sections: DraftSection[] = [
      { heading: "GENERAL", level: 2, text: GENERAL_TEXT },
      { heading: "  built   ENVIRONMENT ", level: 2, text: "x" },
      { heading: "ict", level: 2, text: "x" },
      { heading: "“Procurement”", level: 2, text: "x" },
      { heading: '"consultations"', level: 2, text: "x" },
      { heading: "feedback", level: 2, text: "Some feedback." },
    ];
    const r = checkProgressReport(sections, ORG);
    expect(failing(r)).toEqual([]);
    expect(passes(r)).toBe(true);
  });

  it("does not accept a heading that only contains the name", () => {
    const r = checkProgressReport(edit("Feedback", { heading: "Feedback received" }), ORG);
    expect(failing(r)).toEqual(["R4"]);
  });
});

describe("passes()", () => {
  const check = (ok: boolean, severity: "error" | "warning"): CheckResult =>
    ({ id: "x", ok, severity, label: "x", citation: "ACR s.14" });

  it("is true when every error check is ok, whatever the warnings", () => {
    expect(passes([])).toBe(true);
    expect(passes([check(true, "error"), check(true, "warning")])).toBe(true);
    expect(passes([check(true, "error"), check(false, "warning"), check(false, "warning")])).toBe(true);
  });

  it("is false as soon as one error check fails", () => {
    expect(passes([check(false, "error")])).toBe(false);
    expect(passes([check(true, "error"), check(false, "error"), check(false, "warning")])).toBe(false);
  });
});
