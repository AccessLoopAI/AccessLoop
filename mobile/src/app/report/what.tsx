// Step 1 of 4: "What got in your way?" One question: a native multiline TextInput, so the keyboard's dictation
// button works. Focus moves to the step heading when the screen opens; an error moves focus to the field.
import { router } from "expo-router";
import { useRef, useState } from "react";
import { useFocusOnScreen, useFocusWhen } from "../../a11y";
import { LIMITS } from "../../api";
import { ERRORS } from "../../copy";
import { useDraft } from "../../report-draft";
import { Actions, Button } from "../../ui/Button";
import { Screen, Stack } from "../../ui/blocks";
import { StepGuard, stepPrefix, stepTitle } from "../../ui/step";
import { TextField, type InputRef } from "../../ui/TextField";
import { Body, Heading, type HeadingRef } from "../../ui/text";

export default function StepWhat() {
  return (
    <StepGuard>
      <What />
    </StepGuard>
  );
}

function What() {
  const { draft, update } = useDraft();
  const [error, setError] = useState<{ message: string; at: number } | null>(null);
  const heading = useRef<HeadingRef>(null);
  const field = useRef<InputRef>(null);
  useFocusOnScreen(heading);
  useFocusWhen(field, error?.at ?? null);

  function next() {
    const text = draft.text.trim();
    if (!text) return setError({ message: ERRORS.text, at: Date.now() });
    if (text.length > LIMITS.text) return setError({ message: ERRORS.textTooLong(LIMITS.text), at: Date.now() });
    setError(null);
    router.push("/report/where");
  }

  return (
    <Screen>
      <Stack gap="lg">
        <TextField
          id="report-text"
          ref={field}
          label={stepTitle(1)}
          labelElement={
            // The introduction follows the heading, so it is read right after focus lands there.
            <Stack gap="md">
              <Heading level={2} ref={heading} prefix={stepPrefix(1)}>
                {stepTitle(1)}
              </Heading>
              <Body>
                {`Tell ${draft.org?.name ?? "the organization"} what made something hard for you. There are 4 short steps. Take as long as you need, and you don't have to give your name.`}
              </Body>
            </Stack>
          }
          hint="You can type or use your device's dictation."
          error={error?.message}
          value={draft.text}
          onChangeText={(text) => {
            update({ text });
            if (error) setError(null);
          }}
          multiline
          lines={7}
          autoCapitalize="sentences"
          spellCheck
        />
        <Actions>
          <Button label="Next" hint="Goes to step 2: where it happened." onPress={next} />
        </Actions>
      </Stack>
    </Screen>
  );
}
