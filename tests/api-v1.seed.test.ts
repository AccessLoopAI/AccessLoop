// The reporter JSON API's route handlers (app/api/v1, docs/domain.md §4.1; Phase 7 T4.6) called as Next calls them,
// with real Requests, against a seeded in-memory Postgres (the migrations, the app role, the security SQL and the seed,
// as `npm run db:smoke` builds it), with the fake AI and FAKE_EMAIL=1. Only next/headers is stubbed (the rate limiter
// reads the client address from it). The cases are moved along by e2e/fixtures/advance.ts (the frozen core only).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { startSeededDb, type SeededDb } from "./support/seeded-db";

const client = vi.hoisted(() => ({ ip: "203.0.113.10" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": client.ip }) }));

const ORG = "maple-harbour";
const SCENARIO =
  "Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken for three " +
  "weeks, so I can't get in with my wheelchair. Call me at 416-555-0142.";
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

let seeded: SeededDb | undefined;
let sql: ReturnType<typeof postgres>;
let orgId = "";
const saved = { ...process.env };

beforeAll(async () => {
  seeded = await startSeededDb();
  Object.assign(process.env, seeded.env, {
    SESSION_SECRET: randomBytes(32).toString("base64"),
    FAKE_LLM: "1",
    AI_BACKEND: "fake",
    FAKE_EMAIL: "1",
  });
  sql = postgres(seeded.url, { prepare: false, max: 1, onnotice: () => {} });
  orgId = (await sql<{ id: string }[]>`select id from orgs where slug = ${ORG}`)[0].id;
}, 240_000);

afterAll(async () => {
  await sql?.end({ timeout: 5 }).catch(() => {});
  if (seeded) {
    const { db } = await import("@/db/client");
    await db.$client.end({ timeout: 5 }).catch(() => {});
    await seeded.stop();
  }
  process.env = { ...saved };
});

beforeEach(() => {
  client.ip = `203.0.113.${1 + Math.floor(Math.random() * 250)}`; // a fresh rate-limit bucket per test (mostly)
});

const routes = async () => ({
  org: await import("@/app/api/v1/orgs/[slug]/route"),
  preview: await import("@/app/api/v1/orgs/[slug]/preview/route"),
  reports: await import("@/app/api/v1/orgs/[slug]/reports/route"),
  status: await import("@/app/api/v1/status/route"),
  retest: await import("@/app/api/v1/retest/route"),
});

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const receipt = (code: string) => ({ authorization: `Receipt ${code}` });

async function getStatus(code: string | null, url = "/api/v1/status") {
  const { status } = await routes();
  return status.GET(new Request(`http://localhost:3000${url}`, { headers: code ? receipt(code) : {} }));
}

async function answer(code: string, body: unknown) {
  const { retest } = await routes();
  return retest.POST(post("/api/v1/retest", body, receipt(code)));
}

/** "Send report" through the API; returns the 201 body. */
async function send(body: Record<string, unknown>) {
  const { reports } = await routes();
  const res = await reports.POST(post(`/api/v1/orgs/${ORG}/reports`, body), ctx(ORG));
  expect(res.status, JSON.stringify(await res.clone().json())).toBe(201);
  return res.json() as Promise<{ receiptCode: string; reference: string }>;
}

interface CaseRow {
  id: string;
  status: string;
  wantsRetest: boolean;
  isAnonymous: boolean;
  aiOptOut: boolean;
  needsManualRedaction: boolean;
  summarySource: string | null;
  redactedText: string;
  locationDetail: string | null;
}

async function caseRow(ref: string): Promise<CaseRow> {
  const [row] = await sql<CaseRow[]>`
    select id, status, wants_retest as "wantsRetest", is_anonymous as "isAnonymous", ai_opt_out as "aiOptOut",
      needs_manual_redaction as "needsManualRedaction", summary_source as "summarySource",
      redacted_text as "redactedText", location_detail as "locationDetail"
    from cases where org_id = ${orgId} and ref = ${ref}`;
  if (!row) throw new Error(`no case ${ref}`);
  return row;
}

async function eventsOf(ref: string) {
  return sql<{ type: string; actorKind: string; payload: Record<string, unknown> }[]>`
    select e.type, e.actor_kind as "actorKind", e.payload from case_events e join cases c on c.id = e.case_id
    where c.org_id = ${orgId} and c.ref = ${ref} order by e.seq`;
}

async function caseCount(): Promise<number> {
  return (await sql<{ n: number }[]>`select count(*)::int as n from cases where org_id = ${orgId}`)[0].n;
}

function expectNoCookie(res: Response) {
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(res.headers.get("cache-control")).toBe("no-store");
}

describe("GET /api/v1/orgs/{slug}", () => {
  it("gives the organization's public profile and the form's answers; an unknown or malformed slug is a 404", async () => {
    const { org } = await routes();
    const res = await org.GET(new Request("http://localhost:3000/api/v1/orgs/maple-harbour"), ctx(ORG));
    expect(res.status).toBe(200);
    expectNoCookie(res);
    const body = await res.json();
    expect(body.organization).toMatchObject({ slug: ORG, name: "Maple Harbour Bank", feedbackPage: "/p/maple-harbour" });
    expect(body.organization.contact.phone).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain(orgId);
    expect(body.form.followUp).toHaveLength(3);
    for (const slug of ["no-such-org", "Not_A_Slug"]) {
      const missing = await org.GET(new Request(`http://localhost:3000/api/v1/orgs/${slug}`), ctx(slug));
      expect(missing.status).toBe(404);
      expect((await missing.json()).error.code).toBe("not_found");
    }
  });
});

describe("preview, report, status: the web form's intake through the API", () => {
  it("returns the receipt code exactly once and stores the case as the web form does", async () => {
    const { preview } = await routes();
    const before = await caseCount();
    const pres = await preview.POST(
      post(`/api/v1/orgs/${ORG}/preview`, { text: SCENARIO, locationKind: "place", locationDetail: "King Street branch, main entrance" }),
      ctx(ORG),
    );
    expect(pres.status).toBe(200);
    expectNoCookie(pres);
    const p = (await pres.json()) as { summary: string | null; previewToken: string | null };
    expect(Object.keys(p).sort()).toEqual(["previewToken", "summary"]); // never the suggested areas or layer-2 values
    expect(typeof p.summary).toBe("string");
    expect(p.previewToken).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    expect(await caseCount()).toBe(before); // a preview saves nothing

    const { reports } = await routes();
    const res = await reports.POST(
      post(`/api/v1/orgs/${ORG}/reports`, {
        text: SCENARIO,
        locationKind: "place",
        locationDetail: "King Street branch, main entrance",
        followUp: "code",
        summaryChoice: "ai_confirmed",
        previewToken: p.previewToken,
      }),
      ctx(ORG),
    );
    expect(res.status).toBe(201);
    expectNoCookie(res);
    const r = await res.json();
    expect(r.receiptCode).toMatch(CODE_RE);
    expect(r.reference).toMatch(/^BAR-\d{4}$/);
    expect(r).toMatchObject({ status: "new", statusLabel: "We got your report", organization: { slug: ORG } });
    expect(r.receiptCodeSpelledOut).toHaveLength(2);
    expect(await caseCount()).toBe(before + 1);

    const c = await caseRow(r.reference);
    expect(c).toMatchObject({ status: "new", wantsRetest: true, isAnonymous: true, aiOptOut: false, summarySource: "ai_confirmed" });
    expect(c.needsManualRedaction).toBe(false); // the token's layer 2 was used (the fake flagPii found the name)
    expect(c.redactedText).toContain("[PERSON]");
    expect(c.redactedText).toContain("[PHONE]");
    expect(c.redactedText).not.toContain("Daniel Okafor");
    expect((await eventsOf(r.reference)).map((e) => e.type)).toEqual(
      expect.arrayContaining(["submitted", "ack_recorded", "ai_structured", "redaction_proposed"]),
    );

    // The status: the code only in the Authorization header (any case, no hyphens), never given back.
    const sres = await getStatus(r.receiptCode.replace(/-/g, "").toLowerCase());
    expect(sres.status).toBe(200);
    expectNoCookie(sres);
    const s = await sres.json();
    expect(s).toMatchObject({ reference: r.reference, status: "new", statusLabel: "We got your report", retest: null, wantsRetest: true });
    const text = JSON.stringify(s);
    expect(text).not.toContain(r.receiptCode);
    expect(text).not.toContain(r.receiptCode.replace(/-/g, ""));
    expect(text).not.toContain("Daniel");

    // Never from the URL: a code in the query string is ignored (401), and so is another scheme.
    expect((await getStatus(null, `/api/v1/status?code=${r.receiptCode}`)).status).toBe(401);
    const { status } = await routes();
    const bearer = await status.GET(new Request("http://localhost:3000/api/v1/status", { headers: { authorization: `Bearer ${r.receiptCode}` } }));
    expect(bearer.status).toBe(401);
    expect(bearer.headers.get("www-authenticate")).toMatch(/^Receipt /);
  });

  it("an unknown code is a 404 with the same words as /check", async () => {
    const res = await getStatus("0000-0000-0000-0000");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toEqual({ code: "not_found", message: "We couldn't find a report with that code. Check it and try again." });
  });

  it("without a preview token nothing is taken from the AI and a person checks for names", async () => {
    const r = await send({ text: SCENARIO, locationKind: "place", followUp: "none", summaryChoice: "ai_confirmed", previewToken: "forged.0000" });
    const c = await caseRow(r.reference);
    expect(c).toMatchObject({ wantsRetest: false, isAnonymous: true, summarySource: "reporter_words", needsManualRedaction: true });
    expect(c.redactedText).toContain("[PHONE]");
    expect((await eventsOf(r.reference)).map((e) => e.type)).not.toContain("ai_structured");
  });

  it("aiOptOut: no summary and no token from the preview; the case is stored without AI", async () => {
    const { preview } = await routes();
    const pres = await preview.POST(post(`/api/v1/orgs/${ORG}/preview`, { text: SCENARIO, locationKind: "digital", aiOptOut: true }), ctx(ORG));
    expect(await pres.json()).toEqual({ summary: null, previewToken: null });
    const r = await send({ text: SCENARIO, locationKind: "digital", followUp: "code", aiOptOut: true });
    expect(await caseRow(r.reference)).toMatchObject({ aiOptOut: true, needsManualRedaction: true, summarySource: "reporter_words" });
  });

  it("email follow-up: the acknowledgement is recorded in the Outbox; a bad address saves nothing", async () => {
    const { reports } = await routes();
    const before = await caseCount();
    const bad = await reports.POST(
      post(`/api/v1/orgs/${ORG}/reports`, { text: SCENARIO, locationKind: "place", followUp: "email", email: "not an email" }),
      ctx(ORG),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatchObject({ code: "invalid_email", fields: ["email"] });
    expect(await caseCount()).toBe(before);

    const r = await send({ text: SCENARIO, locationKind: "place", followUp: "email", email: "reporter@example.com" });
    const c = await caseRow(r.reference);
    expect(c).toMatchObject({ isAnonymous: false, wantsRetest: true });
    const sent = await sql<{ template: string; status: string }[]>`
      select template, status from outbound_messages where org_id = ${orgId} and case_id = ${c.id}`;
    expect(sent).toEqual([{ template: "ack", status: "skipped_fake" }]);
  });
});

describe("POST /api/v1/retest", () => {
  it("'fixed' verifies the case through the receipt code; a second answer is refused and changes nothing", async () => {
    const { advanceToRetest } = await import("@/e2e/fixtures/advance");
    const r = await send({ text: `${SCENARIO} (re-test ${Date.now()})`, locationKind: "place", followUp: "code" });
    // Before the re-test is open, the question does not exist yet.
    const early = await answer(r.receiptCode, { answer: "fixed" });
    expect(early.status).toBe(409);
    expect((await early.json()).error.code).toBe("already_answered");

    await advanceToRetest(ORG, r.reference);
    const open = await (await getStatus(r.receiptCode)).json();
    expect(open).toMatchObject({ status: "retest_open", statusLabel: "Please tell us if it works now" });
    expect(open.retest.question).toBe("Does it work for you now?");
    expect(open.retest.answers.map((a: { value: string }) => a.value)).toEqual(["fixed", "partly", "not_fixed", "cant_check", "opt_out"]);
    expect(open.fixDescription).toBe("Replaced the door operator and tested it.");

    const res = await answer(r.receiptCode, { answer: "fixed", comment: "  Works now, thank you.  " });
    expect(res.status).toBe(200);
    expectNoCookie(res);
    const body = await res.json();
    expect(body).toMatchObject({
      answer: "fixed",
      message: "Thank you. It's now marked as fixed and confirmed by you.",
      report: { status: "verified", statusLabel: "Fixed and confirmed by you", retest: null },
    });
    expect(JSON.stringify(body)).not.toContain(r.receiptCode);
    expect((await caseRow(r.reference)).status).toBe("verified");
    const verdicts = (await eventsOf(r.reference)).filter((e) => e.type === "retest_verdict");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ actorKind: "reporter", payload: { verdict: "fixed", via: "receipt_code", round: 1 } });

    const again = await answer(r.receiptCode, { answer: "not_fixed" });
    expect(again.status).toBe(409);
    expect((await caseRow(r.reference)).status).toBe("verified");
    expect((await eventsOf(r.reference)).filter((e) => e.type === "retest_verdict")).toHaveLength(1);
  });

  it("'Don't contact me about this again' works at any time, keeps the status and keeps a comment redacted", async () => {
    const r = await send({ text: `${SCENARIO} (opt out ${Date.now()})`, locationKind: "place", followUp: "code" });
    const res = await answer(r.receiptCode, { answer: "opt_out", comment: "Please stop. Call 416-555-0142 if you must." });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ answer: "opt_out", message: "We won't contact you about this report again.", report: { status: "new", wantsRetest: false, canStopContact: false } });
    const c = await caseRow(r.reference);
    expect(c).toMatchObject({ status: "new", wantsRetest: false });
    const note = (await eventsOf(r.reference)).find((e) => e.type === "note_added");
    expect(String(note?.payload.note)).toContain("[PHONE]");
    expect(JSON.stringify(note?.payload)).not.toContain("416-555-0142");
    // Again: still true, nothing new to record.
    const n = (await eventsOf(r.reference)).length;
    expect((await answer(r.receiptCode, { answer: "opt_out" })).status).toBe(200);
    expect((await eventsOf(r.reference)).length).toBe(n);
  });

  it("refuses a missing code, a bad body, a long comment and an unknown code, saving nothing", async () => {
    const { retest } = await routes();
    const r = await send({ text: `${SCENARIO} (errors ${Date.now()})`, locationKind: "place", followUp: "code" });
    const n = (await eventsOf(r.reference)).length;

    const noCode = await retest.POST(post("/api/v1/retest", { answer: "opt_out" }));
    expect(noCode.status).toBe(401);
    const inBody = await retest.POST(post("/api/v1/retest", { answer: "opt_out", code: r.receiptCode }));
    expect(inBody.status).toBe(401); // the body is never read for a code
    const form = await retest.POST(post("/api/v1/retest", "answer=opt_out", { ...receipt(r.receiptCode), "content-type": "application/x-www-form-urlencoded" }));
    expect(form.status).toBe(415);
    const invalid = await answer(r.receiptCode, { answer: "verified" });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatchObject({ code: "invalid_request", fields: ["answer"] });
    const long = await answer(r.receiptCode, { answer: "opt_out", comment: "x".repeat(1001) });
    expect(long.status).toBe(400);
    expect((await long.json()).error).toEqual({ code: "comment_too_long", message: "Keep your comment under 1,000 characters.", fields: ["comment"] });
    const unknown = await answer("0000-0000-0000-0000", { answer: "opt_out" });
    expect(unknown.status).toBe(404);

    expect((await eventsOf(r.reference)).length).toBe(n);
    expect((await caseRow(r.reference)).wantsRetest).toBe(true);
  });
});

describe("errors and limits", () => {
  it("refuses a body that is not JSON, an unknown key, an unknown org; never echoes what was sent", async () => {
    const { preview, reports } = await routes();
    const before = await caseCount();
    const notJson = await reports.POST(post(`/api/v1/orgs/${ORG}/reports`, "text=hi", { "content-type": "text/plain" }), ctx(ORG));
    expect(notJson.status).toBe(415);
    const broken = await reports.POST(post(`/api/v1/orgs/${ORG}/reports`, "{"), ctx(ORG));
    expect(broken.status).toBe(400);
    const withOrg = await reports.POST(
      post(`/api/v1/orgs/${ORG}/reports`, { text: "secret words 416-555-0142", locationKind: "place", followUp: "none", orgId: "x" }),
      ctx(ORG),
    );
    expect(withOrg.status).toBe(400);
    const err = await withOrg.text();
    expect(JSON.parse(err).error.fields).toEqual(["orgId"]);
    expect(err).not.toContain("secret words");
    const unknownOrg = await preview.POST(post("/api/v1/orgs/no-such-org/preview", { text: "x", locationKind: "place" }), ctx("no-such-org"));
    expect(unknownOrg.status).toBe(404);
    const unknownOrgReport = await reports.POST(post("/api/v1/orgs/no-such-org/reports", { text: "x", locationKind: "place", followUp: "none" }), ctx("no-such-org"));
    expect(unknownOrgReport.status).toBe(404);
    expect(await caseCount()).toBe(before);
  });

  it("counts requests in the web's own buckets: past the limit it is 429 with Retry-After, before anything is read", async () => {
    const WINDOW = 10 * 60_000;
    const left = WINDOW - (Date.now() % WINDOW);
    if (left < 15_000) await new Promise((resolve) => setTimeout(resolve, left + 500)); // not across a window edge
    client.ip = `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}::1`;
    const { retest } = await routes();
    for (let i = 0; i < 60; i++) expect((await retest.POST(post("/api/v1/retest", {}))).status).toBe(401);
    const over = await retest.POST(post("/api/v1/retest", { answer: "fixed" }, receipt("0000-0000-0000-0000")));
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await over.json()).error).toEqual({ code: "rate_limited", message: "Too many tries from this connection. Please wait a few minutes and try again." });
    // Another address is not affected.
    client.ip = "198.51.100.77";
    expect((await retest.POST(post("/api/v1/retest", {}))).status).toBe(401);
  }, 60_000);
});
