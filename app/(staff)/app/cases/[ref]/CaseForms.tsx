"use client";

// The step forms of the staff case page: triage, correct the triage, assign, log fix, close, reopen, stop waiting,
// the acknowledgement (ACR s.9(4)), the one re-test reminder, and "Add a note". Accessible names here are the
// e2e contract (e2e/demo.spec.ts): "Priority area", "Public summary", "Save triage", "Assign to", "Assign",
// "What did you fix?", "Log fix". Keep every button name unique on the page (Playwright matches substrings:
// nothing else may contain "Assign"), and no other label may contain "Priority area" or "Public summary" (the
// correction form sits on the same page as "Assign to"). The server actions re-check everything; these forms only
// collect input.
import { useRef, useState } from "react";
import {
  BellRing,
  CalendarCheck,
  CheckCheck,
  Hourglass,
  ListChecks,
  MailCheck,
  NotebookPen,
  PencilLine,
  RotateCcw,
  UserRoundCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextareaField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { SelectField } from "@/components/ui/Select";
import { NOTE_KIND_LABELS } from "@/lib/cases/notes";
import {
  AREA_OPTIONS,
  CLOSE_REASON_OPTIONS,
  FIX_DESCRIPTION_MAX,
  NOTE_MAX,
  PUBLIC_SUMMARY_MAX,
  type AiAreaSuggestion,
} from "@/lib/cases/triage";
import {
  addNote,
  assignCase,
  closeCase,
  logFix,
  recordAcknowledgement,
  reopenCase,
  retriageCase,
  saveTriage,
  sendAcknowledgementEmail,
  sendReminder,
  stopWaiting,
} from "./actions";
import { summaryItems, useCaseAction } from "./CaseFeedback";

/** The task's heading inside the "Next step" card: the design system's sub-heading (app/globals.css .al-subhead). */
function FormHeading({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="al-subhead">
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------------ triage */

const TRIAGE_IDS = { priorityArea: "triage-area", publicSummary: "triage-summary" };

/**
 * The AI's suggestion under "Priority area" (domain §6): the area, its confidence as a plain word, whether it is
 * pre-selected, and what the AI was unsure about. It is the select's hint, so a screen reader hears it with the select.
 */
function AiSuggestionHint({ s }: { s: AiAreaSuggestion }) {
  return (
    <div className="grid gap-1">
      <p>
        <span className="font-bold text-ink">AI suggestion:</span> {s.label} ({s.word} confidence).
      </p>
      <p>
        {s.preselect
          ? "It is selected. Check it: the area decides where this case counts in the progress report."
          : "It is not selected, because the AI was not sure. Choose the area yourself."}
      </p>
      {s.uncertain.length ? (
        <>
          <p>The AI was unsure about:</p>
          <ul className="m-0 list-disc pl-5">
            {s.uncertain.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function TriageForm({ caseRef, suggestion }: { caseRef: string; suggestion: AiAreaSuggestion | null }) {
  const { onSubmit, pending, errors } = useCaseAction(saveTriage);
  const e = errors?.fields ?? {};
  // Below the eval's abstain threshold (0.5) the AI's guess is shown but never pre-selected.
  const preselected = suggestion?.preselect ? suggestion.area : null;
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="triage-title" className="grid gap-5">
      <FormHeading id="triage-title">Triage</FormHeading>
      <ErrorSummary errors={summaryItems(errors, TRIAGE_IDS)} focusKey={errors?.at} />
      <input type="hidden" name="ref" value={caseRef} />
      <SelectField
        id={TRIAGE_IDS.priorityArea}
        name="priorityArea"
        label="Priority area"
        hint={
          suggestion ? <AiSuggestionHint s={suggestion} /> : "Choose the area of the Accessible Canada Act this barrier belongs to."
        }
        options={AREA_OPTIONS}
        placeholderOption={preselected ? undefined : "Choose an area"}
        defaultValue={preselected ?? ""}
        required
        error={e.priorityArea}
        selectWidth="medium"
      />
      <TextareaField
        id={TRIAGE_IDS.publicSummary}
        name="publicSummary"
        label="Public summary"
        hint={`Shown in public reports. Describe the barrier in one plain sentence, with no names or details that could identify anyone. Up to ${PUBLIC_SUMMARY_MAX} characters.`}
        rows={3}
        required
        error={e.publicSummary}
      />
      <div>
        <Button type="submit" pending={pending} iconStart={<Icon icon={ListChecks} />}>
          Save triage
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ assign */

/**
 * Assign (decision D8: with an optional due date). The date field shows the current due date when the case is
 * assigned, so pressing "Assign" again with another date (or none) changes only that. The name stays exactly
 * "Due date (optional)": no other label on the page contains "Assign to", and no button but this one "Assign".
 */
export function AssignForm({
  caseRef,
  members,
  current,
  currentDue,
  today,
}: {
  caseRef: string;
  members: { id: string; displayName: string }[];
  current: string | null;
  /** The case's due date (YYYY-MM-DD) while it is assigned, else "". */
  currentDue: string;
  /** Today in the display time zone (YYYY-MM-DD): the earliest new due date (an overdue case keeps its own). */
  today: string;
}) {
  const { onSubmit, pending, errors } = useCaseAction(assignCase);
  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="assign-title" className="grid gap-5">
      <FormHeading id="assign-title">{current ? "Change who fixes it, or by when" : "Choose who fixes it"}</FormHeading>
      <ErrorSummary errors={summaryItems(errors, { memberId: "assign-member", dueOn: "assign-due" })} focusKey={errors?.at} />
      <input type="hidden" name="ref" value={caseRef} />
      <SelectField
        id="assign-member"
        name="memberId"
        label="Assign to"
        hint="Owners see only the cases assigned to them, with personal details removed."
        options={members.map((m) => ({ value: m.id, label: m.displayName }))}
        placeholderOption={current ? undefined : "Choose a team or person"}
        defaultValue={current ?? ""}
        required
        error={e.memberId}
        selectWidth="medium"
      />
      <TextField
        id="assign-due"
        name="dueOn"
        type="date"
        label="Due date (optional)"
        hint={
          currentDue
            ? "When the fix should be done by. Clear it to remove the due date. After this date the case shows as overdue in the inbox and My work."
            : "When the fix should be done by. Leave it empty for no due date. After this date the case shows as overdue in the inbox and My work."
        }
        defaultValue={currentDue}
        min={currentDue && currentDue < today ? currentDue : today}
        error={e.dueOn}
        inputWidth="medium"
      />
      <div>
        <Button type="submit" variant={current ? "secondary" : "primary"} pending={pending} iconStart={<Icon icon={UserRoundCheck} />}>
          Assign
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ log fix */

const FIX_IDS = { description: "fix-description", evidenceUrl: "fix-evidence" };

export function LogFixForm({ caseRef, wantsRetest }: { caseRef: string; wantsRetest: boolean }) {
  const { onSubmit, pending, errors } = useCaseAction(logFix);
  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="fix-title" className="grid gap-5">
      <FormHeading id="fix-title">Log the fix</FormHeading>
      <ErrorSummary errors={summaryItems(errors, FIX_IDS)} focusKey={errors?.at} />
      <input type="hidden" name="ref" value={caseRef} />
      <TextareaField
        id={FIX_IDS.description}
        name="description"
        label="What did you fix?"
        hint={
          <>
            The person who reported it reads this on their report page, under &ldquo;What the team changed&rdquo;. Phone numbers and
            emails are taken out automatically, but names are not: don&rsquo;t write anyone&rsquo;s name. Up to{" "}
            {FIX_DESCRIPTION_MAX.toLocaleString("en-CA")} characters.
          </>
        }
        rows={4}
        required
        error={e.description}
      />
      <TextField
        id={FIX_IDS.evidenceUrl}
        name="evidenceUrl"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        label="Link to evidence (optional)"
        hint="A link to a photo, a ticket or a test result, starting with https://. Staff can open it from the history."
        error={e.evidenceUrl}
      />
      <p className="max-w-[var(--measure)] text-small text-ink-muted">
        {wantsRetest
          ? "The reporter agreed to check the fix, so they will be asked if it works for them now."
          : "The reporter did not ask to check the fix, so it will be marked as fixed but not checked by them."}
      </p>
      <div>
        <Button type="submit" pending={pending} iconStart={<Icon icon={Wrench} />}>
          Log fix
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ reopen */

/** Where reopening takes the case (lib/state-machine.ts reopenTarget), in the form's words. */
const REOPEN_WORDS: Record<"fixed_unverified" | "verified" | "triaged" | "new", string> = {
  fixed_unverified: "If the fix did not hold, reopen the case. It goes back to the team it is assigned to, and they can log a new fix.",
  verified:
    "If the fix did not hold after all, reopen the case. It goes back to the team it is assigned to, and from now on it no longer counts as verified by the reporter.",
  triaged: "If the case was closed by mistake, reopen it. It goes back to Triaged with its area and public summary, and you can assign it again.",
  new: "If the case was closed by mistake, reopen it. It goes back to New, and you can triage it.",
};

export function ReopenForm({ caseRef, from = "fixed_unverified" }: { caseRef: string; from?: keyof typeof REOPEN_WORDS }) {
  const { onSubmit, pending, errors } = useCaseAction(reopenCase);
  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="reopen-title" className="grid gap-5">
      <FormHeading id="reopen-title">Reopen the case</FormHeading>
      <p className="max-w-[var(--measure)]">{REOPEN_WORDS[from]}</p>
      <ErrorSummary errors={summaryItems(errors, { reason: "reopen-reason" })} focusKey={errors?.at} />
      <input type="hidden" name="ref" value={caseRef} />
      <TextareaField
        id="reopen-reason"
        name="reason"
        label="Why are you reopening it?"
        hint={`Kept in the case history. No names, please. Up to ${NOTE_MAX.toLocaleString("en-CA")} characters.`}
        rows={3}
        required
        error={e.reason}
      />
      <div>
        <Button type="submit" variant="secondary" pending={pending} iconStart={<Icon icon={RotateCcw} />}>
          Reopen case
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ close */

/**
 * "Close without a fix". `reasons` are the close reasons the state machine allows in this status (D1: "spam" and
 * "out of scope" only before the case is assigned), passed in by the page. A duplicate names its original (Phase 7
 * T2 item 8): the field shows once "Duplicate of another case" is chosen, right after the select.
 */
export function CloseForm({ caseRef, reasons }: { caseRef: string; reasons: readonly string[] }) {
  const { onSubmit, pending, errors } = useCaseAction(closeCase);
  const e = errors?.fields ?? {};
  const options = CLOSE_REASON_OPTIONS.filter((o) => reasons.includes(o.value));
  const started = !reasons.includes("spam");
  const [reason, setReason] = useState("");
  return (
    // A quiet, link-like toggle at the end of "Next step": a full-width bordered row with a chevron read as a select.
    <Disclosure summary="Close without a fix" variant="inline" panelClassName="max-w-none">
      <form onSubmit={onSubmit} method="post" noValidate className="grid gap-5">
        <ErrorSummary
          errors={summaryItems(errors, { reason: "close-reason", duplicateOf: "close-original", note: "close-note" })}
          focusKey={errors?.at}
        />
        <input type="hidden" name="ref" value={caseRef} />
        <p className="max-w-[var(--measure)] text-ink-muted">
          {started
            ? "Work has started on this case, so it can only be closed as a duplicate or as no action possible. It is counted in the progress report as closed without action, and a fix that was logged still counts as not verified. The reporter sees the reason in plain words."
            : "Closed cases are counted in the progress report as closed without action. A case closed as not feedback about a barrier is not counted as feedback: the report says how many there were. The reporter sees the reason in plain words."}
        </p>
        <SelectField
          id="close-reason"
          name="reason"
          label="Reason for closing"
          options={options}
          placeholderOption="Choose a reason"
          defaultValue=""
          required
          error={e.reason}
          selectWidth="medium"
          onChange={(ev) => setReason(ev.currentTarget.value)}
        />
        {reason === "duplicate" ? (
          <TextField
            id="close-original"
            name="duplicateOf"
            label="Reference of the original case"
            hint="The case this one repeats, for example BAR-0003. Both cases will link to each other, and the work goes on in the original."
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            inputWidth="short"
            error={e.duplicateOf}
          />
        ) : null}
        <TextareaField
          id="close-note"
          name="note"
          label="Note (optional)"
          hint={`Kept in the case history, for staff only. No names, please. Up to ${NOTE_MAX.toLocaleString("en-CA")} characters.`}
          rows={3}
          error={e.note}
        />
        <div>
          <Button type="submit" variant="danger" pending={pending} iconStart={<Icon icon={XCircle} />}>
            Close case
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

/**
 * Shown in the next-step card while the reporter has the question. `asked` says what really happened to this round's
 * request (lib/cases/messages.ts retestAskSentence): never "the reporter is asked" when nobody was.
 */
export function WaitingForReporter({ asked }: { asked: string }) {
  return (
    <p data-testid="retest-asked" className="flex max-w-[var(--measure)] items-start gap-3">
      <Icon icon={CheckCheck} className="mt-[0.2em] text-ink-muted" />
      <span>
        {asked} When they answer with their receipt code, the case moves on its own: to verified, back to the team, or to
        fixed but not checked.
      </span>
    </p>
  );
}

/* ------------------------------------------------------------------ correct the triage (D2) */

const RETRIAGE_IDS = { priorityArea: "retriage-area", publicSummary: "retriage-summary", reason: "retriage-reason" };

/** "Correct the triage": change the area and/or the public summary of a triaged or assigned case, with a reason. */
export function RetriageForm({ caseRef, area, publicSummary }: { caseRef: string; area: string; publicSummary: string }) {
  const { onSubmit, pending, errors } = useCaseAction(retriageCase);
  const e = errors?.fields ?? {};
  return (
    <Disclosure summary="Correct the triage" variant="inline" panelClassName="max-w-none">
      <form onSubmit={onSubmit} method="post" noValidate className="grid gap-5">
        <ErrorSummary errors={summaryItems(errors, RETRIAGE_IDS)} focusKey={errors?.at} />
        <input type="hidden" name="ref" value={caseRef} />
        <p className="max-w-[var(--measure)] text-ink-muted">
          If the area or the public summary is wrong, correct it here. Reports built from now on use the new words; the
          history keeps both, with your reason.
        </p>
        <SelectField
          id={RETRIAGE_IDS.priorityArea}
          name="priorityArea"
          label="Area"
          hint="The area of the Accessible Canada Act this barrier belongs to."
          options={AREA_OPTIONS}
          defaultValue={area}
          required
          error={e.priorityArea}
          selectWidth="medium"
        />
        <TextareaField
          id={RETRIAGE_IDS.publicSummary}
          name="publicSummary"
          label="Summary for public reports"
          hint={`One plain sentence, with no names or details that could identify anyone. Up to ${PUBLIC_SUMMARY_MAX} characters.`}
          rows={3}
          defaultValue={publicSummary}
          required
          error={e.publicSummary}
        />
        <TextareaField
          id={RETRIAGE_IDS.reason}
          name="reason"
          label="Why are you correcting it?"
          hint={`Kept in the case history. No names, please. Up to ${NOTE_MAX.toLocaleString("en-CA")} characters.`}
          rows={2}
          required
          error={e.reason}
        />
        <div>
          <Button type="submit" variant="secondary" pending={pending} iconStart={<Icon icon={PencilLine} />}>
            Save correction
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

/* ------------------------------------------------------------------ stop waiting for the reporter (D3) */

/**
 * The lead stops waiting for a reporter who can't be reached, 14 days or more after they were asked: the round
 * ends unanswered and the fix counts as not verified. Before that day, `allowedFrom` is said instead of the button.
 */
export function StopWaitingForm({ caseRef, askedOn, allowedFrom }: { caseRef: string; askedOn: string; allowedFrom: string | null }) {
  const { onSubmit, pending } = useCaseAction(stopWaiting);
  if (allowedFrom) {
    return (
      <p className="max-w-[var(--measure)] text-ink-muted">
        If the reporter can&rsquo;t be reached, you can stop waiting from {allowedFrom}, 14 days after they were asked.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="stop-waiting-title" className="grid gap-4">
      <FormHeading id="stop-waiting-title">Stop waiting for the reporter</FormHeading>
      <p className="max-w-[var(--measure)]">
        The reporter was asked on {askedOn} and has not answered. If they can&rsquo;t be reached, stop waiting: the case
        becomes &ldquo;Fixed, not verified by reporter&rdquo;, the fix counts as not verified, and this round can no
        longer be answered. The history records it as &ldquo;reporter unreachable&rdquo;.
      </p>
      <input type="hidden" name="ref" value={caseRef} />
      <div>
        <Button type="submit" variant="secondary" pending={pending} iconStart={<Icon icon={Hourglass} />}>
          Stop waiting
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ acknowledgement (ACR s.9(4)) */

const ACK_WHY = "ACR s.9(4): acknowledge feedback in the same way it arrived, unless it is anonymous.";

/** Feedback that came by email, with an address on file: AccessLoop sends the acknowledgement email. */
export function AckEmailForm({ caseRef }: { caseRef: string }) {
  const { onSubmit, pending } = useCaseAction(sendAcknowledgementEmail);
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="ack-title" className="grid gap-4">
      <FormHeading id="ack-title">Acknowledge receipt</FormHeading>
      <p className="max-w-[var(--measure)]">
        This feedback came by email. {ACK_WHY} AccessLoop emails the person to say you received it, with its reference
        number. You never see their address here.
      </p>
      <input type="hidden" name="ref" value={caseRef} />
      <div>
        <Button type="submit" pending={pending} iconStart={<Icon icon={MailCheck} />}>
          Send acknowledgement email
        </Button>
      </div>
    </form>
  );
}

/** Phone, mail, in person or another way: the lead acknowledged it that way, and records the day here. */
export function AckRecordForm({
  caseRef,
  channelWords,
  today,
  receivedOn,
}: {
  caseRef: string;
  /** "by phone", "by mail", "in person", "another way", "by email" (no address on file). */
  channelWords: string;
  today: string;
  receivedOn: string;
}) {
  const { onSubmit, pending, errors } = useCaseAction(recordAcknowledgement);
  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="ack-title" className="grid gap-5">
      <FormHeading id="ack-title">Acknowledge receipt</FormHeading>
      <p className="max-w-[var(--measure)]">
        This feedback came {channelWords}. {ACK_WHY} Tell the person {channelWords} that you received it, then record
        the day here.
      </p>
      <ErrorSummary errors={summaryItems(errors, { ackDate: "ack-date" })} focusKey={errors?.at} />
      <input type="hidden" name="ref" value={caseRef} />
      <TextField
        id="ack-date"
        name="ackDate"
        type="date"
        label={`I acknowledged ${channelWords} on`}
        hint="Not before the day it arrived, and not in the future."
        defaultValue={today}
        min={receivedOn}
        max={today}
        required
        inputWidth="medium"
        error={e.ackDate}
      />
      <div>
        <Button type="submit" pending={pending} iconStart={<Icon icon={CalendarCheck} />}>
          Record acknowledgement
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ the one re-test reminder (domain §3) */

export function ReminderForm({ caseRef, round }: { caseRef: string; round: number }) {
  const { onSubmit, pending } = useCaseAction(sendReminder);
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="remind-title" className="grid gap-4">
      <FormHeading id="remind-title">Remind the reporter</FormHeading>
      <p className="max-w-[var(--measure)]">
        The reporter gave an email address, so you can send them one reminder for this round (round {round}). AccessLoop
        never sends a second one: people are asked at most once, with one reminder.
      </p>
      <input type="hidden" name="ref" value={caseRef} />
      <div>
        <Button type="submit" variant="secondary" pending={pending} iconStart={<Icon icon={BellRing} />}>
          Send a reminder email
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ notes and interim accommodations (Phase 7 T2 item 4) */

const NOTE_IDS = { kind: "note-kind", note: "note-text" };

/**
 * "Add a note" (the lead, or the owner the case is assigned to): an internal note, or an interim accommodation, what
 * the person was offered while the barrier is being fixed. It goes into the append-only History, so it can't be
 * edited; the form empties after it is saved.
 */
export function NoteForm({ caseRef }: { caseRef: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errors } = useCaseAction(addNote, () => formRef.current?.reset());
  const e = errors?.fields ?? {};
  return (
    <form ref={formRef} onSubmit={onSubmit} method="post" noValidate aria-labelledby="note-title" className="grid gap-5">
      <FormHeading id="note-title">Add a note</FormHeading>
      <ErrorSummary errors={summaryItems(errors, NOTE_IDS)} focusKey={errors?.at} />
      <input type="hidden" name="ref" value={caseRef} />
      <RadioGroup
        id={NOTE_IDS.kind}
        name="kind"
        legend="What kind of note is it?"
        defaultValue="internal"
        error={e.kind}
        options={[
          {
            value: "internal",
            label: NOTE_KIND_LABELS.internal,
            hint: "For the team: what you checked, who you spoke to, what happens next.",
          },
          {
            value: "interim_accommodation",
            label: NOTE_KIND_LABELS.interim_accommodation,
            hint: "What the person was offered while the barrier is being fixed, for example help at the door or booking by phone.",
          },
        ]}
      />
      <TextareaField
        id={NOTE_IDS.note}
        name="note"
        label="Note"
        hint={
          <>
            For staff only: the reporter never sees it. It stays in the case history and can&rsquo;t be edited. Phone
            numbers and emails are taken out automatically, but names are not: don&rsquo;t write anyone&rsquo;s name. Up
            to {NOTE_MAX.toLocaleString("en-CA")} characters.
          </>
        }
        rows={3}
        required
        error={e.note}
      />
      <div>
        <Button type="submit" variant="secondary" pending={pending} iconStart={<Icon icon={NotebookPen} />}>
          Add note
        </Button>
      </div>
    </form>
  );
}
