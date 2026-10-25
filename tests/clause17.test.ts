// The CAN-ASC-5.2.1 clause 17 panel on the dashboard (docs/phase7-prompt.md T6 item 5; lib/standards/clause17.ts):
// each step is a lib/metrics number the dashboard already has, linked to exactly its cases; one short quoted line,
// cited; never "compliant". Rendered to static HTML for the page contract (unique link names, no chart captions).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Clause17Panel } from "@/app/(staff)/app/dashboard/Clause17Panel";
import { zonedNoon } from "@/lib/dates";
import { computeDashboardMetrics, inboxHref, type MetricCase } from "@/lib/metrics";
import { CLAUSE_17_QUOTE, CLAUSE_17_URL, clause17Steps } from "@/lib/standards/clause17";
import { Story, caseId, ref } from "./support/report-story";

const NOW = zonedNoon("2026-10-19");
const YEAR = { start: "2026-01-01", end: "2026-12-31" };

function cases(): MetricCase[] {
  return [
    new Story(caseId(1), ref(1), "2026-02-01T15:00:00Z").triage(0, "ict", "A button had no label.").assign(1).fixWithRetest(10).verdict(14, "fixed"),
    new Story(caseId(2), ref(2), "2026-03-01T15:00:00Z", { channel: "email", anonymous: false }).ack(1, "email").triage(0, "ict", "A form timed out.").assign(1).fixNoRetest(5),
    new Story(caseId(3), ref(3), "2026-04-01T15:00:00Z", { channel: "phone", anonymous: false }).triage(0, "built_environment", "A door was heavy.").assign(1).fixWithRetest(3).verdict(4, "partly").fixWithRetest(10, 2),
    new Story(caseId(4), ref(4), "2026-05-01T15:00:00Z").triage(0, "employment", "A posting was a scanned PDF."),
    new Story(caseId(5), ref(5), "2026-05-02T15:00:00Z").close(1, "spam"),
  ].map((s) => s.case);
}

describe("clause 17 steps", () => {
  const m = computeDashboardMetrics({ cases: cases(), period: YEAR, now: NOW });
  const steps = clause17Steps(m);
  const step = (k: string) => steps.find((s) => s.key === k)!;

  it("receive, acknowledge, address, respond: each the dashboard's own number, linked to exactly its cases", () => {
    expect(steps.map((s) => s.key)).toEqual(["receive", "acknowledge", "address", "respond"]);
    expect(step("receive")).toMatchObject({ count: m.total.total.count, of: null, href: inboxHref(m.total.total.filter) });
    expect(step("acknowledge")).toMatchObject({
      count: m.acknowledgement.acknowledged.count,
      of: m.acknowledgement.required.count,
      href: inboxHref(m.acknowledgement.acknowledged.filter),
    });
    expect(step("address")).toMatchObject({ count: m.funnel.fixLogged.count, of: m.total.total.count, href: inboxHref(m.funnel.fixLogged.filter) });
    expect(step("respond")).toMatchObject({ count: m.retestResponse.requested.rounds, of: null, href: inboxHref(m.retestResponse.requested.filter) });
    // The story: 4 received (spam is not feedback), 1 of 2 non-anonymous acknowledged, 3 with a fix, 3 re-test rounds.
    expect(steps.map((s) => [s.count, s.of])).toEqual([[4, null], [1, 2], [3, 4], [3, null]]);
  });

  it("a zero has no link (nothing to open), and the words agree with the count", () => {
    const empty = clause17Steps(computeDashboardMetrics({ cases: [], period: YEAR, now: NOW }));
    expect(empty.map((s) => [s.count, s.href])).toEqual([[0, null], [0, null], [0, null], [0, null]]);
    expect(empty[0].what).toBe("pieces of feedback received");
    const one = clause17Steps(computeDashboardMetrics({ cases: cases().slice(0, 1), period: YEAR, now: NOW }));
    expect(one.map((s) => s.what)).toEqual([
      "piece of feedback received",
      "non-anonymous reports acknowledged the way they came in",
      "report with a fix logged",
      "time we went back to the person to check the fix",
    ]);
  });

  it("quotes one short line of the clause (under 15 words) and cites it", () => {
    expect(CLAUSE_17_QUOTE.split(/\s+/).length).toBeLessThan(15);
    expect(CLAUSE_17_URL).toMatch(/^https:\/\/accessible\.canada\.ca\/.+\/17-feedback$/);
  });

  it("renders four named steps with unique link names, the quote cited, and no claim of meeting the standard", () => {
    const out = renderToStaticMarkup(createElement(Clause17Panel, { metrics: m })).replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
    expect(out).toContain('aria-labelledby="clause-17-title"');
    expect(out).toContain("CAN-ASC-5.2.1, clause 17: what your records show");
    expect(out).toContain(`<blockquote cite="${CLAUSE_17_URL}"`);
    expect(out).toContain(CLAUSE_17_QUOTE);
    const text = out.replace(/<[^>]+>/g, "");
    for (const name of ["Receive", "Acknowledge", "Address", "Respond"]) {
      expect(text.split(`See the cases for clause 17: ${name}`).length - 1, name).toBe(1);
      expect(text).toContain(`What is counted? (${name})`);
    }
    expect(out.match(/<h3/g)).toHaveLength(4);
    expect(out).not.toMatch(/<caption|<table/); // never a chart table (dashboard captions are e2e names)
    expect(out).not.toMatch(/complian|certified|guarantee/i);
  });
});
