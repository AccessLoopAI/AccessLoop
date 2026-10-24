// The receipt (domain §4, ACR s.9(4) on-screen acknowledgement). The code arrives in memory from "Send report",
// never in the route, and was kept in the secure store if this device has one. "Done" forgets it from memory.
import { router } from "expo-router";
import { useRef } from "react";
import { Share } from "react-native";
import { useAnnounce, useFocusOnScreen } from "../../a11y";
import { RECEIPT_KEEP } from "../../copy";
import { useDraft } from "../../report-draft";
import { formatReceiptCode, normalizeReceiptCode } from "../../receipt-code";
import { Actions, Button } from "../../ui/Button";
import { CodeDisplay, Notice, Screen, Stack } from "../../ui/blocks";
import { Body, Heading, Small, type HeadingRef } from "../../ui/text";

export default function ReceiptScreen() {
  const { draft, clear } = useDraft();
  const announce = useAnnounce();
  const heading = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  const receipt = draft.receipt;
  const code = receipt ? normalizeReceiptCode(receipt.code) : null;

  if (!receipt || !code) {
    return (
      <Screen>
        <Stack gap="md">
          <Heading level={2} ref={heading}>
            Your receipt
          </Heading>
          <Body>This screen shows your code right after you send a report. Codes you kept are in My reports.</Body>
        </Stack>
        <Actions>
          <Button label="My reports" hint="Shows the reports you sent from this device." onPress={() => router.replace("/reports")} />
          <Button
            label="Report a barrier"
            hint="Starts a new report. There are 4 short steps."
            variant="secondary"
            onPress={() => router.replace("/report")}
          />
        </Actions>
      </Screen>
    );
  }

  async function share() {
    if (!receipt || !code) return;
    try {
      // The person's own choice of where to keep a copy (Notes, a password manager...). Never a link with the code.
      await Share.share({
        message: [
          "AccessLoop receipt",
          `Organization: ${receipt.orgName}`,
          `Reference: ${receipt.ref}`,
          `Receipt code: ${formatReceiptCode(code)}`,
          "",
          RECEIPT_KEEP,
        ].join("\n"),
      });
    } catch {
      announce("This device can't share from here. You can write the code down instead.");
    }
  }

  function done() {
    clear();
    router.dismissTo("/");
  }

  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          We got your report
        </Heading>
        <Body>{`Thank you for telling ${receipt.orgName}. Your report is with their accessibility team now.`}</Body>
      </Stack>

      <Stack gap="lg">
        <CodeDisplay code={code} label="Your receipt code" />
        <Body bold>{RECEIPT_KEEP}</Body>
        {receipt.kept ? (
          <Notice tone="success">
            We kept this code in My reports on this device. Only this app can read it, and you can remove it there.
          </Notice>
        ) : (
          <Notice tone="warning" title="Write your code down">
            {receipt.reportId
              ? "This browser keeps your code only until you close this tab. Write it down, or save it somewhere safe."
              : "This device did not keep your code. Write it down, or save it somewhere safe, before you leave this screen."}
          </Notice>
        )}
        <Stack gap="xs">
          <Body>{`Reference: ${receipt.ref}`}</Body>
          <Small>{`The reference is not secret. You can give it if you call ${receipt.orgName} about your report. Keep your code to yourself.`}</Small>
        </Stack>
        <Actions>
          <Button
            label="Save the code somewhere else"
            hint="Opens your device's share options, for example to keep a copy in your notes."
            variant="secondary"
            onPress={() => void share()}
          />
        </Actions>
      </Stack>

      <Stack gap="md">
        <Heading level={3}>What happens next</Heading>
        <Body>1. The team reads your report. Names and contact details are hidden from the people who fix it.</Body>
        <Body>2. Someone works on a fix.</Body>
        <Body>
          {receipt.followUp === "none"
            ? "3. You can check where your report is at any time, with your code."
            : "3. When the fix is ready, you tell us if it works for you."}
        </Body>
      </Stack>

      <Actions>
        {receipt.reportId ? (
          <Button label="Open my report" hint="Shows where your report is now." onPress={() => router.push(`/reports/${receipt.reportId}`)} />
        ) : null}
        <Button label="Done" variant={receipt.reportId ? "secondary" : "primary"} hint="Goes back to the start." onPress={done} />
      </Actions>
    </Screen>
  );
}
