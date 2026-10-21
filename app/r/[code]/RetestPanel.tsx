"use client";

// The changing part of /r/[code]: where the report is, the re-test question, and what happened after an answer.
// One client component owns the action state, so the result stays on screen while the page refreshes with the
// new status (the server action calls refresh()). Signature moment 1: on "Yes, it works now" the badge turns to
// "Fixed and confirmed by you" and the loop closes into one ring, once, with CSS motion that is off under
// prefers-reduced-motion. Focus and the status message never wait for it.
import { useActionState, useEffect, type ReactNode } from "react";
import { BellOff, Gift, PenLine, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextareaField } from "@/components/ui/Field";
import { Heading } from "@/components/ui/Heading";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { LoopTimeline, loopState } from "@/components/ui/Timeline";
import { reportPath } from "@/lib/intake/receipt-cookie";
import {
  RETEST_ANSWERS,
  RETEST_COMMENT_MAX,
  RETEST_IDLE,
  RETEST_QUESTION,
  canStopContact,
  retestFieldError,
  retestOutcome,
} from "@/lib/retest";
import type { CaseStatus } from "@/lib/status";
import { answerRetest } from "./actions";

interface RetestPanelProps {
  /** The formatted receipt code (XXXX-XXXX-XXXX-XXXX). The action re-resolves it; it is the only thing sent. */
  code?: string;
  /**
   * Instead of the code: a re-test email's one-round link (/r/t/{token}, app/r/t). Its action re-checks the token and
   * the round; it answers that round's question only, so "Stop contact" is not offered through it.
   */
  link?: { token: string; action: typeof answerRetest };
  orgSlug: string;
  status: CaseStatus;
  closedReason: string | null;
  wantsRetest: boolean;
  /** The org's re-test offer (e.g. a gift card), only while a re-test is open. Shown once. */
  offerText: string | null;
  /** "What the team changed", rendered on the server. */
  fixSection: ReactNode;
}

const ANSWER_GROUP = "retest-answer";
const COMMENT_FIELD = "retest-comment";

/** Like the report form's step card: a raised panel on wider screens, lying flat on the page on phones. */
const FLAT_ON_PHONES =
  "max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:shadow-none sm:p-[calc(var(--card-pad)*1.25)]";

export function RetestPanel({ code = "", link, orgSlug, status, closedReason, wantsRetest, offerText, fixSection }: RetestPanelProps) {
  const [state, formAction] = useActionState(link?.action ?? answerRetest, RETEST_IDLE);
  const announce = useAnnounce();
  const outcome = retestOutcome(state);
  const fieldError = retestFieldError(state);
  const answerError = fieldError?.field === "answer" ? fieldError.message : undefined;
  const commentError = fieldError?.field === "comment" ? fieldError.message : undefined;
  const answered = state.kind === "answered";
  // A link (/r/t) that stopped working while the page was open: its question can't be answered here any more.
  const linkEnded = state.kind === "problem" && state.problem === "link_ended";

  // Every result is said through the page's one status region, and shown on the page as well.
  useEffect(() => {
    if (state.kind === "idle") return;
    const message = retestOutcome(state)?.message ?? retestFieldError(state)?.message;
    if (message) announce(message);
  }, [state, announce]);

  // The verified moment plays only right after this person said it works, never on a later visit.
  const justVerified = answered && state.answer === "fixed" && status === "verified";
  const loop = loopState(status, "reporter");
  const showQuestion = status === "retest_open" && !answered && !linkEnded;
  const showStopContact = !link && canStopContact(status, wantsRetest) && !answered;

  return (
    <div className="grid gap-[var(--stack-lg)]">
      {/* The result comes first: focus lands here, and the status just below it is in view as it changes. */}
      {outcome ? (
        <section aria-labelledby="retest-outcome" className="grid gap-4">
          <Heading level={2} id="retest-outcome" focusOnMount focusKey={state.kind === "idle" ? undefined : state.at}>
            {outcome.title}
          </Heading>
          <Notice tone={outcome.tone}>{outcome.message}</Notice>
        </section>
      ) : null}

      {/* One raised panel per view: the question while it is open, otherwise where the report is. */}
      <Card
        as="section"
        id="report-progress"
        title="Where your report is now"
        titleLevel={2}
        tone={showQuestion ? "default" : "raised"}
        padding="lg"
      >
        <div className="grid gap-6">
          <p>
            {/* key: a new status mounts a new badge, so the arrival plays once (and never under reduced motion). */}
            <StatusBadge
              key={status}
              status={status}
              wording="reporter"
              closedReason={closedReason}
              size="lg"
              celebrate={justVerified}
              data-testid="report-status"
            />
          </p>
          {loop ? <LoopTimeline key={status} wording="reporter" {...loop} animateClose={justVerified} /> : null}
          <NextStep status={status} wantsRetest={wantsRetest} orgSlug={orgSlug} answered={answered || linkEnded} viaLink={Boolean(link)} />
        </div>
      </Card>

      {fixSection}

      {showQuestion ? (
        <Card tone="raised" padding="none" className={FLAT_ON_PHONES}>
          <form action={formAction} noValidate className="grid gap-[var(--stack)]">
            {link ? <input type="hidden" name="token" value={link.token} /> : <input type="hidden" name="code" value={code} />}
            <input type="hidden" name="source" value="question" />
            <ErrorSummary
              errors={
                fieldError
                  ? [{ href: fieldError.field === "answer" ? `#${ANSWER_GROUP}-0` : `#${COMMENT_FIELD}`, message: fieldError.message }]
                  : []
              }
              focusKey={state.kind === "problem" ? state.at : undefined}
            />
            <RadioGroup
              key={state.kind === "problem" ? `answer-${state.at}` : "answer"}
              id={ANSWER_GROUP}
              name="answer"
              legend={RETEST_QUESTION}
              legendHeading={{ level: 2 }}
              hint={
                <>
                  <p>The team says they made a fix. Only you can tell us if it works for you.</p>
                  {/* The offer follows the question it is about (it sat above the heading). As part of the group's
                      description it is read with the question; body size, like the answers. */}
                  {offerText ? (
                    <p className="mt-3 flex items-start gap-3 rounded-lg border border-transparent bg-accent-soft p-4 text-body font-bold text-accent-ink">
                      <Icon icon={Gift} className="mt-[0.2em]" />
                      <span>{offerText}</span>
                    </p>
                  ) : null}
                </>
              }
              error={answerError}
              options={RETEST_ANSWERS.map((a) => ({ value: a.value, label: a.label, hint: a.hint }))}
              defaultValue={state.kind === "problem" ? state.answer : undefined}
            />
            <TextareaField
              key={state.kind === "problem" ? state.at : "first"}
              id={COMMENT_FIELD}
              name="comment"
              label="Anything you want to add? (optional)"
              hint={`Please don't add your name or contact details. Up to ${RETEST_COMMENT_MAX.toLocaleString("en-CA")} characters.`}
              error={commentError}
              rows={4}
              defaultValue={state.kind === "problem" ? (state.comment ?? "") : ""}
            />
            <div className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
              <Button type="submit" size="lg" iconStart={<Icon icon={Send} />}>
                Send answer
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {showStopContact ? (
        <section aria-labelledby="stop-contact" className="grid gap-4">
          <h2 id="stop-contact" className="font-sans text-h3 font-bold tracking-normal">
            Changed your mind?
          </h2>
          <p className="max-w-[var(--measure)]">
            You said we could ask you to check the fix. If you don&rsquo;t want that any more, you can stop it here.{" "}
            {status === "fixed_unverified"
              ? "Your report stays as it is."
              : "The team will still work on your report."}
          </p>
          <form action={formAction}>
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="source" value="stop_contact" />
            <input type="hidden" name="answer" value="opt_out" />
            <Button type="submit" variant="secondary" iconStart={<Icon icon={BellOff} />}>
              Stop contact about this report
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

/** One plain sentence about what happens next, for every state except an open question (the form says it). */
function NextStep({
  status,
  wantsRetest,
  orgSlug,
  answered,
  viaLink,
}: {
  status: CaseStatus;
  wantsRetest: boolean;
  orgSlug: string;
  answered: boolean;
  /** Opened from a re-test email's link, which answers one round only: a later check comes with a new email. */
  viaLink: boolean;
}) {
  switch (status) {
    case "retest_open":
      return answered ? null : <p className="max-w-[var(--measure)]">The team made a fix. Please tell us below if it works for you.</p>;
    case "verified":
      // Right after the answer, the message above already says it.
      return answered ? null : <p className="max-w-[var(--measure)]">Thank you for checking the fix. This report is finished.</p>;
    case "closed":
      return <p className="max-w-[var(--measure)]">This report is closed. The team will not do more on it.</p>;
    case "fixed_unverified":
      return (
        <div className="grid justify-items-start gap-3">
          <p className="max-w-[var(--measure)]">
            The team made a fix. If it still doesn&rsquo;t work for you, you can tell them in a new report.
          </p>
          <ButtonLink href={reportPath(orgSlug)} variant="secondary" iconStart={<Icon icon={PenLine} />}>
            Report a barrier
          </ButtonLink>
        </div>
      );
    default:
      return (
        <p className="max-w-[var(--measure)]">
          {wantsRetest
            ? viaLink
              ? "If the team makes another fix and asks you to check it, we will email you a new link."
              : "When the team has made a fix, you can tell us here if it works for you."
            : "We won't ask you to check the fix. The team will still work on your report."}
        </p>
      );
  }
}
