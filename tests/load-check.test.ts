// scripts/load-check.ts: percentiles, the summary and table, the sign-in form parser, the cookie picker, the
// local-only guard and the report, plus the worker pool against a tiny local HTTP server (no Next, no database).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  LABEL,
  cookieFrom,
  errorKind,
  formatTable,
  isLocalBase,
  machine,
  main,
  percentile,
  renderReport,
  routes,
  runRoute,
  signInCookie,
  signInFormFields,
  summarize,
  tableBodyRows,
} from "../scripts/load-check";
import { LOCAL_SESSION_COOKIE } from "@/lib/auth/local-session";

describe("percentile (nearest rank)", () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
  it("matches the textbook values", () => {
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 99)).toBe(99);
    expect(percentile(sorted, 100)).toBe(100);
    expect(percentile(sorted, 0)).toBe(1);
  });
  it("handles tiny and empty samples", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([1, 2], 50)).toBe(1);
    expect(percentile([1, 2], 51)).toBe(2);
  });
});

describe("summary and table", () => {
  const spec = routes("maple-harbour")[1];
  it("counts errors as requests, times only successes, and computes the rate", () => {
    const s = summarize(spec, [30, 10, 20, 40], { "HTTP 500": 1 }, 2000, 0.5);
    expect(s).toMatchObject({ requests: 5, errors: 1, p50: 20, p95: 40, p99: 40, max: 40, rps: 2.5, cpuBusy: 0.5 });
  });
  it("renders a markdown table with one row per route", () => {
    const table = formatTable([
      summarize(routes("maple-harbour")[0], [12.4, 15.6], {}, 1000),
      summarize(spec, [20], { "HTTP 500": 2, timeout: 1 }, 1000, 0.42),
    ]);
    const lines = table.split("\n");
    expect(lines[0]).toMatch(/^\| Route \| Requests \| Errors \| Requests\/s \| p50 \(ms\) \| p95 \(ms\) \| p99 \(ms\) \| max \(ms\) \| Machine CPU busy \|$/);
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe("| Home: `GET /` | 2 | 0 | 2.0 | 12 | 16 | 16 | 16 | 0% |");
    expect(lines[3]).toContain("| 3 (HTTP 500 x2, timeout x1) |");
    expect(lines[3]).toContain("`GET /o/maple-harbour/report`");
    expect(lines[3]).toContain("| 42% |");
  });
  it("names the three routes, GETs only, and only the inbox is signed in", () => {
    expect(routes("maple-harbour").map((r) => [r.path, r.signedIn])).toEqual([
      ["/", false], ["/o/maple-harbour/report", false], ["/app/inbox", true],
    ]);
  });
  it("classifies non-200 answers and network errors", () => {
    expect(errorKind(200)).toBeNull();
    expect(errorKind(307)).toBe("HTTP 307");
    expect(errorKind(null, Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("timeout");
    expect(errorKind(null, Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))).toBe("ECONNRESET");
  });
});

describe("local only", () => {
  it("accepts local hosts and refuses everything else", () => {
    for (const ok of ["http://localhost:3109", "http://127.0.0.1:3000", "http://[::1]:3000", "https://localhost"]) expect(isLocalBase(ok), ok).toBe(true);
    for (const bad of ["https://accessloop.vercel.app", "http://localhost.evil.example", "http://10.0.0.2:3000", "ftp://localhost", "not a url"]) {
      expect(isLocalBase(bad), bad).toBe(false);
    }
  });
  it("main() refuses a hosted URL before sending anything", async () => {
    const lines: string[] = [];
    expect(await main(["--base", "https://example.org"], (s) => lines.push(s))).toBe(2);
    expect(lines.join("\n")).toMatch(/only runs against a local app/);
  });
});

// What React 19 renders for `<form action={serverAction}>` on /sign-in (shape only; ids made up).
const SIGN_IN_HTML = `<main><h1>Sign in</h1>
<section><h2>Maple Harbour Bank</h2><ul>
<li><form action="" encType="multipart/form-data" method="POST"><input type="hidden" name="$ACTION_ID_7f00aa"/>
<input type="hidden" name="org" value="maple-harbour"/><input type="hidden" name="member" value="11111111-1111-4111-8111-111111111111"/>
<button type="submit"><span>Sign in as </span><span>Facilities team </span><span class="sr-only">(Maple Harbour Bank)</span></button></form></li>
<li><form action="" encType="multipart/form-data" method="POST"><input type="hidden" name="$ACTION_ID_7f00aa"/>
<input type="hidden" name="org" value="maple-harbour"/><input type="hidden" name="member" value="22222222-2222-4222-8222-222222222222"/>
<button type="submit"><span>Sign in as </span><span>Alex Rivera </span><span class="sr-only">(Maple Harbour Bank)</span></button></form></li>
</ul></section></main>`;

describe("the sign-in form", () => {
  it("finds the hidden fields of the named person's button, including the server action id", () => {
    expect(signInFormFields(SIGN_IN_HTML, "Alex Rivera")).toEqual([
      ["$ACTION_ID_7f00aa", ""],
      ["org", "maple-harbour"],
      ["member", "22222222-2222-4222-8222-222222222222"],
    ]);
  });
  it("returns null when no button names that person", () => {
    expect(signInFormFields(SIGN_IN_HTML, "Alex")).toBeNull();
    expect(signInFormFields("<main>No one to sign in as yet</main>", "Alex Rivera")).toBeNull();
  });
  it("picks the session cookie from Set-Cookie headers", () => {
    expect(cookieFrom(["other=1; Path=/", `${LOCAL_SESSION_COOKIE}=abc.def; Path=/; HttpOnly; SameSite=lax`], LOCAL_SESSION_COOKIE))
      .toBe(`${LOCAL_SESSION_COOKIE}=abc.def`);
    expect(cookieFrom([`${LOCAL_SESSION_COOKIE}=; Path=/; Max-Age=0`], LOCAL_SESSION_COOKIE)).toBeNull();
    expect(cookieFrom([], LOCAL_SESSION_COOKIE)).toBeNull();
  });
});

describe("the report", () => {
  it("carries the label, the machine, Node, the build mode and the table", () => {
    const m = machine();
    expect(m.cores).toBeGreaterThan(0);
    expect(m.node).toBe(process.version);
    const doc = renderReport({
      date: "2026-10-20", machine: m, buildMode: "production build", concurrency: 50, durationS: 30, warmup: 20,
      stats: routes("maple-harbour").map((r, i) => summarize(r, [10 * (i + 1)], {}, 1000)),
    });
    expect(doc).toContain(LABEL);
    expect(LABEL).toBe("local laptop, production build; not a hosted measurement");
    expect(doc).toContain(`| Machine | ${m.cpu}, ${m.cores} logical cores, ${m.ramGb} GB RAM`);
    expect(doc).toContain(`| Node | ${process.version} |`);
    expect(doc).toContain("| Build | production build |");
    expect(doc).toContain("p95 at 50 concurrent clients: home 10 ms, report form 20 ms, inbox 30 ms.");
    expect(doc).not.toMatch(/compliant|certified|guarantee/i);
    expect(doc).not.toContain("Inbox size");
    expect(doc).toContain("Apart from one POST to the local sign-in form");
  });
  it("records how many cases the inbox page listed, since its time grows with them", () => {
    const doc = renderReport({
      date: "2026-10-20", machine: machine(), buildMode: "production build", concurrency: 50, durationS: 30, warmup: 20,
      stats: routes("maple-harbour").map((r) => summarize(r, [10], {}, 1000)), inboxRows: 192,
    });
    expect(doc).toMatch(/\| Load \| .* \|\n\| Inbox size \| 192 cases listed on the page \(its time grows with this number\) \|\n\| Tool \|/);
  });
  it("counts table-body rows only (not the header row)", () => {
    const html = `<table><caption>Cases</caption><thead><tr><th scope="col">Ref</th></tr></thead>
      <tbody><tr><th scope="row">BAR-0001</th></tr><tr class="x"><th scope="row">BAR-0002</th></tr></tbody></table>
      <table><tbody><tr><td>other</td></tr></tbody></table>`;
    expect(tableBodyRows(html)).toBe(3);
    expect(tableBodyRows("<main>No cases yet</main>")).toBe(0);
  });
});

// ---------------------------------------------------------------- the pool and the sign-in, over real HTTP

describe("over HTTP (a tiny local server)", () => {
  let server: Server;
  let base: string;
  let posted = "";
  let maxInFlight = 0;
  let inFlight = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/sign-in" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html" }).end(SIGN_IN_HTML);
      } else if (req.url === "/sign-in" && req.method === "POST") {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          posted = `${req.headers["content-type"]}\n${body}`;
          res.writeHead(303, { location: "/app/dashboard", "set-cookie": `${LOCAL_SESSION_COOKIE}=signed.mac; Path=/; HttpOnly` }).end();
        });
      } else if (req.url === "/app/inbox") {
        const ok = req.headers.cookie === `${LOCAL_SESSION_COOKIE}=signed.mac`;
        res.writeHead(ok ? 200 : 307, ok ? {} : { location: "/sign-in" }).end(ok ? "inbox" : "");
      } else if (req.url === "/slow") {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => { inFlight--; res.writeHead(200).end("ok"); }, 20);
      } else {
        res.writeHead(500).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("signs in by POSTing the form's own fields, multipart like a browser without JavaScript", async () => {
    const cookie = await signInCookie(base, "Alex Rivera");
    expect(cookie).toBe(`${LOCAL_SESSION_COOKIE}=signed.mac`);
    expect(posted).toMatch(/^multipart\/form-data/);
    expect(posted).toContain('name="$ACTION_ID_7f00aa"');
    expect(posted).toContain("22222222-2222-4222-8222-222222222222");
    expect(posted).not.toContain("11111111-1111-4111-8111-111111111111");
    await expect(signInCookie(base, "Nobody Here")).rejects.toThrow(/no "Sign in as Nobody Here" button/);
  });

  it("keeps N requests in flight for the duration and times each one", async () => {
    maxInFlight = 0;
    const s = await runRoute(base, { label: "slow", path: "/slow", signedIn: false }, {}, { concurrency: 8, durationMs: 300, warmup: 2 });
    expect(maxInFlight).toBe(8);
    expect(s.errors).toBe(0);
    expect(s.requests).toBeGreaterThanOrEqual(8 * 5);
    expect(s.p50).toBeGreaterThanOrEqual(15);
    expect(s.max).toBeGreaterThanOrEqual(s.p99);
  });

  it("counts a redirect to /sign-in as an error, and a signed-in GET as a success", async () => {
    const inbox = { label: "inbox", path: "/app/inbox", signedIn: true };
    await expect(runRoute(base, inbox, {}, { concurrency: 2, durationMs: 50, warmup: 1 })).rejects.toThrow(/HTTP 307 during warm-up/);
    const s = await runRoute(base, inbox, { cookie: `${LOCAL_SESSION_COOKIE}=signed.mac` }, { concurrency: 2, durationMs: 100, warmup: 1 });
    expect(s.errors).toBe(0);
    expect(s.requests).toBeGreaterThan(0);
  });
});
