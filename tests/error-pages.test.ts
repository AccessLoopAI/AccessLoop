// The error pages replace Next's built-in ones, which have no lang, no landmarks and no "Get help" link.
// global-error.tsx replaces the root layout, so it must bring <html lang>, a <title>, a main landmark, one h1
// and the same "Get help" link itself (WCAG 3.1.1, 2.4.2, 3.2.6). Rendered to static HTML here; forcing a
// root-layout failure in e2e is not practical.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font/local is compiled by Next's bundler; outside it, stand in a plain font object.
vi.mock("next/font/local", () => ({ default: () => ({ className: "font", variable: "font-var", style: {} }) }));

describe("error pages", () => {
  it("global-error renders a complete, labelled document", async () => {
    const { default: GlobalError } = await import("@/app/global-error");
    const html = renderToStaticMarkup(createElement(GlobalError));
    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("<title>Something went wrong | AccessLoop</title>");
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain('<main id="main" tabindex="-1"');
    expect(html).toContain('href="#main"'); // the skip link
    expect(html).toContain('href="/help"'); // "Get help", in the header like every page
    expect(html).toContain("Reload the page");
  });

  it("the page-level error page never shows the error's message", async () => {
    const { default: ErrorPage } = await import("@/app/error");
    const secret = new Error("Daniel Okafor 416-555-0142");
    const html = renderToStaticMarkup(createElement(ErrorPage, { error: secret, retry: () => {} }));
    expect(html).toContain("Something went wrong");
    expect(html).toContain('href="/help"');
    expect(html).not.toContain("Daniel");
    expect(html).not.toContain("Other ways to reach"); // no organization known: the general words only
  });

  it("under an organization's pages, the error page shows its other ways to give feedback (Phase 7 T4.1)", async () => {
    const { default: ErrorPage } = await import("@/app/error");
    const { OrgContactProvider } = await import("@/components/layout/OrgContext");
    const org = {
      slug: "maple-harbour",
      name: "Maple Harbour Bank",
      feedbackDesignateTitle: "Accessibility Lead",
      contactPhone: "1-800-555-0100 ext. 22",
      contactEmail: "accessibility@mapleharbour.example",
      contactMailingAddress: "1 Harbour Street, Halifax NS B3J 1A1",
    };
    const html = renderToStaticMarkup(
      createElement(OrgContactProvider, { org }, createElement(ErrorPage, { error: new Error("x"), retry: () => {} })),
    );
    expect(html).toContain("Other ways to reach Maple Harbour Bank</h2>");
    expect(html).toContain('href="tel:18005550100;ext=22"');
    expect(html).toContain('href="mailto:accessibility@mapleharbour.example"');
    expect(html).toContain("Ask for the Accessibility Lead.");
    expect(html).toContain('href="/p/maple-harbour"');
    expect(html).toContain('href="/help?org=maple-harbour"'); // "Get help", still in the header, for this organization
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  });
});
