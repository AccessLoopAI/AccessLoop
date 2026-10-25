# AccessLoop reporter app (Expo)

The reporter side of AccessLoop as a phone app: choose an organization (or open a location poster's link), the
same four steps as the web form, the receipt, "My reports" and the re-test. It is a **local prototype**: it talks
only to the AccessLoop JSON API on this computer, and it has not been tested on a real phone yet.

- Expo SDK 58, expo-router (`src/app/`), TypeScript strict. Scaffolded with `create-expo-app` (default template,
  MIT, see `LICENSE`); the template's example screens were removed.
- The only native module added is **expo-secure-store** (receipt codes). No camera, photos or location. It runs
  in Expo Go.
- This folder has its own `package.json` and is excluded from the root TypeScript, ESLint, Vitest and Vercel
  builds.

## Run it locally

You need the AccessLoop web app running (it serves the API):

```bash
# in the project root
npm run local            # http://localhost:3000 (127.0.0.1 only)

# in mobile/
npm install
npx expo start --web     # the app in your browser, http://localhost:8081
```

Or on a simulator or emulator, from `mobile/`:

```bash
npx expo start --localhost   # then press i (iOS simulator, macOS only) or a (Android emulator)
adb reverse tcp:3000 tcp:3000   # Android emulator only: its localhost:3000 then reaches the computer
```

`EXPO_PUBLIC_API_URL` sets where the API is (default `http://localhost:3000`). It is read when the bundle is
built, so restart `expo start` after changing it.

**A real phone on Wi-Fi can't reach the local app.** `npm run local` listens on 127.0.0.1 only, on purpose: the
local "Sign in as..." page trusts the Host header, so the app must never be reachable from the network
(docs/decisions.md, 2026-10-19). Use the web build, a simulator or an emulator until the hosted API exists.

**Expo web and the API are two origins** (8081 and 3000). The API answers CORS for exactly
`http://localhost:8081`, only in local mode (`AUTH_MODE=local`, a request for this computer, never on Vercel:
`proxy.ts` and `lib/api/v1/cors.ts` in the project root), so the browser lets the web build call it. Phone apps
need no CORS.

## Checks

```bash
npx tsc --noEmit                 # TypeScript (npm run typecheck)
npx expo-doctor                  # project health (npm run doctor)
npx expo export --platform web   # the web build must build (npm run export:web; output in dist/, git-ignored)
```

Screen-reader and large-text testing is done by people: see `A11Y-TESTING.md`.

## 20-second clip plan (demo video)

Record on an Android emulator with TalkBack on (the iOS Simulator has no VoiceOver), large text, captions showing
what TalkBack says. Use made-up words only.

| Seconds | Shot |
|---|---|
| 0-4 | Home, then "Report a barrier": TalkBack says "Step 1 of 4: What got in your way?" as focus lands on the heading |
| 4-8 | Voice typing fills the field ("The door button at the King Street branch is broken"), then Next, "At a place" |
| 8-12 | "How can we follow up?": "Let me check the fix with my code", Next; the review shows "Your words" and "We understood" |
| 12-16 | "Yes, that's right", "Send report"; the receipt reads the code one character at a time; "kept in My reports" |
| 16-20 | My reports, then BAR-0014 (the seeded case waiting for a check, added before recording with "Check a report" and "Keep it in My reports"): "Yes, it works now", and the badge turns to "Fixed and confirmed by you" |

## Where things are

| File | What it is |
|---|---|
| `src/api.ts` | The whole API contract: URLs, the Authorization header, request and response shapes, error mapping. The one file to change when the server's shapes change |
| `src/copy.ts` | Every sentence, the same plain words as the web reporter flow |
| `src/reports-store.ts` | "My reports": codes in expo-secure-store only (memory only on the web) |
| `src/report-draft.tsx` | The report being written, in memory only |
| `src/a11y.tsx` | Focus moves, the one announcer, Reduce Motion |
| `src/ui/` | Buttons, answers (radio groups), fields, cards, notices, the status badge, the code display |
| `src/app/` | The screens (expo-router): `report/` (choose org, 4 steps, receipt), `reports/` (My reports, status and re-test), `check`, `help` |

## Privacy rules the app keeps

- The receipt code is sent only in the `Authorization` header. It is never in a route, a URL, a query string,
  a log or a crash message. Screens open a report by a random local id.
- Codes are kept only in expo-secure-store, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (iOS: never synced or restored
  to another device; Android: the expo-secure-store config plugin keeps them out of Auto Backup in a development
  build). On the web build nothing is stored: codes live in memory until the tab closes, and the screens say so.
- What the person types (and the email and the AI summary) stays in memory and is dropped after sending.
