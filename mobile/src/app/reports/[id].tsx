// One report's status and the in-app re-test (the web's /r/[code], domain §3). The route holds a LOCAL id; the
// code is read from the secure store (or this session's memory) and sent only in the Authorization header.
// Answers are POSTs. Only the reporter's own answer can make a report "Fixed and confirmed by you".
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState, type ComponentRef } from "react";
import type { Pressable } from "react-native";
import { useAnnounce, useFocusOnScreen, useFocusWhen } from "../../a11y";
import { answerRetest, getStatus, LIMITS, type ApiProblem, type ReporterStatus, type RetestAnswer } from "../../api";
import {
  ERRORS,
  nextStepSentence,
  problemMessage,
  RATE_LIMITED_MESSAGE,
  RETEST_ANSWERS,
  RETEST_QUESTION,
  RETEST_RESULT_MESSAGES,
} from "../../copy";
import { formatDate } from "../../format";
import { canKeepCodes, forgetReport, getReport, keepReport, refreshFacts, type SavedReport } from "../../reports-store";
import { Actions, Button } from "../../ui/Button";
import { Card, CodeDisplay, Notice, RedactedText, Screen, Stack, StatusBadge, type NoticeTone } from "../../ui/blocks";
import { RadioGroup } from "../../ui/RadioGroup";
import { TextField, type InputRef } from "../../ui/TextField";
import { Body, Heading, Small, type HeadingRef } from "../../ui/text";

type Load =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "problem"; problem: ApiProblem }
  | { kind: "ready"; status: ReporterStatus };

/** The words of the "could not load" notice (also said once after a "Try again" that failed). */
function loadProblemMessage(problem: ApiProblem): string {
  return problem === "not_found"
    ? "We couldn't find a report for this code any more. Check the code on your receipt."
    : problemMessage(problem, "load your report");
}

type Outcome = { title: string; message: string; tone: NoticeTone; at: number; answer?: RetestAnswer } | null;

function isTerminal(s: ReporterStatus["status"]) {
  return s === "verified" || s === "closed";
}

export default function ReportStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const announce = useAnnounce();
  const [saved, setSaved] = useState<SavedReport | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [answer, setAnswer] = useState<RetestAnswer | null>(null);
  const [comment, setComment] = useState("");
  const [fieldError, setFieldError] = useState<{ field: "answer" | "comment"; message: string; at: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [secure, setSecure] = useState(false);
  // Where focus goes after a button that was pressed disappears (so it never drops to the top of the screen).
  // "status": after "Try again" loaded the report (the button is gone), the "Where your report is now" heading.
  const [focusAfter, setFocusAfter] = useState<{ to: "confirm" | "remove" | "code" | "status"; at: number } | null>(null);

  const heading = useRef<HeadingRef>(null);
  const outcomeHeading = useRef<HeadingRef>(null);
  const firstAnswer = useRef<ComponentRef<typeof Pressable>>(null);
  const commentField = useRef<InputRef>(null);
  const codeHeading = useRef<HeadingRef>(null);
  const confirmHeading = useRef<HeadingRef>(null);
  const removeButton = useRef<ComponentRef<typeof Pressable>>(null);
  const statusHeading = useRef<HeadingRef>(null);
  useFocusOnScreen(heading);
  useFocusWhen(statusHeading, focusAfter?.to === "status" ? focusAfter.at : null);
  useFocusWhen(codeHeading, focusAfter?.to === "code" ? focusAfter.at : null);
  useFocusWhen(confirmHeading, focusAfter?.to === "confirm" ? focusAfter.at : null);
  useFocusWhen(removeButton, focusAfter?.to === "remove" ? focusAfter.at : null);
  useFocusWhen(outcomeHeading, outcome?.at ?? null);
  useFocusWhen(firstAnswer, fieldError?.field === "answer" ? fieldError.at : null);
  useFocusWhen(commentField, fieldError?.field === "comment" ? fieldError.at : null);

  const refresh = useCallback(async (): Promise<Load> => {
    const report = typeof id === "string" ? await getReport(id) : null;
    setSecure(await canKeepCodes());
    setSaved(report);
    if (!report) {
      setLoad({ kind: "missing" });
      return { kind: "missing" };
    }
    const r = await getStatus(report.code);
    if (!r.ok) {
      setLoad({ kind: "problem", problem: r.problem });
      return { kind: "problem", problem: r.problem };
    }
    const ready: Load = { kind: "ready", status: r.data };
    setLoad(ready);
    if (r.data.ref && (r.data.ref !== report.ref || r.data.orgName !== report.orgName)) {
      void refreshFacts(report.id, { ref: r.data.ref, orgName: r.data.orgName, orgSlug: r.data.orgSlug }).catch(() => {});
    }
    return ready;
  }, [id]);

  // "Try again": say what happened. Loaded, its button is gone, so focus moves to the report's status heading;
  // failed again, the same notice stays and the problem is said once (focus stays on "Try again").
  async function tryAgain() {
    const next = await refresh();
    if (next.kind === "ready") {
      announce("Your report is loaded.");
      setFocusAfter({ to: "status", at: Date.now() });
    } else if (next.kind === "problem") {
      announce(loadProblemMessage(next.problem));
    } else if (next.kind === "missing") {
      announce("This report is not on this device.");
    }
  }

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function send(source: "question" | "stop_contact") {
    if (sending || !saved) return;
    const chosen: RetestAnswer | null = source === "stop_contact" ? "opt_out" : answer;
    const text = source === "question" ? comment.trim() : "";
    if (!chosen) return setFieldError({ field: "answer", message: ERRORS.retestChoose, at: Date.now() });
    if (text.length > LIMITS.retestComment) {
      return setFieldError({ field: "comment", message: ERRORS.retestCommentTooLong(LIMITS.retestComment), at: Date.now() });
    }
    setFieldError(null);
    setSending(true);
    const r = await answerRetest(saved.code, { answer: chosen, comment: text, source });
    setSending(false);
    const at = Date.now();
    let next: Outcome;
    if (r.ok) {
      next = {
        title: "Your answer is saved",
        message: RETEST_RESULT_MESSAGES[chosen],
        tone: chosen === "fixed" ? "success" : "info",
        at,
        answer: chosen,
      };
      setComment("");
      setAnswer(null);
    } else if (r.problem === "already_answered") {
      next = {
        title: "This question is already answered",
        message: "This question is already answered. This screen now shows where your report is.",
        tone: "info",
        at,
      };
    } else if (r.problem === "not_found") {
      next = {
        title: "We couldn't find this report",
        message: "We couldn't find a report for this code any more. Check the code on your receipt.",
        tone: "warning",
        at,
      };
    } else if (r.problem === "rate_limited") {
      next = { title: "Please wait a few minutes", message: RATE_LIMITED_MESSAGE, tone: "warning", at };
    } else {
      // Nothing typed is lost: the answer and the comment stay as they were.
      next = { title: "Your answer was not saved", message: problemMessage(r.problem, "save your answer"), tone: "danger", at };
    }
    setOutcome(next);
    announce(next.message);
    if (r.ok || r.problem === "already_answered") await refresh();
  }

  async function keepHere() {
    if (!saved) return;
    try {
      const kept = await keepReport(saved);
      setSaved(kept);
      announce(kept.kept ? "We kept this report in My reports on this device." : "This browser can't keep codes.");
      // "Keep it in My reports" is gone now: focus goes to the start of this part of the screen.
      if (kept.kept) setFocusAfter({ to: "code", at: Date.now() });
    } catch {
      announce("We could not keep this code on this device. Write it down instead.");
    }
  }

  async function remove() {
    if (!saved) return;
    await forgetReport(saved.id).catch(() => {});
    announce("We removed this report from this device.");
    router.back();
  }

  const status = load.kind === "ready" ? load.status : null;
  const answered = Boolean(outcome?.answer);
  const showQuestion = status?.status === "retest_open" && !answered;
  const showStopContact = Boolean(
    status && status.wantsRetest && !isTerminal(status.status) && status.status !== "retest_open" && !answered,
  );
  const orgName = status?.orgName || saved?.orgName || "the organization";

  return (
    <Screen>
      <Stack gap="md">
        <Heading level={2} ref={heading}>
          Your report
        </Heading>
        {saved ? (
          <Body>{`This screen shows where your report to ${orgName} is.`}</Body>
        ) : null}
        {status ? (
          <Stack gap="xs">
            <Body>{`Reference: ${status.ref}`}</Body>
            {formatDate(status.receivedAt) ? <Body>{`Received ${formatDate(status.receivedAt)}`}</Body> : null}
          </Stack>
        ) : null}
      </Stack>

      {outcome ? (
        <Stack gap="sm">
          <Heading level={3} ref={outcomeHeading}>
            {outcome.title}
          </Heading>
          <Notice tone={outcome.tone}>{outcome.message}</Notice>
        </Stack>
      ) : null}

      {load.kind === "loading" ? <Body tone="muted">Loading where your report is…</Body> : null}

      {load.kind === "missing" ? (
        <Stack gap="md">
          <Notice tone="warning" title="This report is not on this device">
            It may have been removed. If you have the code, you can check the report again.
          </Notice>
          <Actions>
            <Button
              label="Check a report with your code"
              hint="Type the receipt code you got when you sent a report."
              onPress={() => router.replace("/check")}
            />
          </Actions>
        </Stack>
      ) : null}

      {load.kind === "problem" ? (
        <Stack gap="md">
          <Notice tone="warning" title={load.problem === "not_found" ? "We couldn't find this report" : "We could not load your report"}>
            {loadProblemMessage(load.problem)}
          </Notice>
          {load.problem !== "not_found" ? (
            <Actions>
              <Button label="Try again" hint="Asks AccessLoop again where your report is." onPress={() => void tryAgain()} />
            </Actions>
          ) : null}
        </Stack>
      ) : null}

      {status ? (
        <Card title="Where your report is now" titleRef={statusHeading}>
          <StatusBadge
            status={status.status}
            closedReason={status.closedReason}
            celebrate={outcome?.answer === "fixed" && status.status === "verified"}
          />
          {showQuestion || (answered && (status.status === "verified" || status.status === "retest_open")) ? null : (
            <Body>{nextStepSentence(status.status, status.wantsRetest)}</Body>
          )}
          {status.status === "fixed_unverified" ? (
            <Actions>
              <Button
                label="Report a barrier"
                hint="Starts a new report to the same organization."
                variant="secondary"
                role="link"
                onPress={() => router.push({ pathname: "/report", params: status.orgSlug ? { org: status.orgSlug } : {} })}
              />
            </Actions>
          ) : null}
        </Card>
      ) : null}

      {status?.fixDescription ? (
        <Card title="What the team changed">
          <RedactedText text={status.fixDescription} />
        </Card>
      ) : null}

      {showQuestion ? (
        <Stack gap="lg">
          <RadioGroup
            label={RETEST_QUESTION}
            labelElement={<Heading level={3}>{RETEST_QUESTION}</Heading>}
            description={
              <Stack gap="md">
                <Body>The team says they made a fix. Only you can tell us if it works for you.</Body>
                {status?.retestOfferText ? <Notice tone="success">{status.retestOfferText}</Notice> : null}
              </Stack>
            }
            options={RETEST_ANSWERS}
            value={answer}
            onChange={(v) => {
              setAnswer(v);
              if (fieldError?.field === "answer") setFieldError(null);
            }}
            error={fieldError?.field === "answer" ? fieldError.message : undefined}
            firstOptionRef={firstAnswer}
          />
          <TextField
            id="retest-comment"
            ref={commentField}
            label="Anything you want to add? (optional)"
            hint={`Please don't add your name or contact details. Up to ${LIMITS.retestComment.toLocaleString("en-CA")} characters.`}
            error={fieldError?.field === "comment" ? fieldError.message : undefined}
            value={comment}
            onChangeText={(v) => {
              setComment(v);
              if (fieldError?.field === "comment") setFieldError(null);
            }}
            multiline
            lines={4}
          />
          <Actions>
            <Button label="Send answer" hint="Tells the team if the fix works for you." busy={sending} onPress={() => void send("question")} />
          </Actions>
        </Stack>
      ) : null}

      {showStopContact && status ? (
        <Stack gap="md">
          <Heading level={3}>Changed your mind?</Heading>
          <Body>
            {`You said we could ask you to check the fix. If you don't want that any more, you can stop it here. ${
              status.status === "fixed_unverified" ? "Your report stays as it is." : "The team will still work on your report."
            }`}
          </Body>
          <Actions>
            <Button
              label="Stop contact about this report"
              hint="We won't ask you about this report again."
              variant="secondary"
              busy={sending}
              onPress={() => void send("stop_contact")}
            />
          </Actions>
        </Stack>
      ) : null}

      {saved ? (
        <Stack gap="md">
          <Heading level={3} ref={codeHeading}>
            Your code
          </Heading>
          <Actions>
            <Button
              label={showCode ? "Hide my code" : "Show my code"}
              hint={
                showCode
                  ? "Takes the receipt code off the screen."
                  : "Shows the receipt code on the screen. Make sure nobody else can see it."
              }
              variant="secondary"
              expanded={showCode}
              onPress={() => setShowCode((v) => !v)}
            />
          </Actions>
          {showCode ? <CodeDisplay code={saved.code} label="Your receipt code" /> : null}
          {saved.kept ? (
            confirmRemove ? (
              <Stack gap="md">
                <Heading level={3} ref={confirmHeading}>
                  Remove this report from this device?
                </Heading>
                <Notice tone="warning">To check it again later, you will need the code.</Notice>
                <Actions>
                  <Button
                    label="Yes, remove it"
                    hint="Deletes the code from this device. The report itself stays with the organization."
                    variant="danger"
                    onPress={() => void remove()}
                  />
                  <Button
                    label="Keep it"
                    hint="Keeps the code on this device."
                    variant="secondary"
                    onPress={() => {
                      setConfirmRemove(false);
                      setFocusAfter({ to: "remove", at: Date.now() });
                    }}
                  />
                </Actions>
              </Stack>
            ) : (
              <Stack gap="sm">
                <Small>This code is kept in My reports on this device.</Small>
                <Actions>
                  <Button
                    ref={removeButton}
                    label="Remove from this device"
                    hint="Asks you first. The report itself stays with the organization."
                    variant="secondary"
                    onPress={() => {
                      // The question replaces this button: focus moves to it.
                      setConfirmRemove(true);
                      setFocusAfter({ to: "confirm", at: Date.now() });
                    }}
                  />
                </Actions>
              </Stack>
            )
          ) : secure ? (
            <Actions>
              <Button
                label="Keep it in My reports"
                hint="Keeps the code on this device, where only this app can read it."
                variant="secondary"
                onPress={() => void keepHere()}
              />
            </Actions>
          ) : (
            <Small>This browser keeps the code only until you close this tab.</Small>
          )}
        </Stack>
      ) : null}
    </Screen>
  );
}
