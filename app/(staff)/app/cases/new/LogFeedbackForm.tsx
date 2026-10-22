"use client";

// The "Log feedback" form and its one-time confirmation. Accessible names here are the e2e contract
// (e2e/channels.spec.ts): "How did it arrive?", "Date received", "What they told us", "Where did it happen?",
// "Where exactly? (optional)", "Does the person want to stay anonymous?", "Email address (optional)",
// "Phone or mailing address (optional)", "Can we ask them to check the fix later?", "They asked us not to use AI on
// their report", "Log feedback". The server action checks everything again; this form only collects input.
//
// The receipt code lives ONLY in this component's memory, from the POST answer: never in a URL, a cookie or
// storage. It is forgotten when the person logs more feedback, leaves the page or the page is hidden (pagehide,
// bfcache, or a kept route under React Activity), so a reload or Back never shows it again.
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowRight, CircleCheck, ClipboardPlus, Inbox, Mail, PhoneCall } from "lucide-react";
import { ActionFeedbackProvider, fieldErrorItems, useFormAction } from "@/components/ui/ActionFeedback";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { CodeDisplay } from "@/components/ui/CodeDisplay";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextareaField, TextField } from "@/components/ui/Field";
import { Heading } from "@/components/ui/Heading";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { DETAIL_MAX, LOCATION_OPTIONS, TEXT_MAX } from "@/lib/intake/types";
import { CONTACT_MAX, READ_CODE_INSTRUCTION, STAFF_CHANNEL_OPTIONS, type LogFeedbackResult } from "@/lib/intake/staff-types";
import { logFeedback } from "./actions";

type Logged = Extract<LogFeedbackResult, { ok: true }>;

const IDS = {
  channel: "channel-0",
  receivedDate: "received-date",
  text: "feedback-text",
  locationKind: "where-0",
  locationDetail: "where-detail",
  anonymous: "anonymous-0",
  email: "reporter-email",
  contact: "reporter-contact",
  wantsRetest: "retest-0",
};

export function LogFeedbackForm({ today, earliest }: { today: string; earliest: string }) {
  const [logged, setLogged] = useState<Logged | null>(null);
  const [formKey, setFormKey] = useState(0);

  // Forget the code whenever this page stops being shown: leaving it (bfcache), or being kept hidden by a router
  // that preserves routes. flushSync, so the DOM no longer holds it when the browser takes its snapshot.
  useEffect(() => {
    const forget = () => flushSync(() => setLogged(null));
    window.addEventListener("pagehide", forget);
    return () => window.removeEventListener("pagehide", forget);
  }, []);
  useLayoutEffect(() => () => setLogged(null), []);

  const another = useCallback(() => {
    setLogged(null);
    setFormKey((k) => k + 1);
  }, []);

  return (
    <ActionFeedbackProvider testId="intake-result">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,48rem)_minmax(16rem,22rem)] lg:items-start lg:gap-10">
        <div className="min-w-0">
          {logged ? (
            <LoggedView result={logged} onAnother={another} />
          ) : (
            <IntakeForm key={formKey} today={today} earliest={earliest} focusFirst={formKey > 0} onLogged={setLogged} />
          )}
        </div>
        <NextSteps />
      </div>
    </ActionFeedbackProvider>
  );
}

/** The loop this feedback joins, beside the form (below it on small screens). */
function NextSteps() {
  const steps: [string, string][] = [
    [
      "A receipt code is made",
      "With an email address, AccessLoop emails it to the person. Without one, you read it to them once. It is never stored.",
    ],
    [
      "You acknowledge it the same way it came",
      "Unless it is anonymous (ACR s.9(4)). The case page has the email button, or a date to record a call, a letter or a visit.",
    ],
    [
      "You check the redaction",
      "Names and contact details are hidden first. Nobody else reads the feedback until you approve.",
    ],
    [
      "The loop runs as usual",
      "Triage, assign, fix. If they agreed, the person tells you if the fix works, with their code.",
    ],
  ];
  return (
    <Card as="section" id="intake-steps" title="What happens next" tone="inset">
      <ol className="m-0 grid list-decimal gap-4 pl-6 marker:font-bold marker:text-ink-muted">
        {steps.map(([title, text]) => (
          <li key={title} className="pl-1">
            <span className="block font-bold">{title}</span>
            <span className="block text-small text-ink-muted">{text}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function IntakeForm({
  today,
  earliest,
  focusFirst,
  onLogged,
}: {
  today: string;
  earliest: string;
  focusFirst: boolean;
  onLogged: (r: Logged) => void;
}) {
  const onSuccess = useCallback(
    (r: LogFeedbackResult) => {
      if (r.ok) onLogged(r);
    },
    [onLogged],
  );
  // "Log more feedback": a fresh form, with focus back on the page's heading.
  useEffect(() => {
    if (focusFirst) document.querySelector<HTMLElement>("main h1")?.focus();
  }, [focusFirst]);
  const { onSubmit, pending, errors } = useFormAction(logFeedback, { onSuccess, quietSuccess: true });
  const e = errors?.fields ?? {};

  return (
    <form onSubmit={onSubmit} method="post" noValidate className="grid gap-8">
      <ErrorSummary errors={fieldErrorItems(errors, IDS)} focusKey={errors?.at} />

      <Card as="section" id="how" title="How it reached you" tone="raised">
        <div className="grid gap-6">
          <RadioGroup
            id="channel"
            name="channel"
            legend="How did it arrive?"
            hint="ACR s.9(3): people can give feedback by mail, phone, email and any other way you talk with the public."
            options={STAFF_CHANNEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            layout="grid"
            error={e.channel}
          />
          <TextField
            id="received-date"
            name="receivedDate"
            type="date"
            label="Date received"
            hint="The day it reached your organization. It can't be in the future. It starts the 7 years you keep it (ACR s.19)."
            defaultValue={today}
            max={today}
            min={earliest}
            required
            inputWidth="medium"
            error={e.receivedDate}
          />
        </div>
      </Card>

      <Card as="section" id="what" title="The barrier">
        <div className="grid gap-6">
          <TextareaField
            id="feedback-text"
            name="text"
            label="What they told us"
            hint={`Write it as you received it: paste the email or letter, or write down what the person said. Names and contact details are hidden before anyone else reads it. Up to ${TEXT_MAX.toLocaleString("en-CA")} characters.`}
            rows={8}
            required
            spellCheck
            error={e.text}
          />
          <RadioGroup
            id="where"
            name="locationKind"
            legend="Where did it happen?"
            options={LOCATION_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))}
            error={e.locationKind}
          />
          <TextField
            id="where-detail"
            name="locationDetail"
            label="Where exactly? (optional)"
            hint={`For example, the name of the page, the street or the branch. Up to ${DETAIL_MAX} characters.`}
            autoComplete="off"
            error={e.locationDetail}
          />
        </div>
      </Card>

      <Card as="section" id="person" title="The person who gave it">
        <div className="grid gap-6">
          <RadioGroup
            id="anonymous"
            name="anonymous"
            legend="Does the person want to stay anonymous?"
            hint="ACR s.9(2): people can always give feedback anonymously. Anonymous feedback needs no acknowledgement."
            error={e.anonymous}
            options={[
              { value: "yes", label: "Yes" },
              {
                value: "no",
                label: "No",
                conditional: (
                  <div className="grid gap-5">
                    <TextField
                      id="reporter-email"
                      name="email"
                      type="email"
                      label="Email address (optional)"
                      hint="AccessLoop emails them their receipt code. Only the lead can see the address. It is never shown in reports."
                      autoComplete="off"
                      spellCheck={false}
                      inputWidth="medium"
                      error={e.email}
                    />
                    <TextareaField
                      id="reporter-contact"
                      name="contact"
                      label="Phone or mailing address (optional)"
                      hint={`Stored encrypted. Only the lead can see it, next to the original. Up to ${CONTACT_MAX} characters.`}
                      rows={2}
                      autoComplete="off"
                      error={e.contact}
                    />
                  </div>
                ),
              },
            ]}
          />
          <RadioGroup
            id="retest"
            name="wantsRetest"
            legend="Can we ask them to check the fix later?"
            hint="When a fix is ready, they tell us if it works for them, with their receipt code."
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            layout="inline"
            error={e.wantsRetest}
          />
          <Checkbox
            id="ai-opt-out"
            name="aiOptOut"
            label="They asked us not to use AI on their report"
            hint="Then no AI tool reads it: you sort it and check it for names yourself."
          />
        </div>
      </Card>

      <Notice tone="info" title="The receipt code">
        AccessLoop makes a receipt code for this feedback. If you add an email address, it emails the code to the
        person and you never see it. Without one, the code is shown to you once, to read or give to them.
      </Notice>

      <div>
        <Button type="submit" size="lg" pending={pending} iconStart={<Icon icon={ClipboardPlus} />}>
          Log feedback
        </Button>
      </div>
    </form>
  );
}

function LoggedView({ result, onAnother }: { result: Logged; onAnother: () => void }) {
  const announce = useAnnounce();
  useEffect(() => {
    announce(result.message);
  }, [announce, result.message]);

  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-3">
        <span className="mt-[0.2em] text-success">
          <Icon icon={CircleCheck} size="1.75em" />
        </span>
        <Heading level={2} id="logged-title" focusOnMount>
          Feedback logged as {result.ref}
        </Heading>
      </div>
      <p>
        Reference: <strong data-testid="case-ref" className="font-mono tracking-[0.04em]">{result.ref}</strong>
        <span className="block text-small text-ink-muted">The reference is not secret. The person can quote it when they get in touch.</span>
      </p>

      {result.code ? (
        <div className="grid gap-4">
          <CodeDisplay code={result.code} label={READ_CODE_INSTRUCTION} data-testid="receipt-code" />
          <div className="grid max-w-[var(--measure)] gap-2">
            <p className="flex items-start gap-2">
              <Icon icon={PhoneCall} className="mt-[0.25em] text-ink-muted" />
              <span>
                Tell them to keep it. It is the only way they can check their report on the Check your report page, or
                tell us if a fix works. AccessLoop keeps only a fingerprint of it, so nobody can show it again.
              </span>
            </p>
            <p className="text-small text-ink-muted">
              Because you saw this code, the reporter&rsquo;s later answers are counted apart in your progress report
              (confirmed by the reporter, code given by staff).
            </p>
          </div>
        </div>
      ) : (
        <Notice tone="success" title="The receipt code was emailed to the person">
          It is not shown here and it is not stored.
          {result.emailSimulated ? (
            <>
              {" "}
              Email is simulated in this prototype, so nothing left this computer:{" "}
              <Link href="/app/outbox">the Outbox</Link> shows the email that would have been sent.
            </>
          ) : null}
        </Notice>
      )}

      {result.needsAck ? (
        <Card title="Next: acknowledge it" titleLevel={3} tone="inset">
          <p className="flex max-w-[var(--measure)] items-start gap-2">
            <Icon icon={Mail} className="mt-[0.25em] text-ink-muted" />
            <span>
              ACR s.9(4) asks you to acknowledge feedback in the same way it arrived. Open the case to send or record the
              acknowledgement, then check the redaction.
            </span>
          </p>
        </Card>
      ) : (
        <p className="max-w-[var(--measure)]">
          Anonymous feedback needs no acknowledgement. Open the case to check the redaction.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <ButtonLink href={`/app/cases/${result.ref}`} iconEnd={<Icon icon={ArrowRight} />}>
          {`Open case ${result.ref}`}
        </ButtonLink>
        <Button variant="secondary" onClick={onAnother} iconStart={<Icon icon={ClipboardPlus} />}>
          Log more feedback
        </Button>
        <ButtonLink href="/app/inbox" variant="quiet" iconStart={<Icon icon={Inbox} />}>
          Go to the inbox
        </ButtonLink>
      </div>
    </div>
  );
}
