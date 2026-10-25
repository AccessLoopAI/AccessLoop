// An unknown link or screen: one calm sentence and a way home.
import { router } from "expo-router";
import { useRef } from "react";
import { useFocusOnScreen } from "../a11y";
import { Actions, Button } from "../ui/Button";
import { Screen, Stack } from "../ui/blocks";
import { Body, Heading, type HeadingRef } from "../ui/text";

export default function NotFound() {
  const heading = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          We couldn&apos;t find that screen
        </Heading>
        <Body>The link may be old. You can start again from the first screen.</Body>
      </Stack>
      <Actions>
        <Button label="Go to the first screen" hint="Opens the first screen of the app." onPress={() => router.replace("/")} />
      </Actions>
    </Screen>
  );
}
