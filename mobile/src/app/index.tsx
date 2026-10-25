// Home: report a barrier, see the reports this device keeps, or check one with a code.
import { router } from "expo-router";
import { useRef } from "react";
import { useFocusOnScreen } from "../a11y";
import { Button } from "../ui/Button";
import { Screen, Stack } from "../ui/blocks";
import { Body, Heading, type HeadingRef } from "../ui/text";

export default function Home() {
  const heading = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          Tell an organization about a barrier
        </Heading>
        <Body>
          A barrier is anything that makes it hard for you to take part: a website or an app, a building, a phone line, a
          document or a rule.
        </Body>
        <Body>
          Tell the organization what happened, and check later that it was fixed. You don&apos;t have to give your name.
        </Body>
      </Stack>
      <Stack gap="md">
        <Button
          label="Report a barrier"
          hint="Starts a new report. There are 4 short steps."
          onPress={() => router.push("/report")}
          wide
        />
        <Button
          label="My reports"
          hint="Shows the reports you sent from this device."
          variant="secondary"
          onPress={() => router.push("/reports")}
          wide
        />
        <Button
          label="Check a report with your code"
          hint="Type the receipt code you got when you sent a report."
          variant="secondary"
          onPress={() => router.push("/check")}
          wide
        />
      </Stack>
    </Screen>
  );
}
