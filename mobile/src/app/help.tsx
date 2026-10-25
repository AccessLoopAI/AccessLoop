// Get help: the web's /help page for the app (grade 6-8), plus how this app keeps codes.
import { router } from "expo-router";
import { useRef, type ReactNode } from "react";
import { Platform } from "react-native";
import { useFocusOnScreen } from "../a11y";
import { API_URL } from "../api";
import { normalizeReceiptCode } from "../receipt-code";
import { Button } from "../ui/Button";
import { CodeDisplay, Screen, Stack } from "../ui/blocks";
import { Body, Heading, Small, type HeadingRef } from "../ui/text";

const EXAMPLE_CODE = normalizeReceiptCode("7K3M-9Q2D-XW4H-B8RT") ?? "7K3M9Q2DXW4HB8RT";

export default function Help() {
  const heading = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          Get help
        </Heading>
        <Body>
          AccessLoop is a simple way to tell an organization about a barrier, and to check later that it was fixed.
        </Body>
      </Stack>

      <Section title="What is a barrier?">
        <Body>
          A barrier is anything that makes it hard for you to take part. It can be a website or an app, a building, a
          phone line, a document or a rule.
        </Body>
      </Section>

      <Section title="How to report a barrier">
        <Body>1. Choose the organization you want to tell.</Body>
        <Body>2. Tell them what got in your way. You can type, or use your device&apos;s dictation.</Body>
        <Body>3. Say where it happened.</Body>
        <Body>4. Choose if they can follow up with you.</Body>
        <Body>5. Check your report, then send it.</Body>
        <Body>There is one question on each screen. You can go back and change your answers before you send.</Body>
      </Section>

      <Section title="You can stay anonymous">
        <Body>
          You do not have to give your name or your email. Names and contact details in your words are hidden from the
          team that fixes the barrier.
        </Body>
        <Body>
          If you choose to add your email, only the organization&apos;s accessibility team can see it. It is never shown
          in public reports.
        </Body>
      </Section>

      <Section title="There is no time limit">
        <Body>
          Take as long as you need. Nothing in the app times out, and nothing moves to the next step until you choose to
          go on.
        </Body>
      </Section>

      <Section title="Check your report later">
        <Body>When you send a report, you get a receipt code. It looks like this:</Body>
        <CodeDisplay code={EXAMPLE_CODE} label="Example receipt code" />
        <Body>
          Keep your code somewhere safe. If you stay anonymous, it is the only way to check your report. It is also how
          you tell the organization if a fix works for you.
        </Body>
        <Button
          label="Check a report with your code"
          hint="Type the receipt code you got when you sent a report."
          variant="secondary"
          onPress={() => router.push("/check")}
        />
      </Section>

      <Section title="Your codes on this device">
        {Platform.OS === "web" ? (
          // expo-secure-store has no web version, so the browser build keeps nothing (src/reports-store.ts).
          <Body>
            In a web browser, this app does not keep your receipt codes. It forgets them when you close the tab, so
            write your code down or save it somewhere safe. Codes are never put in a link.
          </Body>
        ) : (
          <Body>
            This app keeps your receipt codes in your phone&apos;s secure storage (the Keychain on iPhone, the Keystore
            on Android). They stay on this phone, and they are never put in a link. You can remove a code from My
            reports at any time.
          </Body>
        )}
      </Section>

      <Section title="Other ways to reach the organization">
        <Body>
          You can also give feedback by phone, by mail or by email. Ask for the person who receives accessibility
          feedback. You can also ask for information in another format, like large print, braille or audio.
        </Body>
      </Section>

      <Section title="About this test version">
        <Small>{`This app is a test version. It talks to AccessLoop at ${API_URL}.`}</Small>
      </Section>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="md">
      <Heading level={3}>{title}</Heading>
      {children}
    </Stack>
  );
}
