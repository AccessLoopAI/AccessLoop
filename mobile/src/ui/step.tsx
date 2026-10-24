// Shared by the four step screens: what to show when a step is opened without an organization (a stale deep
// link, or the app was restarted), and the step heading text.
import { router } from "expo-router";
import { useRef, type ReactNode } from "react";
import { useFocusOnScreen } from "../a11y";
import { STEP_TITLES, type Step } from "../copy";
import { useDraft } from "../report-draft";
import { Actions, Button } from "./Button";
import { Screen, Stack } from "./blocks";
import { Body, Heading, type HeadingRef } from "./text";

export function stepPrefix(step: Step): string {
  return `Step ${step} of 4`;
}

export function stepTitle(step: Step): string {
  return STEP_TITLES[step];
}

/** Renders the step only when an organization was chosen; otherwise a calm way back to the start. */
export function StepGuard({ children }: { children: ReactNode }) {
  const { draft } = useDraft();
  if (draft.org) return <>{children}</>;
  // Just sent: this step is on its way out under the receipt, so it shows nothing rather than flash a message.
  if (draft.receipt) return <Screen>{null}</Screen>;
  return <NoOrganization />;
}

function NoOrganization() {
  const heading = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          Choose who to tell first
        </Heading>
        <Body>This report has no organization yet. Nothing you typed was sent.</Body>
      </Stack>
      <Actions>
        <Button
          label="Choose the organization"
          hint="Goes to the first screen of a report, where you choose who to tell."
          onPress={() => router.replace("/report")}
        />
      </Actions>
    </Screen>
  );
}
