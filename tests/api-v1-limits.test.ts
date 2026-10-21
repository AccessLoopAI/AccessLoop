// The reporter JSON API (app/api/v1, docs/domain.md §4.1) and the Phase 7 spend and abuse limits of domain §9 (T3 item 7),
// wired in at the integration of T3 and T4: the API's preview reserves its model calls from the same hour's AI budget as
// the web form (past it, or when it can't be checked, no AI runs, no token, `aiPaused`), and its "Send report" goes
// through the same lib/intake/submit.ts, so the org's daily cap is counted there too (after the email check, before
// anything is saved) and the acknowledgement email is sent only after its transaction commits.
// Everything around the routes is mocked: this checks the wiring; tests/rate-limit.test.ts checks the counting and
// tests/intake-limits.test.ts the web form's server actions.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  budget: { ok: true } as { ok: boolean } | Error,
  cap: { ok: true } as { ok: boolean } | Error,
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
      if (state.cap instanceof Error) throw state.cap;
      return { ...state.cap, counted: true, used: null, limit: 200 };
    },
  };
});

import { POST as previewPost } from "@/app/api/v1/orgs/[slug]/preview/route";
import { POST as reportsPost } from "@/app/api/v1/orgs/[slug]/reports/route";

const ctx = { params: Promise.resolve({ slug: "maple-harbour" }) };
const REPORT = { text: "The door button is broken.", locationKind: "place" };

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000" },
    body: JSON.stringify(body),
  });
}

const preview = (body: unknown) => previewPost(post("/api/v1/orgs/maple-harbour/preview", body), ctx);
const send = (body: unknown) => reportsPost(post("/api/v1/orgs/maple-harbour/reports", body), ctx);

beforeEach(() => {
  calls.length = 0;
  state.budget = { ok: true };
  state.cap = { ok: true };
});

describe("POST /api/v1/orgs/{slug}/preview and the hour's AI budget", () => {
  it("reserves 2 calls (3 with 'Where exactly?') before any AI runs", async () => {
    const res = await preview(REPORT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: "You could not open the door.", previewToken: "sealed" });
    expect(calls).toEqual(["reserveAiForPreview false", "buildPreview"]);
    calls.length = 0;
    await preview({ ...REPORT, locationDetail: "Main entrance" });
    expect(calls[0]).toBe("reserveAiForPreview true");
  });

  it("past the budget: no AI at all and no token (the manual path), and the app is told why", async () => {
    state.budget = { ok: false };
    const res = await preview(REPORT);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: null, previewToken: null, aiPaused: true });
    expect(calls).not.toContain("buildPreview");
  });

  it("a budget that can't be checked is treated as spent, and logged without data", async () => {
    state.budget = new Error("database down");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await preview(REPORT)).json()).toMatchObject({ summary: null, previewToken: null, aiPaused: true });
    expect(errors.mock.calls.map((c) => c.join(" "))).toEqual(["[rate-limit] could not check the AI budget (api) (Error)"]);
    errors.mockRestore();
  });

  it("with the AI opted out nothing is reserved", async () => {
    await preview({ ...REPORT, aiOptOut: true });
    expect(calls).toEqual(["buildPreview"]);
  });
});

describe("POST /api/v1/orgs/{slug}/reports and the org's daily cap", () => {
  const SEND = { ...REPORT, followUp: "code", summaryChoice: "ai_confirmed", previewToken: "sealed" };

  it("past the cap: 429 org_full, nothing saved, and the message names the org's phone and email", async () => {
    state.cap = { ok: false };
    const res = await send(SEND);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      error: {
        code: "org_full",
        message:
          "This form has taken all the reports it can for today. Your answers are still here. Please try again tomorrow, " +
          "or tell Maple Harbour Bank by phone at 1-800-555-0101 or by email at access@example.org.",
      },
    });
    expect(calls).toEqual(["limitOrgSubmission"]);
  });

  it("an invalid email is refused before the cap counts it", async () => {
    const res = await send({ ...SEND, followUp: "email", email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("a cap that can't be checked saves nothing (500 failed), logged without data", async () => {
    state.cap = new Error("database down");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await send(SEND);
    expect(res.status).toBe(500);
    expect(calls).toEqual(["limitOrgSubmission"]);
    expect(errors.mock.calls.map((c) => c.join(" "))).toEqual(["[rate-limit] could not check the daily limit (Error)"]);
    errors.mockRestore();
  });

  it("within the cap the case is saved; its email is queued in its own transaction and sent only after it commits", async () => {
    const res = await send({ ...SEND, followUp: "email", email: "person@example.com" });
    expect(res.status).toBe(201);
    expect((await res.json()).receiptCode).toBe("7K3M-9Q2D-XW4H-B8RT");
    expect(calls).toEqual([
      "limitOrgSubmission",
      "transaction begins",
      "createCase",
      "transaction commits",
      "transaction begins",
      "queueIntakeEmail",
      "transaction commits",
      "deliverEmail",
    ]);
  });
});
