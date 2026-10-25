// Step 4 of 4: "Check your report". "Your words" exactly as typed, the AI summary ("We understood") with one
// question and four answers (confirm / change / keep my words / don't use AI), the person's choices, then
// "Send report". On success the code is kept in the secure store and the receipt screen opens.
import { router } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import type { Pressable } from "react-native";
import { useAnnounce, useFocusOnScreen, useFocusWhen } from "../../a11y";
import { LIMITS, submitReport } from "../../api";
import {
  ERRORS,
  FOLLOW_UP_OPTIONS,
  LOCATION_OPTIONS,
  NO_AI_NOTE,
  problemMessage,
  REVIEW_OPTIONS,
  SENDING,
} from "../../copy";
import { hasSummary, submitBody, useDraft } from "../../report-draft";
import { keepReport } from "../../reports-store";
import { Actions, Button } from "../../ui/Button";
import { Card, Notice, RedactedText, Screen, Stack } from "../../ui/blocks";
import { RadioGroup } from "../../ui/RadioGroup";
import { StepGuard, stepPrefix, stepTitle } from "../../ui/step";
import { TextField, type InputRef } from "../../ui/TextField";
import { Body, Heading, Small, type HeadingRef } from "../../ui/text";

export default function StepReview() {
  return (
    <StepGuard>
      <Review />
    </StepGuard>
  );
}

type ErrorState = { field: "choice" | "edited" | "send"; message: string; at: number } | null;

function Review() {
  const { draft, update, finish } = useDraft();
  const announce = useAnnounce();
  const [error, setError] = useState<ErrorState>(null);
  const [sending, setSending] = useState(false);
  const heading = useRef<HeadingRef>(null);
  const firstChoice = useRef<ComponentRef<typeof Pressable>>(null);
  const edited = useRef<InputRef>(null);
  const sendError = useRef<HeadingRef>(null);
  const [editOpened, setEditOpened] = useState<number | null>(null);
  useFocusOnScreen(heading);
  useFocusWhen(firstChoice, error?.field === "choice" ? error.at : null);
  useFocusWhen(edited, error?.field === "edited" ? error.at : editOpened);
  useFocusWhen(sendError, error?.field === "send" ? error.at : null);

  const summary = hasSummary(draft);
  const where = LOCATION_OPTIONS.find((o) => o.value === draft.locationKind)?.label ?? "";
  const detail = draft.locationDetail.trim();
  const followUp = FOLLOW_UP_OPTIONS.find((o) => o.value === draft.followUp)?.label ?? "";
  const aiUsed = summary && draft.choice !== "no_ai";

  async function send() {
    if (sending || !draft.org) return;
    if (summary && !draft.choice) return setError({ field: "choice", message: ERRORS.choice, at: Date.now() });
    if (summary && draft.choice === "ai_edited") {
      const t = draft.edited.trim();
      if (!t) return setError({ field: "edited", message: ERRORS.edited, at: Date.now() });
      if (t.length > LIMITS.editedSummary) {
        return setError({ field: "edited", message: ERRORS.editedTooLong(LIMITS.editedSummary), at: Date.now() });
      }
    }
    setError(null);
    setSending(true);
    announce(SENDING);
    const org = draft.org;
    const r = await submitReport(org.slug, submitBody(draft));
    if (!r.ok) {
      setSending(false);
      const message =
        r.problem === "not_found"
          ? "We could not find this organization's form. Go back to the start and check its short name. Your answers are still here."
          : r.problem === "invalid"
            ? (r.message ?? "Part of your report could not be read. Go back and check your answers.")
            : r.problem === "rate_limited"
              ? problemMessage("rate_limited", "send your report")
              : `${problemMessage(r.problem, "send your report")} Your answers are still here.`;
      announce("Your report was not sent.");
      return setError({ field: "send", message, at: Date.now() });
    }
    // Sent. Keep the code on this device (secure store only); if that fails, the receipt says to write it down.
    const facts = { code: r.data.receiptCode, ref: r.data.ref, orgName: org.name, orgSlug: org.slug };
    let reportId = "";
    let kept = false;
    try {
      const saved = await keepReport(facts);
      reportId = saved.id;
      kept = saved.kept;
    } catch {
      kept = false;
    }
    finish({
      code: r.data.receiptCode,
      ref: r.data.ref,
      orgName: org.name,
      reportId,
      kept,
      followUp: draft.followUp ?? "none",
    });
    setSending(false);
    // Home underneath, then the receipt: Back from the receipt never re-opens the sent form.
    router.dismissTo("/");
    router.push("/report/receipt");
  }

  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading} prefix={stepPrefix(4)}>
          {stepTitle(4)}
        </Heading>
        <Body tone="muted">Read it over before you send it. You can still go back and change anything.</Body>
        {summary && draft.summaryRenewed ? (
          <Notice tone="info">You changed your report, so we wrote a new summary. Check it again.</Notice>
        ) : null}
      </Stack>

      <Card title="Your words" tone="inset">
        <Body selectable>{draft.text.trim()}</Body>
        <Small tone="muted">Where it happened</Small>
        <Body>{detail ? `${where}: ${detail}` : where}</Body>
      </Card>

      {summary && draft.preview?.summary ? (
        <Card title="We understood">
          <Small>Our AI tool wrote this short version of your report. It leaves out names and contact details.</Small>
          <RedactedText text={draft.preview.summary} large />
          <RadioGroup
            label="Is this right?"
            options={REVIEW_OPTIONS}
            value={draft.choice}
            onChange={(choice) => {
              update({ choice });
              if (error?.field === "choice" || error?.field === "edited") setError(null);
              // "Change it": focus goes to the field that just appeared (its label is read).
              if (choice === "ai_edited") setEditOpened(Date.now());
            }}
            error={error?.field === "choice" ? error.message : undefined}
            firstOptionRef={firstChoice}
            conditional={{
              ai_edited: (
                <TextField
                  id="edited-summary"
                  ref={edited}
                  label="Your summary"
                  hint="Write it the way you want the team to read it. We take out contact details, and a staff member checks it for names."
                  error={error?.field === "edited" ? error.message : undefined}
                  value={draft.edited}
                  onChangeText={(value) => {
                    update({ edited: value });
                    if (error?.field === "edited") setError(null);
                  }}
                  multiline
                  lines={4}
                />
              ),
              reporter_words: <Body>We will send your own words, just as you wrote them.</Body>,
              no_ai: <Body>{NO_AI_NOTE}</Body>,
            }}
          />
        </Card>
      ) : (
        <Notice tone="info">
          {draft.aiSkipped
            ? "You asked us not to use AI. A staff member will read your words."
            : "We could not make a short summary this time. A staff member will read your words."}
        </Notice>
      )}

      <Card title="Your choices" tone="inset">
        <Choice term="How we follow up" value={followUp} />
        {draft.followUp === "email" ? <Choice term="Email reply" value={`Yes, to ${draft.email.trim()}`} /> : null}
        <Choice term="AI summary" value={draft.aiSkipped || draft.choice === "no_ai" ? "Not used" : aiUsed ? "Used" : "Not used this time"} />
      </Card>

      {error?.field === "send" ? (
        <Stack gap="sm">
          <Heading level={3} ref={sendError}>
            Your report was not sent
          </Heading>
          <Notice tone="danger">{error.message}</Notice>
        </Stack>
      ) : null}

      <Actions>
        <Button label="Send report" hint="Sends your report and shows your receipt code." busy={sending} onPress={() => void send()} />
        <Button label="Back" variant="secondary" hint="Goes back to step 3." disabled={sending} onPress={() => router.back()} />
      </Actions>
      {sending ? <Body bold>{SENDING}</Body> : null}
    </Screen>
  );
}

function Choice({ term, value }: { term: string; value: string }) {
  return (
    <Stack gap="xs">
      <Body bold>{term}</Body>
      <Body>{value}</Body>
    </Stack>
  );
}
