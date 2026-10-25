# Load check

**Label: local laptop, production build; not a hosted measurement.**

These numbers come from one laptop that ran the app, its database and the load generator at the same time. They
say nothing about a hosted deployment (Vercel + Supabase): the network, cold starts and a remote database are not
in them. Wave 2 repeats this against the live URL.

| | |
|---|---|
| Date | 2026-10-20 |
| Machine | Intel(R) Core(TM) Ultra 9 275HX, 24 logical cores, 31.4 GB RAM (win32 10.0.26200) |
| Node | v22.18.0 |
| Build | production build (`npm run local:serve`: `next build`, then `next start`), fake AI and email |
| Load | 50 concurrent clients per route, for 30 s per route, one route after the other |
| Inbox size | 104 cases listed on the page (its time grows with this number) |
| Tool | `npm run load:check` (`scripts/load-check.ts`: Node's fetch and a small worker pool, no extra dependency) |

| Route | Requests | Errors | Requests/s | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Machine CPU busy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Home: `GET /` | 63234 | 0 | 2107.4 | 24 | 32 | 37 | 73 | 21% |
| Report form: `GET /o/maple-harbour/report` | 9613 | 0 | 319.8 | 155 | 185 | 202 | 255 | 17% |
| Inbox (signed in as the lead): `GET /app/inbox` | 1314 | 0 | 42.5 | 1173 | 1285 | 1315 | 1360 | 18% |

p95 at 50 concurrent clients: home 32 ms, report form 185 ms, inbox 1285 ms.

## Reading this run (written by hand for the 2026-10-20 run)

- **No errors** on any route: 74,161 requests, every one answered 200.
- **The inbox is the slow page, and it is queueing, not failing.** It lists every Maple Harbour case on one page:
  104 at the time (the seed's 16 plus the cases earlier e2e runs added; a fresh `npm run local:reset` has 16), and it
  isn't paginated yet. In a 3-second trial with 5 clients it answered about 38 requests a second (p50 131 ms); with 50
  clients, 43 a second. More clients barely add throughput, so each request mostly waits in line: one `next start`
  process (one JavaScript thread) renders every page and has 5 database connections.
- The home page is static, so it shows what the server itself costs; the report form is rendered on each request
  (it looks the organization up by its slug).
- The same run was repeated once: the p95 values were within 10% of the first run (33, 175 and 1235 ms).
- Other worktrees' builds and tests may have been running on the same laptop at the time (several agents work in
  parallel); the "Machine CPU busy" column includes them.

## Independent re-run (2026-10-20, review gate)

Someone who did not write the script ran it once more on the same laptop, build and settings (50 clients, 30 s per
route), to check that the numbers above are real:

| Route | Requests | Errors | Requests/s | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Machine CPU busy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Home: `GET /` | 51374 | 0 | 1711.5 | 29 | 42 | 50 | 100 | 43% |
| Report form: `GET /o/maple-harbour/report` | 6872 | 0 | 228.7 | 187 | 325 | 1123 | 1799 | 43% |
| Inbox (signed in as the lead): `GET /app/inbox` | 780 | 0 | 24.5 | 1984 | 2525 | 2647 | 2840 | 36% |

- **No errors** again: 59,026 requests, every one answered 200.
- **Two things were different, and they explain the gap.** The inbox listed 192 cases (later e2e runs had added 88):
  1.85 times the cases took 1.96 times as long at p95, as you'd expect from a page that renders every case. And the
  laptop was about twice as busy with other worktrees' builds and tests (36-43% CPU busy against 17-21%). That shows
  as 20% more at p50 and 31% more at p95 on the home page, and as a slow tail on the report form (p99 1123 ms).
- **Verdict:** the first run's numbers are real and reproduce within this noise. Read them as a local order of
  magnitude, not a benchmark. Measure the inbox again once it shows 50 cases per page; the script now records
  how many cases the inbox page listed (the "Inbox size" row).

## How it was measured

- Each client sends one GET, reads the whole body, and sends the next as soon as it has the answer (a closed loop:
  no think time, so this is a stress test, not a model of real visitors). Times are from sending the request to
  the last byte of the body. Only 200 answers are timed; anything else (another status, a network error or a
  30 s timeout) counts as an error.
- Before each route, 20 requests warm it up and are not counted.
- GETs only, so no rate-limited POST (the report form's preview and submit) is ever sent.
- The inbox is fetched with the seeded lead's session cookie, from the local "Sign in as Alex Rivera" form
  (the button the e2e tests click). The cookie is never printed. A redirect to /sign-in would count as an error.
- "Machine CPU busy" is the share of the whole machine's CPU time in use during that route (from `node:os`):
  the app server, Postgres, this script and anything else running on the laptop at the time.
- The app connects to Postgres through a pool of 5 connections (`db/client.ts`), so signed-in pages queue for
  the database under this load.

## Run it again

```bash
npm run local:serve                                # terminal 1: production build on http://localhost:3000
npm run load:check -- --write docs/load-check.md   # terminal 2: about 105 s
```

Then stop the server (Ctrl+C in terminal 1). Apart from one POST to the local sign-in form (which only sets the
cookie), the run sends only GETs, so it adds nothing to the database.
