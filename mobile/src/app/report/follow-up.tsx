// Step 3 of 4: "How can we follow up?" One question, three answers (T4 item 2); the email field appears only
// with the third. "Next" asks the server for the AI summary (once; never streamed; up to a minute with a real
// model, and nothing times out for the person). "Skip the AI summary" goes on without the AI ever seeing it.
import { router } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import type { Pressable } from "react-native";
import { useAnnounce, useFocusOnScreen, useFocusWhen } from "../../a11y";
import { EMAIL_PATTERN, LIMITS, previewReport } from "../../api";
import {
  AI_DISCLOSURE,
  AI_LATER_CHOICE,
  EMAIL_HINT,
  ERRORS,
  FOLLOW_UP_OPTIONS,
  RATE_LIMITED_MESSAGE,
  SUMMARIZING,
} from "../../copy";
import { previewKeyOf, useDraft, type PreviewState } from "../../report-draft";
import { Actions, Button } from "../../ui/Button";
import { Notice, Screen, Stack } from "../../ui/blocks";
import { RadioGroup } from "../../ui/RadioGroup";
import { StepGuard, stepPrefix, stepTitle } from "../../ui/step";
import { TextField, type InputRef } from "../../ui/TextField";
import { Body, Heading, type HeadingRef } from "../../ui/text";

export default function StepFollowUp() {
  return (
    <StepGuard>
      <FollowUpStep />
    </StepGuard>
  );
}

type ErrorState = { field: "followUp" | "email" | "general"; message: string; at: number } | null;

function FollowUpStep() {
  const { draft, update } = useDraft();
  const announce = useAnnounce();
  const [error, setError] = useState<ErrorState>(null);
  const [previewing, setPreviewing] = useState(false);
  const heading = useRef<HeadingRef>(null);
  const firstOption = useRef<ComponentRef<typeof Pressable>>(null);
  const email = useRef<InputRef>(null);
  const general = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  useFocusWhen(firstOption, error?.field === "followUp" ? error.at : null);
  useFocusWhen(email, error?.field === "email" ? error.at : null);
  useFocusWhen(general, error?.field === "general" ? error.at : null);

  /** The answers on this screen are complete. */
  function valid(): boolean {
    if (!draft.followUp) {
      setError({ field: "followUp", message: ERRORS.followUp, at: Date.now() });
      return false;
    }
    if (draft.followUp === "email") {
      const e = draft.email.trim();
      if (!e) {
        setError({ field: "email", message: ERRORS.emailMissing, at: Date.now() });
        return false;
      }
      if (e.length > LIMITS.email || !EMAIL_PATTERN.test(e)) {
        setError({ field: "email", message: ERRORS.emailFormat, at: Date.now() });
        return false;
      }
    }
    setError(null);
    return true;
  }

  async function next() {
    if (previewing || !valid() || !draft.org) return;
    const key = previewKeyOf(draft);
    // Back, then Next, with nothing changed that the summary depends on: keep it, and the answer (WCAG 3.3.7).
    if (key === draft.previewKey && draft.preview?.summary && !draft.aiSkipped) {
      router.push("/report/review");
      return;
    }
    const hadAnswer = draft.choice !== null;
    setPreviewing(true);
    announce(SUMMARIZING);
    const r = await previewReport(draft.org.slug, {
      text: draft.text.trim(),
      locationKind: draft.locationKind ?? "other",
      locationDetail: draft.locationDetail.trim(),
      aiOptOut: false,
    });
    setPreviewing(false);
    if (!r.ok && r.problem === "rate_limited") {
      // Stay here and say so: nothing is lost, and Next works again after a short wait.
      announce(RATE_LIMITED_MESSAGE);
      setError({ field: "general", message: RATE_LIMITED_MESSAGE, at: Date.now() });
      return;
    }
    if (!r.ok && r.problem === "not_found") {
      setError({
        field: "general",
        message: "We couldn't find this organization. Go back to the start and check its short name. Nothing was sent.",
        at: Date.now(),
      });
      return;
    }
    // Any other trouble: the review shows the person's own words. Sending still works.
    const preview: PreviewState = r.ok ? { ...r.data, failed: r.data.summary === null } : { summary: null, token: null, failed: true };
    update({
      preview,
      previewKey: key,
      aiSkipped: false,
      choice: null,
      edited: preview.summary ?? "",
      summaryRenewed: hadAnswer && preview.summary !== null,
    });
    router.push("/report/review");
  }

  function skipAi() {
    if (previewing || !valid()) return;
    update({
      aiSkipped: true,
      preview: { summary: null, token: null, failed: false },
      previewKey: null,
      choice: null,
      edited: "",
      summaryRenewed: false,
    });
    router.push("/report/review");
  }

  return (
    <Screen>
      <Stack gap="xl">
        <RadioGroup
          label={stepTitle(3)}
          labelElement={
            <Heading level={2} ref={heading} prefix={stepPrefix(3)}>
              {stepTitle(3)}
            </Heading>
          }
          description={<Body tone="muted">You can hear back from us, or stay anonymous. Both are fine.</Body>}
          options={FOLLOW_UP_OPTIONS}
          value={draft.followUp}
          onChange={(followUp) => {
            update({ followUp });
            if (error?.field === "followUp") setError(null);
          }}
          error={error?.field === "followUp" ? error.message : undefined}
          firstOptionRef={firstOption}
          conditional={{
            email: (
              <TextField
                id="reporter-email"
                ref={email}
                label="Email address"
                hint={EMAIL_HINT}
                error={error?.field === "email" ? error.message : undefined}
                value={draft.email}
                onChangeText={(value) => {
                  update({ email: value });
                  if (error?.field === "email") setError(null);
                }}
                keyboardType="email-address"
                inputMode="email"
                autoComplete="email"
                textContentType="emailAddress"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                maxLength={LIMITS.email}
              />
            ),
          }}
        />

        <Notice tone="info">{`${AI_DISCLOSURE} ${AI_LATER_CHOICE}`}</Notice>

        {error?.field === "general" ? (
          <Stack gap="sm">
            <Heading level={3} ref={general}>
              We could not go on just now
            </Heading>
            <Notice tone="warning">{error.message}</Notice>
          </Stack>
        ) : null}

        <Actions>
          <Button
            label="Next"
            hint="Makes a short AI summary, then shows your report to check."
            busy={previewing}
            onPress={() => void next()}
          />
          <Button
            label="Skip the AI summary"
            hint="Goes to the next step without using AI on your report."
            variant="secondary"
            disabled={previewing}
            onPress={skipAi}
          />
          <Button label="Back" variant="secondary" hint="Goes back to step 2." disabled={previewing} onPress={() => router.back()} />
        </Actions>
        {previewing ? (
          // Not announced again: the announcer already said "Summarizing your report…".
          <Body>
            <Body bold>{SUMMARIZING}</Body> It can take up to a minute.
          </Body>
        ) : null}
      </Stack>
    </Screen>
  );
}
