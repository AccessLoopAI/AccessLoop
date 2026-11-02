// The ACR s.9 feedback-process helper on /app/settings (docs/archive/phase7-prompt.md T6 item 4; lib/feedback-process.ts):
// the checklist flags what is missing from the saved settings and this year's acknowledgements, marks what AccessLoop
// cannot see, never says "compliant"; and the public description is ONE component, so the Settings preview and
// /p/{org} say the same words (rendered to static HTML here; the pages' axe runs are e2e/feedback-helpers.spec.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedbackProcessDescription, PROCESS_DESCRIPTION_TITLE } from "@/components/feedback-process/FeedbackProcessDescription";
import {
  PROCESS_LINES,
  designateTitleInSentence,
  feedbackProcessChecks,
  processCheckCounts,
  processCheckSummary,
  processIntro,
  type AcknowledgementSeen,
} from "@/lib/feedback-process";

const ORG = {
  name: "Maple Harbour Services",
  slug: "maple-harbour",
  feedbackDesignateTitle: "Director, Accessibility and Inclusion",
  contactMailingAddress: "100 Harbour St\nHalifax, NS B3J 0A0",
  contactPhone: "1-800-555-0100 ext. 22",
  contactEmail: "access@example.org",
};
const ACK_OK: AcknowledgementSeen = { required: 4, missing: 0, missingHref: null, periodLabel: "2026" };

const html = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const byId = (checks: ReturnType<typeof feedbackProcessChecks>) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe("the ACR s.9 checklist", () => {
  it("lists the rules in the regulation's order, and a complete setup has only the one row AccessLoop can't see", () => {
    const checks = feedbackProcessChecks(ORG, ACK_OK);
    expect(checks.map((c) => [c.id, c.rule])).toEqual([
      ["designate", "ACR s.9(1)"],
      ["anonymous", "ACR s.9(2)"],
      ["channels", "ACR s.9(3)"],
      ["other_channels", "ACR s.9(3)"],
      ["acknowledgement", "ACR s.9(4)"],
      ["formats", "ACR s.14(2)(b)"],
    ]);
    expect(processCheckCounts(checks)).toEqual({ met: 5, check: 1, missing: 0 });
    expect(byId(checks).other_channels).toMatchObject({ state: "check", action: { href: "/app/cases/new" } });
    expect(processCheckSummary(checks)).toBe("5 of 6 in place, 1 for you to check.");
    expect(byId(checks).designate.detail).toBe("Your description names the Director, Accessibility and Inclusion.");
  });

  it("flags an empty title or contact detail as missing, with a link to the field", () => {
    const checks = byId(feedbackProcessChecks({ ...ORG, feedbackDesignateTitle: " ", contactPhone: "", contactEmail: "" }, ACK_OK));
    expect(checks.designate).toMatchObject({ state: "missing", action: { href: "#designate-title" } });
    expect(checks.channels).toMatchObject({ state: "missing", action: { href: "#mailing-address" } });
    expect(checks.channels.detail).toBe("Add a phone number and an email address. Your description lists every way to reach you.");
  });

  it("asks the lead to check a title that may be a person's name (s.9(1) asks for the position)", () => {
    for (const title of ["Jordan Smith", "jordan@example.org", "Room 12"]) {
      expect(byId(feedbackProcessChecks({ ...ORG, feedbackDesignateTitle: title }, ACK_OK)).designate.state, title).toBe("check");
    }
    for (const title of ["Accessibility Lead", "the Manager, Accessibility Feedback", "Responsable de l'accessibilité", "Accessibility Office"]) {
      expect(byId(feedbackProcessChecks({ ...ORG, feedbackDesignateTitle: title }, ACK_OK)).designate.state, title).toBe("met");
    }
  });

  it("acknowledgement (s.9(4)) comes from this year's cases: missing ones are counted and linked", () => {
    const missing = byId(feedbackProcessChecks(ORG, { required: 5, missing: 2, missingHref: "/app/inbox?anonymous=no&ack=no", periodLabel: "2026" })).acknowledgement;
    expect(missing).toMatchObject({ state: "missing", action: { href: "/app/inbox?anonymous=no&ack=no", text: "See the cases" } });
    expect(missing.detail).toBe("2 cases received in 2026 that were not anonymous have no acknowledgement recorded in the way they came in.");
    const one = byId(feedbackProcessChecks(ORG, { required: 1, missing: 1, missingHref: "/app/inbox", periodLabel: "2026" })).acknowledgement;
    expect(one.detail).toBe("1 case received in 2026 that was not anonymous has no acknowledgement recorded in the way it came in.");
    expect(byId(feedbackProcessChecks(ORG, { required: 0, missing: 0, missingHref: null, periodLabel: "2026" })).acknowledgement.state).toBe("met");
    expect(byId(feedbackProcessChecks(ORG, null)).acknowledgement.state).toBe("check"); // could not read: never "met"
  });

  it("never claims more than it sees", () => {
    const words = JSON.stringify([feedbackProcessChecks(ORG, ACK_OK), feedbackProcessChecks({ ...ORG, contactEmail: "" }, null)]);
    expect(words).not.toMatch(/complian|certified|guarantee/i);
  });
});

describe("the description: one component for /p/{org} and the Settings preview", () => {
  it("says who receives feedback, every way to give it, anonymous, acknowledgement and other formats", () => {
    const out = html(createElement(FeedbackProcessDescription, { org: ORG }));
    expect(out).toContain('<section id="give-feedback" aria-labelledby="give-feedback-title"');
    expect(out).toContain(`<h2 id="give-feedback-title">${PROCESS_DESCRIPTION_TITLE}</h2>`);
    expect(out).toContain(processIntro(ORG));
    expect(out).toContain('href="/o/maple-harbour/report"');
    expect(out).toContain('href="tel:18005550100;ext=22"');
    expect(out).toContain('href="mailto:access@example.org"');
    for (const line of Object.values(PROCESS_LINES)) expect(out).toContain(line.replace(/’/g, "’"));
  });

  it("the preview is the same text under an h3 with its own ids", () => {
    const page = html(createElement(FeedbackProcessDescription, { org: ORG }));
    const preview = html(createElement(FeedbackProcessDescription, { org: ORG, id: "preview-give-feedback", headingLevel: 3 }));
    expect(preview).toContain('<h3 id="preview-give-feedback-title">');
    const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    expect(text(preview)).toBe(text(page));
  });

  it("drops a leading 'the' from the title, as the sentence adds its own", () => {
    expect(designateTitleInSentence("the Accessibility Lead ")).toBe("Accessibility Lead");
    expect(processIntro({ name: "X", feedbackDesignateTitle: "The Accessibility Lead" })).toMatch(/^The Accessibility Lead receives feedback/);
  });

  it("/p/{org} renders the shared component (nothing written twice)", () => {
    const page = readFileSync(path.join(process.cwd(), "app", "p", "[orgSlug]", "page.tsx"), "utf8");
    expect(page).toContain("<FeedbackProcessDescription org={org} />");
    expect(page).not.toContain("You can stay anonymous");
  });
});
