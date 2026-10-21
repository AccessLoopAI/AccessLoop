// The reporter JSON API's plumbing and shapes (lib/api/v1, docs/domain.md §4.1; Phase 7 T4.6): the receipt code only
// from `Authorization: Receipt ...`, JSON bodies read with a size cap, one error shape that never echoes what was
// sent, strict request schemas mapped onto the web form's own SubmitRequest, and response bodies that never hold
// the receipt code except the one receipt. tests/api-v1.seed.test.ts runs the route handlers on a seeded database.
import { describe, expect, it } from "vitest";
import {
  API_MAX_BODY_BYTES,
  apiError,
  apiJson,
  fieldsOf,
  missingCode,
  readJsonBody,
  receiptCodeFromAuthorization,
  retryAfterSeconds,
} from "@/lib/api/v1/http";
import {
  PreviewBody,
  ReportBody,
  RetestBody,
  orgBody,
  receiptBody,
  retestAnsweredBody,
  statusBody,
  toPreviewRequest,
  toSubmitRequest,
} from "@/lib/api/v1/reporter";
import type { PublicOrg } from "@/lib/orgs";
import type { ReporterCase } from "@/lib/reporter-case";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { RETEST_ANSWERS, RETEST_RESULT_MESSAGES } from "@/lib/retest";

const CODE = "7K3M-9QXD-2B4F-HJ6P";
const NORMALIZED = "7K3M9QXD2B4FHJ6P";

const ORG: PublicOrg = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "maple-harbour",
  name: "Maple Harbour Bank",
  feedbackDesignateTitle: "Accessibility Lead",
  contactPhone: "1-800-555-0101",
  contactEmail: "access@mapleharbour.example",
  contactMailingAddress: "1 Harbour Road, Halifax, NS B3H 0A1",
};

function reporterCase(overrides: Partial<ReporterCase> = {}): ReporterCase {
  return {
    orgId: ORG.id,
    caseId: "00000000-0000-4000-8000-000000000002",
    orgName: ORG.name,
    orgSlug: ORG.slug,
    retestOfferText: "We offer a $25 gift card to thank you for checking a fix.",
    ref: "BAR-0042",
    status: "new",
    closedReason: null,
    receivedAt: new Date("2026-10-20T14:00:00.000Z"),
    wantsRetest: true,
    retestRound: 0,
    fixDescription: null,
    ...overrides,
  };
}

function jsonRequest(body: string, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://localhost/api/v1/x", { method: "POST", headers, body });
}

describe("the receipt code comes only from Authorization: Receipt", () => {
  it("accepts the code as /check does: any case, with or without hyphens or spaces, any scheme case", () => {
    expect(receiptCodeFromAuthorization(`Receipt ${CODE}`)).toBe(NORMALIZED);
    expect(receiptCodeFromAuthorization(`receipt ${CODE.toLowerCase()}`)).toBe(NORMALIZED);
    expect(receiptCodeFromAuthorization(`RECEIPT  ${NORMALIZED}  `)).toBe(NORMALIZED);
    expect(receiptCodeFromAuthorization("Receipt 7K3M 9QXD 2B4F HJ6P")).toBe(NORMALIZED);
  });

  it("refuses no header, another scheme, a bare code and a malformed code", () => {
    expect(receiptCodeFromAuthorization(null)).toBeNull();
    expect(receiptCodeFromAuthorization("")).toBeNull();
    expect(receiptCodeFromAuthorization(`Bearer ${CODE}`)).toBeNull();
    expect(receiptCodeFromAuthorization(CODE)).toBeNull();
    expect(receiptCodeFromAuthorization("Receipt ABCD-1234")).toBeNull();
    expect(receiptCodeFromAuthorization("Receipt ")).toBeNull();
    expect(receiptCodeFromAuthorization(`Receipt ${"A".repeat(300)}`)).toBeNull();
  });

  it("answers 401 with the scheme to use", async () => {
    const res = missingCode();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Receipt /);
    expect((await res.json()).error.code).toBe("missing_code");
  });
});

describe("responses", () => {
  it("are JSON, never cached, never set a cookie", async () => {
    const res = apiJson({ ok: 1 }, 201);
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it("errors have one shape with plain words, and fields only when given", async () => {
    expect(await apiError(404, "not_found").json()).toEqual({ error: { code: "not_found", message: "We couldn't find it." } });
    const res = apiError(400, "invalid_request", { fields: ["text"], headers: { "retry-after": "5" } });
    expect(res.headers.get("retry-after")).toBe("5");
    expect((await res.json()).error).toEqual({
      code: "invalid_request",
      message: "Part of the request could not be read. Check the answers and try again.",
      fields: ["text"],
    });
  });

  it("Retry-After counts down to the end of the route's fixed window", () => {
    const w = RATE_LIMITS.verdict.windowMs;
    expect(retryAfterSeconds("verdict", 0)).toBe(w / 1000);
    expect(retryAfterSeconds("verdict", w - 1500)).toBe(2);
    expect(retryAfterSeconds("verdict", w - 1)).toBe(1);
  });
});

describe("readJsonBody", () => {
  it("reads JSON (a charset is fine)", async () => {
    const r = await readJsonBody(jsonRequest('{"a":"é"}', { "content-type": "Application/JSON; charset=utf-8" }));
    expect(r).toEqual({ ok: true, value: { a: "é" } });
  });

  it("refuses anything that is not JSON with 415, before reading it", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const r = await readJsonBody(jsonRequest("{}", type ? { "content-type": type } : {}));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(415);
    }
  });

  it("refuses a body over the cap with 413, declared or streamed", async () => {
    const big = JSON.stringify({ text: "x".repeat(API_MAX_BODY_BYTES) });
    const declared = await readJsonBody(jsonRequest("{}", { "content-type": "application/json", "content-length": String(API_MAX_BODY_BYTES + 1) }));
    expect(declared.ok || declared.response.status).toBe(413);
    const streamed = await readJsonBody(jsonRequest(big));
    expect(streamed.ok || streamed.response.status).toBe(413);
    const small = await readJsonBody(jsonRequest("{}"), 1);
    expect(small.ok || small.response.status).toBe(413);
  });

  it("refuses broken JSON, broken UTF-8 and an empty body with 400 invalid_json", async () => {
    for (const body of ["{", "", "nope"]) {
      const r = await readJsonBody(jsonRequest(body));
      expect(r.ok).toBe(false);
      if (!r.ok) expect((await r.response.json()).error.code).toBe("invalid_json");
    }
    const bad = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([0x22, 0xff, 0x22]) });
    const r = await readJsonBody(bad);
    expect(r.ok || r.response.status).toBe(400);
  });
});

describe("request schemas", () => {
  const report = { text: "  The door button is broken.  ", locationKind: "place", followUp: "code" };

  it("a preview: trimmed text, defaults for the optional parts", () => {
    const p = PreviewBody.parse({ text: " Door ", locationKind: "place" });
    expect(toPreviewRequest(p)).toEqual({ text: "Door", locationKind: "place", locationDetail: "", aiOptOut: false });
    expect(PreviewBody.safeParse({ text: "   ", locationKind: "place" }).success).toBe(false);
    expect(PreviewBody.safeParse({ text: "x", locationKind: "moon" }).success).toBe(false);
  });

  it("a report: the three follow-up answers map onto the web form's wantsRetest and emailChoice", () => {
    const none = toSubmitRequest(ReportBody.parse({ ...report, followUp: "none", email: "a@b.example" }));
    expect(none).toMatchObject({ wantsRetest: false, emailChoice: "anonymous", email: "" });
    const code = toSubmitRequest(ReportBody.parse({ ...report, email: "a@b.example" }));
    expect(code).toMatchObject({ wantsRetest: true, emailChoice: "anonymous", email: "" }); // never stored without "email"
    const email = toSubmitRequest(ReportBody.parse({ ...report, followUp: "email", email: " a@b.example " }));
    expect(email).toMatchObject({ wantsRetest: true, emailChoice: "email", email: "a@b.example" });
  });

  it("a report: defaults, and the preview token and summary choice passed through", () => {
    expect(toSubmitRequest(ReportBody.parse(report))).toEqual({
      text: "The door button is broken.",
      locationKind: "place",
      locationDetail: "",
      wantsRetest: true,
      emailChoice: "anonymous",
      email: "",
      aiOptOut: false,
      choice: null,
      editedSummary: "",
      token: null,
    });
    const r = toSubmitRequest(ReportBody.parse({ ...report, summaryChoice: "ai_edited", editedSummary: "Mine", previewToken: "t.k" }));
    expect(r).toMatchObject({ choice: "ai_edited", editedSummary: "Mine", token: "t.k" });
  });

  it("is strict: an org id (or any unknown key) in the body is refused, and named without its value", () => {
    const r = ReportBody.safeParse({ ...report, orgId: "00000000-0000-4000-8000-000000000009", wantsRetest: true });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldsOf(r.error).sort()).toEqual(["orgId", "wantsRetest"]);
    const missing = ReportBody.safeParse({ text: "x", locationKind: "place", followUp: "maybe" });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(fieldsOf(missing.error)).toEqual(["followUp"]);
      expect(JSON.stringify(fieldsOf(missing.error))).not.toContain("maybe");
    }
    expect(fieldsOf(ReportBody.safeParse("text").error!)).toEqual(["(body)"]);
  });

  it("a re-test answer: one of the five, the comment trimmed", () => {
    expect(RetestBody.parse({ answer: "fixed", comment: "  works  " })).toEqual({ answer: "fixed", comment: "works" });
    expect(RetestBody.parse({ answer: "opt_out" })).toEqual({ answer: "opt_out", comment: "" });
    expect(RetestBody.safeParse({ answer: "verified" }).success).toBe(false);
    expect(RetestBody.safeParse({ answer: "fixed", caseId: "x" }).success).toBe(false);
  });
});

describe("response bodies", () => {
  it("the org profile: public contacts, the form's answers in the web form's words, the limits", () => {
    const b = orgBody(ORG);
    expect(b.organization).toEqual({
      slug: "maple-harbour",
      name: "Maple Harbour Bank",
      feedbackPage: "/p/maple-harbour",
      contact: {
        designatedTitle: "Accessibility Lead",
        phone: "1-800-555-0101",
        email: "access@mapleharbour.example",
        mailingAddress: "1 Harbour Road, Halifax, NS B3H 0A1",
      },
    });
    expect(JSON.stringify(b)).not.toContain(ORG.id); // never the internal id
    expect(b.form.followUp.map((o) => o.label)).toEqual(["Don't contact me", "Let me check the fix with my code", "Email me, and let me check the fix"]);
    expect(b.form.locationKinds.map((o) => o.label)).toContain("At a place");
    expect(b.form.limits.text).toBe(6000);
  });

  it("the receipt: the code, spelled out, the reference, and the shown-once notice", () => {
    const b = receiptBody(ORG, { receiptCode: CODE, ref: "BAR-0042", receivedAt: new Date("2026-10-20T14:00:00.000Z") });
    expect(b).toMatchObject({ receiptCode: CODE, reference: "BAR-0042", status: "new", statusLabel: "We got your report" });
    expect(b.receiptCodeSpelledOut[0]).toMatch(/^seven, K for Kilo, three, M for Mike, /);
    expect(b.notice).toMatch(/only this once/);
  });

  it("the status: the reporter's words, the re-test question only while it is open, never the code", () => {
    const fresh = statusBody(reporterCase(), ORG);
    expect(fresh).toMatchObject({ reference: "BAR-0042", status: "new", statusLabel: "We got your report", retest: null, canStopContact: true });
    expect(JSON.stringify(fresh)).not.toMatch(/[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/);
    expect(JSON.stringify(fresh)).not.toContain(ORG.id);

    const open = statusBody(reporterCase({ status: "retest_open", fixDescription: "Replaced the door operator." }), ORG);
    expect(open.statusLabel).toBe("Please tell us if it works now");
    expect(open.canStopContact).toBe(false);
    expect(open.retest?.question).toBe("Does it work for you now?");
    expect(open.retest?.answers.map((a) => a.label)).toEqual(RETEST_ANSWERS.map((a) => a.label));
    expect(open.retest?.offerText).toMatch(/gift card/);
    expect(open.fixDescription).toBe("Replaced the door operator.");

    const closed = statusBody(reporterCase({ status: "closed", closedReason: "duplicate" }), null);
    expect(closed).toMatchObject({ statusLabel: "Closed: someone already reported this", closedReason: "duplicate", canStopContact: false });
    expect(closed.organization).toEqual({ slug: "maple-harbour", name: "Maple Harbour Bank", feedbackPage: "/p/maple-harbour" });
  });

  it("a saved answer: the web page's own sentence", () => {
    expect(retestAnsweredBody("fixed", null)).toEqual({ answer: "fixed", message: RETEST_RESULT_MESSAGES.fixed, report: null });
    expect(RETEST_RESULT_MESSAGES.fixed).toBe("Thank you. It's now marked as fixed and confirmed by you.");
  });
});
