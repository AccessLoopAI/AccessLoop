# Testing the AccessLoop app with VoiceOver and TalkBack

A script for a human tester (about 30 minutes per platform). Automated checks can't hear a screen reader, so these
runs are the evidence for the app's accessibility. Log every problem in `docs/a11y-issues.md` with the platform,
device, OS version, screen reader, text size and the step number below.

What has been checked so far (Oct 20, 2026): only the Expo **web** build, in a desktop browser at 320 and 375 px
wide, in light and dark, against a made-up local copy of the API: by hand, then by a scripted Playwright + axe run
(no axe violations on any screen or error state, focus lands on each heading and on the field or first answer after
an error, Tab and Space choose answers, no sideways scrolling at 320 px, the verified badge grows in once and not
at all with reduced motion, no request URL contains a code). **Nothing has been tested on a real phone, a
simulator or with a screen reader yet.**

## Before you start

1. On the computer: `npm run local` in the project folder (the API on http://localhost:3000), then, in `mobile/`,
   `npx expo start`. See `mobile/README.md` for the simulator and emulator steps (a phone on Wi-Fi can't reach the
   local app; that is on purpose).
2. Android emulator only: `adb reverse tcp:3000 tcp:3000`, so the emulator's `localhost:3000` reaches the computer.
3. Find a receipt code to re-test with: `npm run local:reset` prints `BAR-0014 (retest_open) receipt code: ...`.
4. Turn the screen reader on:
   - **iOS (VoiceOver):** Settings > Accessibility > VoiceOver, or triple-click the side button if the shortcut is
     set. Swipe right = next item, double-tap = activate, two-finger swipe up = read all.
   - **Android (TalkBack):** Settings > Accessibility > TalkBack. Swipe right = next item, double-tap = activate.
5. Run the whole script twice: once at the default text size, once at the **largest** size:
   - iOS: Settings > Accessibility > Display & Text Size > Larger Text, turn on Larger Accessibility Sizes, drag to
     the end.
   - Android: Settings > Display > Font size (largest) and Display size (largest).
6. Run steps 1-4 once more with **Reduce Motion** on (iOS: Accessibility > Motion > Reduce Motion; Android:
   Accessibility > Remove animations).

## The script

Write down what the screen reader says at each "Hear:" and compare it with the expected words. Small differences
in punctuation are fine; missing information is not.

### 1. Home

- Open the app. Hear: the title "AccessLoop", then "Tell an organization about a barrier, heading".
- Swipe through. Every button says its name, "button", and a hint (for example "Report a barrier, button. Starts a
  new report. There are 4 short steps.").
- "Get help" is at the top right on every screen except Help itself. Check it on 3 different screens.

### 2. Choose the organization

- Double-tap "Report a barrier". Hear: "Who do you want to tell?, heading" (focus moves there by itself, after the
  screen change).
- Double-tap "Find organization" with the field empty. Hear the field with "Error: Enter the organization's short
  name, like maple-harbour..." Focus is on the field.
- Type `maple-harbour` (or paste it) and double-tap "Find organization". Hear "Found Maple Harbour Bank." and focus
  moves to "You are telling Maple Harbour Bank, heading" (if the server has no organization lookup yet, the
  heading says "You are telling "maple-harbour"" with a note that the name couldn't be checked).
- Deep link. In Expo Go the app's own `accessloop://` scheme isn't registered, so use Expo Go's form of the same
  link: iOS simulator `xcrun simctl openurl booted "exp://127.0.0.1:8081/--/report?org=maple-harbour"`, Android
  emulator `adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081/--/report?org=maple-harbour"`
  (in a development build: `accessloop://report?org=maple-harbour`). The same screen opens with the name filled
  in. Nothing moves on by itself: you still press "Start my report".
- No connection: stop `npm run local` (or turn on airplane mode), type `maple-harbour` and double-tap "Find
  organization". When the busy state ends, focus moves to "We could not go on just now, heading" and the notice
  under it says what to do. Start the app server again before going on.

### 3. Step 1 of 4: What got in your way?

- Double-tap "Start my report". Hear: "Step 1 of 4: What got in your way?, heading". The introduction follows.
- Double-tap "Next" with the field empty. Focus moves to the text field. Hear its name "What got in your way?" and
  the hint, including "Error: Tell us what got in your way. A few words is enough."
- **Dictation:** in the field, use the keyboard's microphone (iOS) or voice typing (Android) and say a sentence.
  It must appear in the field. Then type the rest by hand: "The door button at the King Street branch is broken."
- At the largest text size: every word of the heading, the introduction and the hint is visible (nothing cut off
  with "..."), and you can scroll to "Next".

### 4. Step 2 of 4: Where did it happen?

- Hear: "Step 2 of 4: Where did it happen?, heading".
- Swipe through the five answers. Each says its name, its hint, "radio button" (or "radio") and "not checked" /
  "unchecked" / "checked", once (not "selected" as well), and on iOS its position ("1 of 5") if the platform says
  it.
- Double-tap "At a place". Hear "checked". The chosen answer also shows a filled circle and a heavier border.
- Double-tap "Next" with nothing chosen (go Back and clear it first, or start a new report): focus moves to the
  first answer, and its hint starts with the error: "Error: Choose where it happened...".
- "Where exactly? (optional)" says its name and hint.

### 5. Step 3 of 4: How can we follow up?

- Hear: "Step 3 of 4: How can we follow up?, heading", then "You can hear back from us, or stay anonymous...".
- Choose "Email me, and let me check the fix". An "Email address" field appears under it. Swipe to it: its hint
  says who can see the email.
- Type `test@` and double-tap "Next". Focus moves to the email field with "Error: Enter an email address like
  name@example.com."
- Fix it (use a made-up address such as `tester@example.com`). Read the AI note: it says an AI tool summarizes the
  report and that the next screen lets you say no.
- Double-tap "Next". Hear "Summarizing your report…" once. While it works, "Next" is announced as busy/dimmed and
  "Back" does nothing. There is no time limit.
- Also try "Skip the AI summary" in a second run: the next screen says "You asked us not to use AI".

### 6. Step 4 of 4: Check your report

- Hear: "Step 4 of 4: Check your report, heading".
- "Your words" reads your text exactly as typed, and where it happened.
- "We understood" reads the AI summary. Any `[PERSON]` or `[PHONE]` is read as the word in brackets.
- "Is this right?" has four answers: "Yes, that's right", "Change it", "Keep my words only", "Don't use AI on my
  report".
- Double-tap "Send report" with no answer chosen: focus moves to "Yes, that's right", and its hint starts with
  the error.
- Double-tap "Change it": focus moves into the new "Your summary" field (hear its name and hint). Edit it.
- "Your choices" reads how we follow up, the email, and whether the AI summary is used.
- Double-tap "Send report". Hear "Sending your report…".

### 7. Receipt

- Hear: "We got your report, heading".
- Swipe to the code. Hear "Your receipt code:" and then the code **one character at a time** (for example "7 K 3 M,
  9 Q 2 D, ..."), not as words.
- Hear "Keep this code..." and "We kept this code in My reports on this device...".
- "Save the code somewhere else" opens the system share sheet (close it again; don't share it anywhere real).
- There is no Back button on this screen (iOS swipe-back does nothing). "Done" goes to the first screen.

### 8. My reports and the status screen

- From Home, open "My reports". Each report is one button: "BAR-00xx, Maple Harbour Bank, added October 20,
  2026". The code is **not** read out on this screen.
- Open it. Hear "Your report, heading", the reference and the received date, then "Where your report is now" and
  the status words (for a new report: "We got your report").
- "Show my code" says "collapsed" and shows the code (its hint says to make sure nobody else can see it). "Hide my
  code" says "expanded" and hides it again.
- Double-tap "Remove from this device": focus moves to "Remove this report from this device?, heading". "Keep it"
  puts focus back on "Remove from this device". Then "Remove from this device" again and "Yes, remove it": you are
  taken back and hear "We removed this report from this device." It is gone from My reports. No pop-up dialog
  appears at any point.
- "Try again": stop `npm run local` and open a report from My reports. Hear "We could not load your report" with
  a "Try again" button. Double-tap it while the server is still stopped: the problem is said once and focus stays
  on "Try again". Start the server and double-tap "Try again": hear "Your report is loaded." and focus moves to
  "Where your report is now, heading".

### 9. Re-test with the five answers

- From Home, "Check a report with your code". Paste or type the BAR-0014 code from `npm run local:reset` (any
  case, with or without dashes). Double-tap "Check".
- Hear "Your report, heading". The status says "Please tell us if it works now". "What the team changed" reads
  the fix. The gift-card line is read as part of the question.
- "Does it work for you now?" has five answers: "Yes, it works now", "Partly", "No, still a barrier", "I can't
  check right now", "Don't contact me about this again" (with their hints).
- Double-tap "Send answer" with nothing chosen: focus moves to the first answer with "Error: Choose one answer."
- Choose "Yes, it works now" and double-tap "Send answer". Focus moves to "Your answer is saved, heading", and you
  hear "Thank you. It's now marked as fixed and confirmed by you." The status turns to "Fixed and confirmed by
  you". With Reduce Motion off the badge grows in once; with it on, nothing moves.
- "Keep it in My reports" keeps the checked code on the device: you hear "We kept this report in My reports on
  this device.", focus moves to "Your code, heading", and the report shows up in My reports.

### 10. Everywhere

- Every control is at least 44 x 44 points (try tapping just outside a button's text).
- At the largest text size, the navigation bar's own title may be shortened with "..." (that bar is drawn by the
  system; on iOS a long press shows it in the Large Content Viewer). The screen's own heading under it, and every
  answer, hint, error and button, must show in full. Log anything else that is cut off.
- Turn the phone sideways: every screen still works (the app is not locked to portrait).
- Dark mode (system setting): text stays readable; the chosen answer is still clear.
- No screen times out, and nothing moves to the next step by itself.
- With an external keyboard (iPad or Android with a keyboard): Tab reaches every control, and the focused one is
  visibly marked (on Android, the app's own thick outline; on iPad with Full Keyboard Access, the system's ring).

## Pass or fail

A run passes when every "Hear:" matches, focus lands where each step says, nothing is cut off at the largest
text size, no code ever shows in a URL or a notification, and My reports shows a code only after "Show my code".
