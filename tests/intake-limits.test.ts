// The public report form's server actions and the Phase 7 limits (docs/archive/phase7-prompt.md T3 items 7-8):
// - the preview reserves its model calls from the hour's AI budget first; past it (or when the budget can't be
//   checked) no AI runs and the review says why (aiPaused), the reporter's own AI choice untouched;
// - "Send report" counts against the org's daily cap and, past it, says so in plain words with the org's phone and
//   email, saving nothing;
// - the acknowledgement email is recorded in a transaction of its own and sent only after it, never inside one.
// Everything around the actions is mocked: this checks the wiring, tests/rate-limit.test.ts the counting.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  budget: { ok: true } as { ok: boolean } | Error,
  cap: { ok: true } as { ok: boolean },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
  cookies: async () => ({ set: () => calls.push("cookie") }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    calls.push(`redirect ${to}`);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/orgs", () => ({
  getPublicOrg: async (slug: string) =>
    slug === "maple-harbour"
      ? {
          id: "8f6b0f5e-2a43-4c1e-9d6a-0b7c1e2f3a4b",
          slug,
          name: "Maple Harbour Bank",
          feedbackDesignateTitle: "Director",
          contactPhone: "1-800-555-0101",
          contactEmail: "access@example.org",
          contactMailingAddress: "1 Test Road",
        }
      : null,
}));
vi.mock("@/db/tenant", () => ({
  withOrg: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => {
    calls.push("transaction begins");
    const out = await fn({});
    calls.push("transaction commits");
    return out;
  },
}));
vi.mock("@/lib/cases/create", () => ({
  createCase: async () => {
    calls.push("createCase");
    return { case: { id: "case-1", ref: "BAR-0099" }, receiptCode: "7K3M-9Q2D-XW4H-B8RT" };
  },
}));
vi.mock("@/lib/intake/pipeline", () => ({
  buildPreview: async () => {
    calls.push("buildPreview");
    return { summary: "You could not open the door.", token: "sealed" };
  },
  prepareCase: async () => ({ orgId: "8f6b0f5e-2a43-4c1e-9d6a-0b7c1e2f3a4b" }),
}));
vi.mock("@/lib/email/case-emails", () => ({
  queueIntakeEmail: async () => {
    calls.push("queueIntakeEmail");
    return { messageId: "m1" };
  },
}));
vi.mock("@/lib/email/send", () => ({
  deliverEmail: async () => {
    calls.push("deliverEmail");
    return { messageId: "m1", status: "skipped_fake", at: new Date() };
  },
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...real,
    limitRequest: async () => ({ ok: true, count: 1, limit: 20 }),
    reserveAiForPreview: async (hasDetail: boolean) => {
      calls.push(`reserveAiForPreview ${hasDetail}`);
      if (state.budget instanceof Error) throw state.budget;
      return { ...state.budget, counted: true, used: null, limit: 300 };
    },
    limitOrgSubmission: async () => {
      calls.push("limitOrgSubmission");
      return { ...state.cap, counted: true, used: null, limit: 200 };
    },
  };
});

import { previewReport, submitReport } from "@/app/o/[orgSlug]/report/actions";

const REPORT = { text: "The door button is broken.", locationKind: "place", locationDetail: "", aiOptOut: false };
const SUBMIT = {
  ...REPORT,
  orgSlug: "maple-harbour",
  wantsRetest: true,
  emailChoice: "anonymous",
  email: "",
  choice: "ai_confirmed",
  editedSummary: "",
  token: "sealed",
};

beforeEach(() => {
  calls.length = 0;
  state.budget = { ok: true };
  state.cap = { ok: true };
});

describe("previewReport and the hour's AI budget", () => {
  it("reserves 2 calls (3 with 'Where exactly?') before any AI runs", async () => {
    expect(await previewReport("maple-harbour", REPORT)).toEqual({ ok: true, summary: "You could not open the door.", token: "sealed" });
    expect(calls).toEqual(["reserveAiForPreview false", "buildPreview"]);
    calls.length = 0;
    await previewReport("maple-harbour", { ...REPORT, locationDetail: "Main entrance" });
    expect(calls[0]).toBe("reserveAiForPreview true");
  });

  it("past the budget: no AI at all, no token (the manual path), and the review is told why", async () => {
    state.budget = { ok: false };
    expect(await previewReport("maple-harbour", REPORT)).toEqual({ ok: true, summary: null, token: null, aiPaused: true });
    expect(calls).not.toContain("buildPreview");
  });

  it("a budget that can't be checked is treated as spent, and logged without data", async () => {
    state.budget = new Error("database down");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await previewReport("maple-harbour", REPORT)).toMatchObject({ ok: true, summary: null, aiPaused: true });
    expect(errors.mock.calls.map((c) => c.join(" "))).toEqual(["[rate-limit] could not check the AI budget (Error)"]);
    errors.mockRestore();
  });

  it("with the AI opted out nothing is reserved", async () => {
    await previewReport("maple-harbour", { ...REPORT, aiOptOut: true });
    expect(calls).toEqual(["buildPreview"]);
  });
});

describe("submitReport and the org's daily cap", () => {
  it("past the cap: nothing is saved, and the reporter is told the other ways to reach the org", async () => {
    state.cap = { ok: false };
    const r = await submitReport(null, SUBMIT);
    expect(r).toMatchObject({
      ok: false,
      error:
        "This form has taken all the reports it can for today. Your answers are still here. Please try again tomorrow, " +
        "or tell Maple Harbour Bank by phone at 1-800-555-0101 or by email at access@example.org.",
    });
    expect(calls).toEqual(["limitOrgSubmission"]);
  });

  it("an invalid email is refused before the cap counts it", async () => {
    const r = await submitReport(null, { ...SUBMIT, emailChoice: "email", email: "not-an-email" });
    expect(r).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
  });

  it("within the cap the case is saved; its email is queued in its own transaction and sent only after it commits", async () => {
    await expect(
      submitReport(null, { ...SUBMIT, emailChoice: "email", email: "person@example.com" }),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(calls).toEqual([
      "limitOrgSubmission",
      "transaction begins",
      "createCase",
      "transaction commits",
      "transaction begins",
      "queueIntakeEmail",
      "transaction commits",
      "deliverEmail",
      "cookie",
      "redirect /o/maple-harbour/receipt",
    ]);
  });
});
