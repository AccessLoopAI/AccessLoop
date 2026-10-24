// Step 2 of 4: "Where did it happen?" One question (five answers) and an optional "Where exactly?" detail.
// From a location poster, the place is already filled in and the person can change it.
import { router } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import type { Pressable } from "react-native";
import { useFocusOnScreen, useFocusWhen } from "../../a11y";
import { LIMITS } from "../../api";
import { ERRORS, LOCATION_OPTIONS } from "../../copy";
import { useDraft } from "../../report-draft";
import { Actions, Button } from "../../ui/Button";
import { Notice, Screen, Stack } from "../../ui/blocks";
import { RadioGroup } from "../../ui/RadioGroup";
import { StepGuard, stepPrefix, stepTitle } from "../../ui/step";
import { TextField, type InputRef } from "../../ui/TextField";
import { Heading, type HeadingRef } from "../../ui/text";

export default function StepWhere() {
  return (
    <StepGuard>
      <Where />
    </StepGuard>
  );
}

type ErrorState = { field: "where" | "detail"; message: string; at: number } | null;

function Where() {
  const { draft, update } = useDraft();
  const [error, setError] = useState<ErrorState>(null);
  const heading = useRef<HeadingRef>(null);
  const firstOption = useRef<ComponentRef<typeof Pressable>>(null);
  const detail = useRef<InputRef>(null);
  useFocusOnScreen(heading);
  useFocusWhen(firstOption, error?.field === "where" ? error.at : null);
  useFocusWhen(detail, error?.field === "detail" ? error.at : null);

  function next() {
    if (!draft.locationKind) return setError({ field: "where", message: ERRORS.where, at: Date.now() });
    if (draft.locationDetail.trim().length > LIMITS.detail) {
      return setError({ field: "detail", message: ERRORS.detailTooLong(LIMITS.detail), at: Date.now() });
    }
    setError(null);
    router.push("/report/follow-up");
  }

  return (
    <Screen>
      <Stack gap="xl">
        <RadioGroup
          label={stepTitle(2)}
          labelElement={
            <Heading level={2} ref={heading} prefix={stepPrefix(2)}>
              {stepTitle(2)}
            </Heading>
          }
          description={
            draft.locationId ? (
              <Notice tone="info">We filled in the place from the poster you scanned. You can change it.</Notice>
            ) : undefined
          }
          options={LOCATION_OPTIONS}
          value={draft.locationKind}
          onChange={(locationKind) => {
            update({ locationKind });
            if (error?.field === "where") setError(null);
          }}
          error={error?.field === "where" ? error.message : undefined}
          firstOptionRef={firstOption}
        />
        <TextField
          id="where-detail"
          ref={detail}
          label="Where exactly? (optional)"
          hint="For example, the name of the page, the street or the branch."
          error={error?.field === "detail" ? error.message : undefined}
          value={draft.locationDetail}
          onChangeText={(locationDetail) => {
            update({ locationDetail });
            if (error?.field === "detail") setError(null);
          }}
          autoComplete="off"
        />
        <Actions>
          <Button label="Next" hint="Goes to step 3: how we can follow up." onPress={next} />
          <Button label="Back" variant="secondary" hint="Goes back to step 1." onPress={() => router.back()} />
        </Actions>
      </Stack>
    </Screen>
  );
}
