// /trust and /accessibility (handoff Phase 5 item 3): the "About this copy" facts follow the server's env and never
// print an env value; the ACR s.19 quote is word for word the one in docs/domain.md §1.3; the copy never uses the
// words CLAUDE.md bans; each page has one h1 and the header's "Get help" is the only link by that name.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactLayer1, redactWithItems } from "@/lib/intake/redact";
import { TRUST_EXAMPLE } from "@/lib/public-info/example";
import { ACR_S19, ACR_SOURCE, ACR_URL } from "@/lib/public-info/legal";
import { describeThisCopy } from "@/lib/public-info/this-copy";
import { normalizeReceiptCode } from "@/lib/receipt-code";

const LOCAL_DB = "postgres://accessloop_app:pw@127.0.0.1:54329/accessloop";

describe("describeThisCopy", () => {
  it("says the AI is simulated whenever FAKE_LLM=1, whatever AI_BACKEND says", () => {
    expect(describeThisCopy({ FAKE_LLM: "1", AI_BACKEND: "api" }).ai).toBe("simulated");
    expect(describeThisCopy({ FAKE_LLM: " 1", AI_BACKEND: "claude-cli" }).ai).toBe("simulated");
    expect(describeThisCopy({}).ai).toBe("simulated"); // AI_BACKEND unset = fake
  });

  it("names the real backends, and a bad AI_BACKEND as not working (never as simulated)", () => {
    expect(describeThisCopy({ FAKE_LLM: "0", AI_BACKEND: "api" }).ai).toBe("api");
    expect(describeThisCopy({ FAKE_LLM: "0", AI_BACKEND: "claude-cli" }).ai).toBe("claude-cli");
    expect(describeThisCopy({ FAKE_LLM: "0", AI_BACKEND: "openai" }).ai).toBe("misconfigured");
  });

  it("follows the mailer's own rule for email", () => {
    expect(describeThisCopy({ FAKE_EMAIL: "1" }).email).toBe("simulated");
    expect(describeThisCopy({ FAKE_EMAIL: "0", RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.ca" }).email).toBe("resend");
    expect(describeThisCopy({ RESEND_API_KEY: "re_x" }).email).toBe("not_set_up"); // no EMAIL_FROM: sends fail
    expect(describeThisCopy({}).email).toBe("not_set_up");
  });

  it("tells a database on this computer from a hosted one by DATABASE_URL's host", () => {
    expect(describeThisCopy({ DATABASE_URL: LOCAL_DB }).storage).toBe("this_computer");
    expect(describeThisCopy({ DATABASE_URL: "postgresql://u:p@localhost/db" }).storage).toBe("this_computer");
    expect(describeThisCopy({ DATABASE_URL: "postgres://u:p@[::1]:5432/db" }).storage).toBe("this_computer");
    expect(describeThisCopy({ DATABASE_URL: "postgres://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres" }).storage).toBe("hosted");
    expect(describeThisCopy({ DATABASE_URL: "not a url" }).storage).toBe("unknown");
    expect(describeThisCopy({}).storage).toBe("unknown");
  });
});

describe("the worked example on /trust is what the real pipeline does", () => {
  it("step 2 (the fixed rules) hides the phone number and leaves the name", () => {
    expect(redactLayer1(TRUST_EXAMPLE.written)).toBe(TRUST_EXAMPLE.afterRules);
  });

  it("step 3 (the AI's exact substrings, mapped back) hides the name as well", () => {
    for (const item of TRUST_EXAMPLE.aiFound) expect(TRUST_EXAMPLE.afterRules).toContain(item.text); // flagPii's contract
    expect(redactWithItems(TRUST_EXAMPLE.written, [...TRUST_EXAMPLE.aiFound]).redactedText).toBe(TRUST_EXAMPLE.afterAi);
  });

  it("the summary shows no name, and the sample receipt code has the real shape", () => {
    for (const item of TRUST_EXAMPLE.aiFound) expect(TRUST_EXAMPLE.summary).not.toContain(item.text);
    expect(normalizeReceiptCode(TRUST_EXAMPLE.sampleCode)).toBe(TRUST_EXAMPLE.sampleCode.replace(/-/g, ""));
  });
});

async function render(page: "trust" | "accessibility"): Promise<string> {
  const mod = page === "trust" ? await import("@/app/trust/page") : await import("@/app/accessibility/page");
  expect(mod.runtime).toBe("nodejs");
  expect(mod.dynamic).toBe("force-dynamic"); // the facts follow the env at request time, never the build's
  return renderToStaticMarkup(createElement(mod.default));
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;|’/g, "'");

describe("the /trust and /accessibility pages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["trust", "accessibility"] as const)("/%s: one h1, one \"Get help\" link, no banned words", async (page) => {
    vi.stubEnv("FAKE_LLM", "1");
    vi.stubEnv("FAKE_EMAIL", "1");
    vi.stubEnv("DATABASE_URL", LOCAL_DB);
    const html = await render(page);
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html.match(/>Get help</g)).toHaveLength(1); // the header's; body links to /help have other names
    expect(text(html)).not.toMatch(/compliant|compliance|certified|guarantee|priority area|barrier classification/i);
    expect(html).toContain('href="/trust"'); // the footer, on every page
    expect(html).toContain('href="/accessibility"');
  });

  it("/trust quotes ACR s.19 word for word from docs/domain.md and links the source", async () => {
    const domain = readFileSync("docs/domain.md", "utf8");
    expect(domain).toContain(`> ${ACR_S19}`);
    expect(domain).toContain(ACR_URL);
    vi.stubEnv("FAKE_LLM", "1");
    const html = await render("trust");
    expect(html).toContain(ACR_S19);
    expect(html).toContain(`<blockquote cite="${ACR_URL}"`);
    expect(text(html)).toContain(ACR_SOURCE.label);
  });

  it("/trust says plainly what goes to the AI, which provider, where data is kept, for how long, and no accounts", async () => {
    vi.stubEnv("FAKE_LLM", "1");
    vi.stubEnv("FAKE_EMAIL", "1");
    const t = text(await render("trust")).replace(/\s+/g, " ");
    // docs/domain.md §9: "what goes to the LLM (masked text only), which provider, where data is stored, the
    // retention period (7 years for feedback, per ACR s.19), and that reporters have no accounts".
    expect(t).toContain("The AI only ever gets your words after the fixed rules in step 2 have hidden contact details");
    expect(t).toContain("Claude models made by Anthropic");
    expect(t).toContain("Where your report is stored");
    expect(t).toContain("keep your feedback for seven years");
    expect(t).toContain("You don't need an account.");
  });

  it("/trust is truthful about IP addresses and host logs, and lists the planned services as planned", async () => {
    // docs/phase7-prompt.md Wave 4 item 1 (drafted locally, docs/decisions.md 2026-10-20): the app keeps only a daily,
    // keyed hash of the address; a host keeps its own request logs (retention stated before launch, no number now).
    vi.stubEnv("FAKE_LLM", "1");
    vi.stubEnv("FAKE_EMAIL", "1");
    const html = await render("trust");
    const t = text(html).replace(/\s+/g, " ");
    expect(t).not.toMatch(/we never store your IP/i);
    expect(t).toContain("The AccessLoop app does not save it.");
    expect(t).toContain("the hosting service will keep its own logs of each visit");
    expect(t).toContain("we will say here how long the hosting service keeps those logs");
    const table = html.slice(html.indexOf('id="planned-services"'), html.indexOf("</table>", html.indexOf('id="planned-services"')));
    expect(text(table)).toContain("Planned when hosted");
    for (const company of ["Vercel", "Supabase", "Anthropic", "Resend", "Clerk"]) {
      expect(table).toMatch(new RegExp(`<th scope="row"[^>]*>${company}`));
    }
    // No retention period is invented for a service: "days" never appears in the table.
    expect(text(table)).not.toMatch(/\bdays?\b/i);
  });

  it("/trust describes this copy in words, and never prints an env value", async () => {
    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "api");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-not-a-real-key-123");
    vi.stubEnv("FAKE_EMAIL", "0");
    vi.stubEnv("RESEND_API_KEY", "re_not_a_real_key_456");
    vi.stubEnv("EMAIL_FROM", "team@example.ca");
    vi.stubEnv("DATABASE_URL", "postgres://app:s3cretpw@db.internal.example:6543/postgres");
    const real = text(await render("trust"));
    expect(real).toContain("This copy uses real AI: Claude models made by Anthropic.");
    expect(real).toContain("Emails are sent.");
    expect(real).toContain("Reports are saved in a database run by a hosting service");
    expect(real).toContain("the email that says your report arrived has your code in it");
    for (const secret of ["sk-ant", "re_not", "team@example.ca", "s3cretpw", "db.internal.example", "6543", "claude-sonnet"]) {
      expect(real).not.toContain(secret);
    }

    vi.stubEnv("FAKE_LLM", "1");
    vi.stubEnv("FAKE_EMAIL", "1");
    vi.stubEnv("DATABASE_URL", LOCAL_DB);
    const local = text(await render("trust"));
    expect(local).toContain("The AI is simulated.");
    expect(local).toContain("Emails are not sent.");
    expect(local).toContain("Reports are saved in a database on the computer that runs this copy.");
    expect(local).toContain("This copy does not send emails, so it can't email you the code either.");
    expect(local).not.toContain("real AI: Claude");

    vi.stubEnv("FAKE_LLM", "0");
    vi.stubEnv("AI_BACKEND", "something-else");
    expect(text(await render("trust"))).toContain("The AI setting on this copy is not working, so no AI is used.");
  });

  it("/accessibility links its feedback box to the demo organization's form, labelled as such", async () => {
    vi.stubEnv("DATABASE_URL", LOCAL_DB);
    const html = await render("accessibility");
    const box = html.slice(html.indexOf('id="tell-us"'));
    expect(box).toMatch(/<a [^>]*href="\/o\/maple-harbour\/report"/);
    expect(text(box)).toContain("Maple Harbour Bank");
    expect(text(box)).toContain("made-up organization");
    expect(text(box)).toContain("saved on the computer that runs AccessLoop");

    vi.stubEnv("DATABASE_URL", "postgres://u:p@db.internal.example:5432/x");
    expect(text(await render("accessibility"))).not.toContain("saved on the computer that runs AccessLoop");
  });
});
