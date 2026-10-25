// The reporter JSON API for the Expo app (docs/domain.md §4.1; Phase 7 T4.6), request by request against the local
// production build: an organization's profile, preview, "Send report", the status with the code only in the
// Authorization header, and the re-test answer. It reuses the web form's pipeline, so a case sent here is the same
// case staff see, and a code from the web form works here. Every request carries its own made-up client address
// (IPv6 documentation range, a /64 of its own), so it never spends the 127.0.0.1 buckets the rest of the suite uses.
// Cases are moved along by e2e/fixtures/advance.ts (the frozen core only). Specs share one database: no fixed counts.
import { randomBytes } from "node:crypto";
import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { caseFacts, fileReport } from "./fixtures/cases";
import { advanceToRetest } from "./fixtures/advance";

const ORG = "maple-harbour";
const LAKEVIEW = "lakeview-telecom";
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const hex = () => randomBytes(2).toString("hex");
const freshIp = () => `2001:db8:${hex()}:${hex()}::${hex()}`;
const doorText = () =>
  `Hi, my name is Daniel Okafor. The automatic door button at the King Street branch is broken again, so I can't get ` +
  `in with my wheelchair (api ${Date.now().toString(36)}-${hex()}). Call me at 416-555-0142.`;

/** JSON requests from one made-up address. */
function client(request: APIRequestContext, ip = freshIp()) {
  const headers = (extra: Record<string, string> = {}) => ({ "x-forwarded-for": ip, ...extra });
  return {
    get: (path: string, extra?: Record<string, string>) => request.get(path, { headers: headers(extra) }),
    post: (path: string, data: unknown, extra?: Record<string, string>) =>
      request.post(path, { headers: headers({ "content-type": "application/json", ...extra }), data: JSON.stringify(data) }),
    status: (code: string) => request.get("/api/v1/status", { headers: headers({ authorization: `Receipt ${code}` }) }),
    answer: (code: string, data: unknown) =>
      request.post("/api/v1/retest", {
        headers: headers({ "content-type": "application/json", authorization: `Receipt ${code}` }),
        data: JSON.stringify(data),
      }),
  };
}

/** Never cached, never a cookie, always JSON. */
function expectApiHeaders(res: APIResponse, label: string) {
  const h = res.headers();
  expect(h["set-cookie"], `${label}: no cookie`).toBeUndefined();
  expect(h["cache-control"], label).toBe("no-store");
  expect(h["content-type"], label).toBe("application/json; charset=utf-8");
  expect(h["x-powered-by"], label).toBeUndefined();
}

test("an organization's profile: its public contacts and the form's answers; an unknown slug is a 404", async ({ request }) => {
  const api = client(request);
  const res = await api.get(`/api/v1/orgs/${ORG}`);
  expect(res.status()).toBe(200);
  expectApiHeaders(res, "org profile");
  const body = await res.json();
  expect(body.organization).toMatchObject({ slug: ORG, feedbackPage: `/p/${ORG}` });
  expect(body.organization.contact).toEqual(expect.objectContaining({ phone: expect.any(String), email: expect.any(String) }));
  expect(body.form.followUp.map((o: { label: string }) => o.label)).toEqual([
    "Don't contact me",
    "Let me check the fix with my code",
    "Email me, and let me check the fix",
  ]);
  const missing = await api.get("/api/v1/orgs/no-such-org");
  expect(missing.status()).toBe(404);
  expect((await missing.json()).error.code).toBe("not_found");
});

test("preview, send, status, re-test: one loop through the API, and the web page agrees", async ({ request }) => {
  const api = client(request);
  const text = doorText();

  // Step 3 "Next": the summary and the sealed token, never the suggested areas.
  const preview = await api.post(`/api/v1/orgs/${ORG}/preview`, { text, locationKind: "place", locationDetail: "King Street branch" });
  expect(preview.status()).toBe(200);
  expectApiHeaders(preview, "preview");
  const p = await preview.json();
  expect(Object.keys(p).sort()).toEqual(["previewToken", "summary"]);
  expect(p.summary).toEqual(expect.any(String));
  expect(p.previewToken).toEqual(expect.any(String));

  // "Send report": the receipt code, once.
  const sent = await api.post(`/api/v1/orgs/${ORG}/reports`, {
    text,
    locationKind: "place",
    locationDetail: "King Street branch",
    followUp: "code",
    summaryChoice: "ai_confirmed",
    previewToken: p.previewToken,
  });
  expect(sent.status()).toBe(201);
  expectApiHeaders(sent, "send");
  const r = await sent.json();
  expect(r.receiptCode).toMatch(CODE_RE);
  expect(r.reference).toMatch(/^BAR-\d{4}$/);
  expect(r).toMatchObject({ status: "new", statusLabel: "We got your report" });

  // The case staff see: redacted on the server with the preview's layer 2, the AI summary confirmed.
  const stored = await caseFacts(ORG, r.reference);
  expect(stored.status).toBe("new");
  expect(stored.redactedText).toContain("[PERSON]");
  expect(stored.redactedText).toContain("[PHONE]");
  expect(stored.redactedText).not.toContain("Daniel Okafor");
  expect(stored.summary).toBe(p.summary);
  expect(stored.events.map((e) => e.type)).toEqual(expect.arrayContaining(["submitted", "ack_recorded", "ai_structured"]));

  // The status, with the code only in the header. It never gives the code back.
  const status = await api.status(r.receiptCode);
  expect(status.status()).toBe(200);
  expectApiHeaders(status, "status");
  const s = await status.text();
  expect(JSON.parse(s)).toMatchObject({ reference: r.reference, status: "new", retest: null });
  expect(s).not.toContain(r.receiptCode);

  // The re-test: open it (staff steps, frozen core), answer "fixed" once; a second answer is refused.
  await advanceToRetest(ORG, r.reference);
  const open = await (await api.status(r.receiptCode)).json();
  expect(open).toMatchObject({ status: "retest_open", statusLabel: "Please tell us if it works now" });
  expect(open.retest.answers).toHaveLength(5);
  const answered = await api.answer(r.receiptCode, { answer: "fixed", comment: "It opens now." });
  expect(answered.status()).toBe(200);
  expectApiHeaders(answered, "re-test answer");
  expect(await answered.json()).toMatchObject({
    message: "Thank you. It's now marked as fixed and confirmed by you.",
    report: { status: "verified", statusLabel: "Fixed and confirmed by you" },
  });
  const again = await api.answer(r.receiptCode, { answer: "partly" });
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("already_answered");
  const verdicts = (await caseFacts(ORG, r.reference)).events.filter((e) => e.type === "retest_verdict");
  expect(verdicts).toHaveLength(1);
  expect(verdicts[0]).toMatchObject({ actorKind: "reporter", payload: { verdict: "fixed", via: "receipt_code" } });

  // The reporter's web page shows the same answer.
  const page = await request.get(`/r/${r.receiptCode}`, { headers: { "x-forwarded-for": freshIp() } });
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain("Fixed and confirmed by you");
});

test("a code from the web form works here, and each code opens only its own organization's report", async ({ request }) => {
  const api = client(request);
  const maple = await fileReport(ORG, { text: doorText(), wantsRetest: true });
  const lake = await fileReport(LAKEVIEW, { text: doorText(), wantsRetest: false });
  const a = await (await api.status(maple.code)).json();
  expect(a).toMatchObject({ reference: maple.ref, organization: { slug: ORG }, wantsRetest: true, canStopContact: true });
  const b = await (await api.status(lake.code.replace(/-/g, "").toLowerCase())).json();
  expect(b).toMatchObject({ reference: lake.ref, organization: { slug: LAKEVIEW }, wantsRetest: false });

  // "Don't contact me about this again" at any time: the preference only, the status unchanged.
  const stop = await api.answer(maple.code, { answer: "opt_out" });
  expect(stop.status()).toBe(200);
  expect(await stop.json()).toMatchObject({ report: { status: "new", wantsRetest: false, canStopContact: false } });
});

test("the code never travels in a URL or a body, browsers can't call it cross-site, and nothing is echoed", async ({ request }) => {
  const api = client(request);
  const { code } = await fileReport(ORG, { text: doorText() });
  // A code in the query string or the body is ignored: 401, with the scheme to use.
  const inQuery = await api.get(`/api/v1/status?code=${code}`);
  expect(inQuery.status()).toBe(401);
  expect(inQuery.headers()["www-authenticate"]).toMatch(/^Receipt /);
  expect((await api.post("/api/v1/retest", { answer: "opt_out", code })).status()).toBe(401);
  expect((await api.get("/api/v1/status", { authorization: `Bearer ${code}` })).status()).toBe(401);
  const unknown = await api.status("0000-0000-0000-0000");
  expect(unknown.status()).toBe(404);
  expect((await unknown.json()).error.message).toBe("We couldn't find a report with that code. Check it and try again.");

  // Only JSON (a cross-site HTML form can't send it without a preflight), and the preflight grants nothing.
  const form = await request.post(`/api/v1/orgs/${ORG}/reports`, {
    headers: { "x-forwarded-for": freshIp(), "content-type": "application/x-www-form-urlencoded" },
    data: "text=hi&locationKind=place&followUp=none",
  });
  expect(form.status()).toBe(415);
  const preflight = await request.fetch("/api/v1/status", {
    method: "OPTIONS",
    headers: { origin: "https://evil.example", "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
  });
  expect(preflight.headers()["access-control-allow-origin"]).toBeUndefined();
  expect(preflight.headers()["access-control-allow-headers"]).toBeUndefined();
  expect((await api.get("/api/v1/retest")).status()).toBe(405);

  // A bad body names the field, never the value.
  const bad = await api.post(`/api/v1/orgs/${ORG}/reports`, { text: "my secret words", locationKind: "moon", followUp: "none", orgId: "x" });
  expect(bad.status()).toBe(400);
  const err = await bad.text();
  expect(JSON.parse(err).error).toMatchObject({ code: "invalid_request", fields: expect.arrayContaining(["locationKind", "orgId"]) });
  expect(err).not.toContain("my secret words");
  expect(err).not.toContain("moon");
});

test("local development only: the Expo web build (http://localhost:8081) may call the API from its own origin", async ({ request }) => {
  // A loopback address of its own (127.0.0.0/8 is this computer), so it spends none of 127.0.0.1's buckets.
  const local = `127.${parseInt(hex(), 16) % 250}.${parseInt(hex(), 16) % 250}.${(parseInt(hex(), 16) % 250) + 2}`;
  const EXPO = "http://localhost:8081";
  const preflight = await request.fetch(`/api/v1/orgs/${ORG}/reports`, {
    method: "OPTIONS",
    headers: { origin: EXPO, "x-forwarded-for": local, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  });
  expect(preflight.status()).toBe(204);
  const p = preflight.headers();
  expect(p["access-control-allow-origin"]).toBe(EXPO);
  expect(p["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
  expect(p["access-control-allow-headers"]).toBe("Accept, Authorization, Content-Type");
  expect(p["access-control-allow-credentials"]).toBeUndefined();

  const profile = await request.get(`/api/v1/orgs/${ORG}`, { headers: { origin: EXPO, "x-forwarded-for": local } });
  expect(profile.status()).toBe(200);
  expectApiHeaders(profile, "org profile for the Expo web build");
  expect(profile.headers()["access-control-allow-origin"]).toBe(EXPO);
  expect(profile.headers()["access-control-allow-credentials"]).toBeUndefined();

  // Through a tunnel (a client address that is not this computer): nothing, as for any other site.
  const tunnel = await request.fetch(`/api/v1/orgs/${ORG}`, {
    method: "OPTIONS",
    headers: { origin: EXPO, "x-forwarded-for": freshIp(), "access-control-request-method": "GET" },
  });
  expect(tunnel.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("the API counts in the web's own rate-limit buckets: past the limit it is 429 with Retry-After", async ({ request }) => {
  const WINDOW = 10 * 60_000;
  const left = WINDOW - (Date.now() % WINDOW);
  if (left < 20_000) await new Promise((resolve) => setTimeout(resolve, left + 1_000)); // never across a window edge
  const api = client(request);
  // The verdict bucket (60 a window): counted before anything is read, so even requests without a code count.
  for (let i = 0; i < 60; i += 20) {
    const statuses = await Promise.all(Array.from({ length: 20 }, () => api.post("/api/v1/retest", {}).then((r) => r.status())));
    expect(statuses.every((s) => s === 401)).toBe(true);
  }
  const over = await api.answer("0000-0000-0000-0000", { answer: "fixed" });
  expect(over.status()).toBe(429);
  expect(Number(over.headers()["retry-after"])).toBeGreaterThan(0);
  expect((await over.json()).error.message).toBe("Too many tries from this connection. Please wait a few minutes and try again.");
  // Another address is not affected.
  expect((await client(request).post("/api/v1/retest", {})).status()).toBe(401);
});
