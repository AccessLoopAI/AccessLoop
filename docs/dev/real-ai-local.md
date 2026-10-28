# Real AI on your own machine (claude-cli backend)

**Every number on this page is "claude-cli, internal, not publishable"** (domain §6.1). It comes from one person's
Claude subscription through the locally installed Claude Code CLI, one run, model alias `sonnet`. Never copy it into
the README, Devpost or any doc as a product number. Published numbers come from the `api` backend.

First real run: 2026-10-28, macOS (Intel), Node 24.18, Claude Code CLI 2.1.312, main at f4bfc46 plus the fix below.

## Before you start

- **Needs the fix on `ai/cli-structured-output`** (one commit, for Alireza's review). On main, every `structure` call
  fails with CLI 2.1.312: the backend's `--disallowedTools "*"` also denies the CLI's own `StructuredOutput` tool,
  which `--json-schema` answers through, so the model writes prose around the JSON. The branch denies `"mcp__*"`
  instead. Until it is merged, intake falls back to manual triage on every report.
- The CLI must be **2.1.211 or newer** and signed in with a Claude subscription. Check it in your own terminal:

  ```bash
  claude --version
  ```

  ```bash
  claude auth status
  ```

  You need `"loggedIn": true` and `"authMethod": "claude.ai"`. If not, run `claude auth login` yourself. AccessLoop
  never signs in for you.
- `AUTH_MODE=local`. The backend refuses to run anywhere else, on Vercel, or behind a tunnel.

## Turn it on and off

In `.env.local` (both lines matter; `FAKE_LLM=1` wins over everything):

```
AI_BACKEND=claude-cli
FAKE_LLM=0
CLAUDE_CLI_MODEL=sonnet
```

Back to simulated AI: `AI_BACKEND=fake` and `FAKE_LLM=1`. Restart `npm run local` after either change.

For one eval run without editing the file:

```bash
npm run eval -- --backend claude-cli
```

Tests, CI and `npm run e2e` always use the fake backend (Playwright forces it), whatever `.env.local` says.

## Smoke test of the four AI functions

Made-up text only. Latency is what the app recorded for the call; "wait" is what a person waits for in the browser.
Intake does not store token counts (by design), so tokens come from direct calls and the eval.

| Function | Path | Result | Latency | Tokens (out / cache read / cache write) |
|---|---|---|---|---|
| startup check | `checkAiBackend` (`--version`, `auth status`, `--help`) | ok, `2.1.312+system-prompt-inline.no-max-turns.safe-mode` | 1.1-2.3 s | none |
| `structure` | direct call, English door-button text | ok (on main: "answer was not JSON") | 5.3 s | 168 / 2,181 / 338 |
| `flagPii` | direct call, same text | ok | 7.5 s | 52 / 1,784 / 337 |
| `structure` + `flagPii` | web form, README demo report (Daniel Okafor) | real summary, no name in it; lead's redaction review shows `[PERSON]` and `[PHONE]`; no manual redaction needed | structure 4.3 s; wait from Next to the review about 10-20 s | not stored |
| `structure` + `flagPii` | web form, a French report (website date picker) | French summary in the second person, name and phone hidden | structure 4.2 s; wait about 10 s | not stored |
| similar past barriers | case page of the English report, after triage | "no past case looks like the same barrier" among 3 candidates (elevator, parking, ramp): correct | wait about 15-28 s | not stored |
| `phraseClaims` | 2026 progress-report draft, Maple Harbour | 23 of 23 sentences accepted by the validator, 0 template fallbacks; every required check passes (7 area sections wait for staff text, as designed) | 9.8 s; "Draft ready" in under 20 s | not stored |

## Eval (claude-cli, internal, not publishable)

Saved as `eval/results/2026-10-28-claude-cli-d654e056.json` and `-injection-d654e056.json`. One pass each, no
repeats: real answers vary between runs, so use `--repeats 3` before relying on any rate even internally.

| | Visible set, fake | Visible set, claude-cli | Injection suite, fake | Injection suite, claude-cli |
|---|---|---|---|---|
| Fixtures, errors | 20, 0 | 20, 0 | 33, 0 | 33, 0 |
| Top-1 area | 3 of 19 | 16 of 19 | 1 of 33 | 27 of 33 |
| Acceptable area | 3 of 19 | 19 of 19 | 1 of 33 | 33 of 33 |
| Macro-F1 | 0.18 | 0.73 | 0.05 | 0.67 |
| Vague report abstained (F17) | yes | yes | n/a | n/a |
| Seeded personal details hidden before review | 13 of 17 | 17 of 17 | 3 of 9 | 9 of 9 |
| Wrongly hidden (`notPii`) | 0 of 8 | 0 of 8 | 0 of 6 | 0 of 6 |
| Injection resisted | 0 of 2 | 2 of 2 | 1 of 33 | 33 of 33 (every strict check) |
| Time per report p50 / p95 | simulated | 10.0 s / 18.9 s | simulated | 8.3 s / 14.7 s |

Per call (visible set): `flagPii` p50 4.1 s, p95 8.4 s; `structure` p50 5.0 s, p95 15.1 s. Tokens over the 20
reports: `flagPii` 1,332 out, 28,500 cache read, 14,029 cache write; `structure` 3,566 out, 36,180 cache read,
14,289 cache write. Input tokens outside the cache are 2 per call: almost everything is the cached system prompt.

### Where real Claude disagrees with the labels

All of these are inside the fixture's acceptable areas; only the top-1 differs. Worth a look when we label E1.

| Fixture | Label | Claude's top area (confidence) | Note |
|---|---|---|---|
| F04 | programs_services | communication_other (0.85), then programs_services (0.6) | ASL-gloss service barrier: communication vs service |
| F09 | procurement | ict (0.85), then procurement (0.8) | Buying an inaccessible system: both fit |
| F13 | employment | built_environment (0.7) | Employment case set in a physical place |
| INJ08 | ict | communication_other (0.6) | |
| INJ09 | transportation | ict (0.6), transportation (0.55) | Booking app for transport |
| INJ15 | programs_services | communication_other (0.7) | |
| INJ23 | employment | ict (0.9) | Hiring portal |
| INJ24 | built_environment | communication_other (0.5) | |
| INJ33 | employment | built_environment (0.85) | |

F17 (the vague report) correctly stayed under the 0.5 abstain threshold.

## Known failures and rough edges

- **Fixed on `ai/cli-structured-output`:** `--disallowedTools "*"` denied `StructuredOutput` (above). Tried with the
  real CLI: adding `--allowedTools StructuredOutput` does not override the deny; `--tools ""` alone works but,
  without `--safe-mode`, loads the user's own MCP servers (on this Mac: Gmail, Drive, Calendar, all callable);
  `--tools "" --disallowedTools "mcp__*"` works with or without `--safe-mode` and leaves `StructuredOutput` as the
  only tool.
- **The reporter waits 10-20 s** on "Next" before the review step with claude-cli (two `flagPii` calls and
  `structure`, one CLI process at a time, each a fresh CLI start). Fine for our own testing; the `api` backend should
  be much faster.
- **Unit tests time out under heavy machine load.** With a load average around 345 (other processes), 4-6 tests in
  `api-v1.seed`, `dashboard.seed`, `locations.seed`, `load-check` and `signed-verify.seed` hit vitest's 5 s timeout,
  on clean main too; they pass alone and the whole suite passed (1,352/1,352) once the load dropped. Not caused by
  the AI backend.
- **Setup on npm 11.16:** `npm ci` skips every install script ("allow-scripts"), including embedded-postgres's
  `hydrate-symlinks`; run `node scripts/hydrate-symlinks.js` inside `node_modules/@embedded-postgres/<platform>`
  once, then `npm run local:setup` works. The repo asks for Node `^22.9.0`; everything above ran on Node 24.18.
- Under `next dev`, the first visit to the report form can reload the page while it compiles and drop text typed
  in the first second or two. Not seen with `npm run local:serve`.

## Not verified

- CLI versions other than 2.1.312, Windows, Linux.
- Repeated runs (`--repeats 3`), the baseline (`--baseline`), and the silver set.
- A "similar past barriers" case that should match (the one tried had no real match).
- Staff-logged phone intake, the owner and re-test steps, publishing and `/verify` with real AI.
- The Expo app with real AI.
