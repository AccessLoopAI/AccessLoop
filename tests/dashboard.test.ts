// The dashboard's pure pieces (docs/domain.md §10): the deadline banner (§1.5), the period selector, the words a
// number is shown in, the chart geometry, and where each role lands. The numbers themselves are lib/metrics' (tested
// in tests/metrics*.test.ts); the page and its links are tested end to end in e2e/dashboard.spec.ts.
import { describe, expect, it, vi } from "vitest";
import { zonedNoon } from "@/lib/dates";
import { staffHome } from "@/lib/auth/staff";
import {
  attentionReasonLabel,
  attentionWaitLabel,
  countLabel,
  dashboardHref,
  daysLabel,
  decimalLabel,
  hoursLabel,
  last90Days,
  nextDeadline,
  parseDashboardPeriod,
  percentLabel,
  thisYear,
} from "@/lib/metrics";
import { barPath, countScale, twoLines } from "@/components/ui/charts/geometry";

// lib/auth/staff.ts imports the database client; staffHome() needs none of it.
vi.mock("@/db/client", () => ({ db: {} }));

const NOW = zonedNoon("2026-10-19");

describe("the deadline banner (domain §1.5)", () => {
  it("says domain §10's example for a large private organization on Oct 19, 2026", () => {
    const d = nextDeadline("private_large", NOW);
    expect(d.sentence).toBe("Progress report due June 1, 2027: 225 days");
    expect([d.lead, d.countdown, d.daysLeft, d.kind]).toEqual(["Progress report due June 1, 2027", "225 days", 225, "progress_report"]);
  });

  it("gives the federal public sector Dec 31, 2026 and small private organizations their updated plan", () => {
    expect(nextDeadline("federal_public", NOW).sentence).toBe("Progress report due December 31, 2026: 73 days");
    const small = nextDeadline("private_small", NOW);
    expect(small.sentence).toBe("Updated accessibility plan due June 1, 2027: 225 days");
    expect(small.kind).toBe("accessibility_plan");
  });

  it("counts whole calendar days in the display time zone: 1 day, today, and days ago", () => {
    expect(nextDeadline("federal_public", zonedNoon("2026-12-30")).countdown).toBe("1 day");
    expect(nextDeadline("federal_public", zonedNoon("2026-12-31")).sentence).toBe("Progress report due December 31, 2026: today");
    // 23:30 in Toronto on Dec 30 is already Dec 31 in UTC: still "1 day".
    expect(nextDeadline("federal_public", new Date("2026-12-31T04:30:00Z")).countdown).toBe("1 day");
    expect(nextDeadline("federal_public", zonedNoon("2027-01-03")).sentence).toBe("Progress report was due December 31, 2026: 3 days ago");
  });
});

describe("numbers as words (lib/metrics/format.ts)", () => {
  it("rounds a rate to a whole percent and never turns no data into 0%", () => {
    expect(percentLabel(7 / 8)).toBe("88%");
    expect(percentLabel(9 / 10)).toBe("90%");
    expect(percentLabel(1)).toBe("100%");
    expect(percentLabel(0)).toBe("0%");
    expect(percentLabel(null)).toBeNull();
  });

  it("writes days, hours and counts in plain words", () => {
    expect([decimalLabel(14), decimalLabel(12.5), daysLabel(1), daysLabel(14), daysLabel(12.5)]).toEqual(["14", "12.5", "1 day", "14 days", "12.5 days"]);
    expect([hoursLabel(0), hoursLabel(0.4), hoursLabel(1), hoursLabel(5.5), hoursLabel(30)]).toEqual([
      "under 1 hour", "under 1 hour", "1 hour", "5.5 hours", "30 hours",
    ]);
    expect([countLabel(1), countLabel(16), countLabel(1, "verified fix", "verified fixes"), countLabel(2, "verified fix", "verified fixes")]).toEqual([
      "1 case", "16 cases", "1 verified fix", "2 verified fixes",
    ]);
  });

  it("says why and how long for each 'Needs attention' reason (domain §10's table)", () => {
    expect(attentionReasonLabel("redaction")).toBe("Waiting for redaction review");
    expect(attentionWaitLabel({ reason: "retest", days: 25 })).toBe("Re-test open 25 days");
    expect(attentionWaitLabel({ reason: "stalled", days: 40 })).toBe("Assigned 40 days, no fix logged");
    expect(attentionWaitLabel({ reason: "redaction", days: 0 })).toBe("Received today");
    expect(attentionWaitLabel({ reason: "unacknowledged", days: 1 })).toBe("Received 1 day ago");
  });
});

describe("the period selector (a GET form)", () => {
  it("defaults to this year, and reads Last 90 days", () => {
    for (const q of [{}, { period: "nonsense" }, { period: ["year", "90d"] }]) {
      const p = parseDashboardPeriod(q, NOW);
      expect(p.choice).toBe("year");
      expect(p.period).toEqual(thisYear(NOW));
      expect(p.problem).toBeNull();
    }
    const p = parseDashboardPeriod(new URLSearchParams("period=90d"), NOW);
    expect([p.choice, p.period, p.label]).toEqual(["90d", last90Days(NOW), "Jul 22, 2026 to Oct 19, 2026"]);
  });

  it("uses custom dates when they make a period, and otherwise says why and shows this year", () => {
    const ok = parseDashboardPeriod({ period: "custom", start: "2026-03-01", end: "2026-03-31" }, NOW);
    expect([ok.choice, ok.period, ok.problem, ok.start, ok.end]).toEqual(["custom", { start: "2026-03-01", end: "2026-03-31" }, null, "2026-03-01", "2026-03-31"]);
    const missing = parseDashboardPeriod({ period: "custom", start: "2026-03-01", end: "" }, NOW);
    expect([missing.choice, missing.period, missing.problem, missing.start, missing.end]).toEqual(["custom", thisYear(NOW), "missing", "2026-03-01", ""]);
    const bogus = parseDashboardPeriod({ period: "custom", start: "2026-02-30", end: "soon" }, NOW);
    expect([bogus.problem, bogus.start, bogus.end]).toEqual(["missing", "", ""]);
    const order = parseDashboardPeriod({ period: "custom", start: "2026-05-01", end: "2026-04-01" }, NOW);
    expect([order.problem, order.period]).toEqual(["order", thisYear(NOW)]);
  });

  it("builds the dashboard URL for each choice", () => {
    expect(dashboardHref("year")).toBe("/app/dashboard");
    expect(dashboardHref("90d")).toBe("/app/dashboard?period=90d");
    expect(dashboardHref("custom", { start: "2026-01-01", end: "2026-06-30" })).toBe("/app/dashboard?period=custom&start=2026-01-01&end=2026-06-30");
  });
});

describe("chart geometry (presentation only)", () => {
  it("picks a clean whole-number count axis", () => {
    expect(countScale(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(countScale(3)).toEqual({ top: 3, ticks: [0, 1, 2, 3] });
    expect(countScale(11)).toEqual({ top: 15, ticks: [0, 5, 10, 15] });
    expect(countScale(16)).toEqual({ top: 20, ticks: [0, 5, 10, 15, 20] });
    expect(countScale(250)).toEqual({ top: 300, ticks: [0, 100, 200, 300] });
  });

  it("rounds only a bar's data end, and draws nothing for an empty bar", () => {
    expect(barPath(0, 10, 20, 50, 4, "up")).toBe("M0 60 L0 14 Q0 10 4 10 L16 10 Q20 10 20 14 L20 60 Z");
    expect(barPath(0, 0, 100, 16, 4, "right")).toBe("M0 0 L96 0 Q100 0 100 4 L100 12 Q100 16 96 16 L0 16 Z");
    expect(barPath(0, 0, 0, 16, 4, "right")).toBe("");
  });

  it("breaks a stage name over at most two lines", () => {
    expect(twoLines("Triaged")).toEqual(["Triaged"]);
    expect(twoLines("Verified by reporter")).toEqual(["Verified by", "reporter"]);
  });
});

describe("where each role lands (domain §10)", () => {
  it("sends leads and auditors to the dashboard and owners to My work", () => {
    expect([staffHome("lead"), staffHome("auditor"), staffHome("owner")]).toEqual(["/app/dashboard", "/app/dashboard", "/app/my-work"]);
  });
});
