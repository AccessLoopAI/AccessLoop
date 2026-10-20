import { describe, expect, it } from "vitest";
import {
  CASE_STATUSES,
  REPORTER_STATUS_LABELS,
  STAFF_STATUS_LABELS,
  reporterClosedLabel,
  reporterStatusLabel,
} from "../lib/status";

// docs/domain.md section 3. e2e/demo.spec.ts asserts the staff strings exactly.
describe("lib/status labels", () => {
  it("has the staff labels from domain §3", () => {
    expect(STAFF_STATUS_LABELS).toEqual({
      new: "New",
      triaged: "Triaged",
      assigned: "Assigned",
      retest_open: "Waiting for the reporter to check",
      verified: "Verified by reporter",
      fixed_unverified: "Fixed, not verified by reporter",
      closed: "Closed",
    });
  });

  it("has the reporter labels from domain §3", () => {
    expect(REPORTER_STATUS_LABELS).toMatchObject({
      new: "We got your report",
      triaged: "A team is looking at it",
      assigned: "Someone is working on a fix",
      retest_open: "Please tell us if it works now",
      verified: "Fixed and confirmed by you",
      fixed_unverified: "Fixed (not checked by you)",
    });
  });

  it("labels every status", () => {
    for (const s of CASE_STATUSES) {
      expect(STAFF_STATUS_LABELS[s]).toBeTruthy();
      expect(reporterStatusLabel(s, "duplicate")).toBeTruthy();
    }
  });

  it("gives closed cases a plain-words reason for reporters", () => {
    expect(reporterStatusLabel("closed", "duplicate")).toBe("Closed: someone already reported this");
    expect(reporterClosedLabel("no_action_possible")).toMatch(/^Closed: /);
    expect(reporterClosedLabel(null)).toBe("Closed");
    expect(reporterClosedLabel("something_else")).toBe("Closed");
    expect(reporterStatusLabel("verified")).toBe("Fixed and confirmed by you");
  });
});
