"use client";

// Layer 3 of the redaction (docs/domain.md §5): the lead checks what was hidden, keeps or removes each hidden
// detail, hides more words, then approves. This region NEVER shows a hidden value: every text in it is the
// report with all proposed spans and all added words hidden (whether "Keep hidden" is ticked or not), and the
// words the lead typed stay in this component's memory only. The server re-derives the final spans from the
// stored proposal (by index) and the exact words, so nothing here is trusted.
import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { EyeOff, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { RedactedText } from "@/components/ui/RedactedText";
import { SelectField } from "@/components/ui/Select";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { actionFailureMessage } from "@/lib/auth/signed-out";
import { REFUSED, type FieldErrors } from "@/lib/cases/action-result";
import {
  HIDE_WORDS_MAX,
  PII_TYPES,
  PII_TYPE_LABELS,
  PII_TYPE_WORDS,
  SPAN_SOURCE_LABELS,
  type AddedWords,
  type ReviewItem,
  type ReviewView,
} from "@/lib/cases/redaction-labels";
import { approveRedaction, previewHiddenWords } from "./actions";
import { summaryItems, useCaseAction } from "./CaseFeedback";

interface RedactionReviewProps {
  caseRef: string;
  proposalSeq: number;
  initial: ReviewView;
  /** Why a person must look for names by hand, or null. */
  manualReason: string | null;
  /** The label of the summary block ("AI summary, confirmed by the reporter"), when there is a summary. */
  summaryLabel: string | null;
  summaryNote: string | null;
  /** Label of the AI summary block when the reporter did not use it, else null. */
  aiSummaryLabel: string | null;
}

const H3 = "al-subhead"; // the design system's sub-heading (app/globals.css)
const HIDE_IDS = { words: "hide-words", type: "hide-type" };

export function RedactionReview({
  caseRef,
  proposalSeq,
  initial,
  manualReason,
  summaryLabel,
  summaryNote,
  aiSummaryLabel,
}: RedactionReviewProps) {
  const [review, setReview] = useState(initial);
  const [added, setAdded] = useState<AddedWords[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const keptCount = review.items.filter((i) => !removed.has(i.key)).length;

  const { submit: approve, pending: approving } = useCaseAction(approveRedaction);
  const onApprove = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (approving) return;
    const data = new FormData();
    data.set("ref", caseRef);
    data.set("proposalSeq", String(proposalSeq));
    for (const item of review.items) {
      if (item.kind === "proposed" && !removed.has(item.key)) data.append("keep", String(item.index));
    }
    data.set("added", JSON.stringify(added.filter((_, i) => !removed.has(`a:${i}`))));
    approve(data);
  };

  const toggle = (key: string, keep: boolean) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      if (keep) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section
      id="redaction-review"
      aria-labelledby="redaction-review-title"
      className="al-card grid min-w-0 gap-6 rounded-lg border border-border bg-surface-raised p-[var(--card-pad)] shadow-2"
    >
      <div className="grid gap-2">
        <h2 id="redaction-review-title" className="font-sans text-card-title font-bold tracking-normal">
          Redaction review
        </h2>
        <p className="max-w-[var(--measure)] text-ink-muted">
          Check that nobody can be identified from this report. Owners and auditors read it only after you approve it.
        </p>
      </div>

      {manualReason ? (
        <Notice tone="warning" title="Check the redaction by hand">
          {manualReason}
        </Notice>
      ) : null}

      {/* The text panels fill the card like the "Hidden details" rows and "Hide more words" under them (capped at the
          measure, they left a ragged right edge); only the words inside keep the reading measure. */}
      <div className="grid gap-4">
        <div className="grid gap-2">
          <h3 className={H3}>The report</h3>
          <div className="rounded-md bg-surface-sunken p-4">
            <RedactedText text={review.text} />
          </div>
        </div>
        {review.summary !== null && summaryLabel ? (
          <div className="grid gap-2">
            <h3 className={H3}>{summaryLabel}</h3>
            <div className="rounded-md bg-surface-sunken p-4">
              <RedactedText text={review.summary} />
            </div>
            {summaryNote ? <p className="max-w-[var(--measure)] text-small text-ink-muted">{summaryNote}</p> : null}
          </div>
        ) : null}
        {review.aiSummary !== null && aiSummaryLabel ? (
          <div className="grid gap-2">
            <h3 className={H3}>{aiSummaryLabel}</h3>
            <div className="rounded-md bg-surface-sunken p-4">
              <RedactedText text={review.aiSummary} />
            </div>
          </div>
        ) : null}
        {review.locationDetail ? (
          <div className="grid gap-2">
            <h3 className={H3}>Where exactly</h3>
            <div className="rounded-md bg-surface-sunken p-4">
              <RedactedText text={review.locationDetail} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3">
        <h3 className={H3}>
          Hidden details <span className="font-normal text-ink-muted">({review.items.length})</span>
        </h3>
        {review.items.length === 0 ? (
          <p className="max-w-[var(--measure)] text-ink-muted">
            Nothing was hidden automatically. Read the report for names and other details, and hide them below.
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {review.items.map((item, n) => (
              <HiddenItem key={item.key} item={item} n={n + 1} kept={!removed.has(item.key)} onKeep={(keep) => toggle(item.key, keep)} />
            ))}
          </ul>
        )}
      </div>

      <HideMoreWords
        caseRef={caseRef}
        added={added}
        onPreview={(next, words) => {
          setReview(next);
          setAdded(words);
        }}
      />

      <form onSubmit={onApprove} method="post" className="grid gap-3 border-t border-border pt-5">
        <p className="max-w-[var(--measure)]">
          {keptCount === review.items.length
            ? `All ${review.items.length === 1 ? "1 detail stays" : `${review.items.length} details stay`} hidden.`
            : `${keptCount} of ${review.items.length} details stay hidden. Unticked details will be shown to staff.`}{" "}
          After you approve, the case can be triaged and assigned.
        </p>
        <div>
          <Button type="submit" pending={approving} iconStart={<Icon icon={ShieldCheck} />}>
            Approve redaction
          </Button>
        </div>
      </form>
    </section>
  );
}

function HiddenItem({ item, n, kept, onKeep }: { item: ReviewItem; n: number; kept: boolean; onKeep: (keep: boolean) => void }) {
  const id = `keep-${item.key.replace(":", "-")}`;
  return (
    <li
      className="grid gap-3 rounded-md border border-border bg-surface p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-x-6"
      data-kept={kept || undefined}
    >
      <div className="grid min-w-0 gap-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-bold">
            {n}. {PII_TYPE_LABELS[item.type]}
          </span>
          <span className="text-small text-ink-muted">{SPAN_SOURCE_LABELS[item.source]}</span>
          {item.kind === "added" ? (
            <span className="text-small text-ink-muted">
              {item.places === 1 ? "1 place" : `${item.places} places`}
              {item.inReport ? "" : ", not in the report itself"}
            </span>
          ) : null}
        </p>
        {item.inReport ? (
          <p className="max-w-[var(--measure)] text-small">
            <VisuallyHidden>In context: </VisuallyHidden>
            <RedactedText as="span" text={item.before} />
            <mark className="al-redact mx-0.5 font-bold outline-2 outline-offset-1 outline-[color:var(--redact-border)]">
              {item.token}
            </mark>
            <RedactedText as="span" text={item.after} />
          </p>
        ) : null}
        {!kept ? (
          <p className="flex items-start gap-2 text-small font-bold">
            <Icon icon={TriangleAlert} className="mt-[0.15em] text-warning" />
            <span>After approval, staff will see what this hides.</span>
          </p>
        ) : null}
      </div>
      <Checkbox
        id={id}
        name="keep"
        label={
          <>
            Keep hidden
            <VisuallyHidden>{` (detail ${n}, ${PII_TYPE_WORDS[item.type]})`}</VisuallyHidden>
          </>
        }
        checked={kept}
        onChange={(e) => onKeep(e.currentTarget.checked)}
        className="md:min-w-[11rem]"
      />
    </li>
  );
}

/**
 * "Hide more words": previews the review with the exact words hidden (nothing is saved). `mode="revise"` (Phase 7 T2):
 * after the approval, the preview starts from what was approved, and saving is "Save the corrected redaction".
 */
export function HideMoreWords({
  caseRef,
  added,
  onPreview,
  mode = "review",
}: {
  caseRef: string;
  added: AddedWords[];
  onPreview: (review: ReviewView, added: AddedWords[]) => void;
  mode?: "review" | "revise";
}) {
  const [words, setWords] = useState("");
  const [errors, setErrors] = useState<{ fields: FieldErrors; at: number } | null>(null);
  const [done, setDone] = useState<{ message: string; tone: "success" | "danger"; at: number } | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();
  const doneRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (pending) return;
      const data = new FormData(e.currentTarget);
      data.set("ref", caseRef);
      data.set("added", JSON.stringify(added));
      if (mode === "revise") data.set("mode", "revise");
      start(async () => {
        let r;
        try {
          r = await previewHiddenWords(data);
        } catch (err) {
          r = { ok: false as const, message: actionFailureMessage(err, REFUSED.failed), at: Date.now() };
        }
        if (!r) return;
        if (r.ok) {
          setErrors(null);
          onPreview(r.review, r.added);
          setWords("");
          setDone({ message: r.message, tone: "success", at: r.at });
          announce(r.message);
        } else if (r.fieldErrors) {
          setDone(null);
          setErrors({ fields: r.fieldErrors, at: r.at });
        } else {
          setErrors(null);
          setDone({ message: r.message, tone: "danger", at: r.at });
          announce(r.message);
        }
      });
    },
    [added, announce, caseRef, mode, onPreview, pending],
  );

  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate aria-labelledby="hide-more-title" className="grid gap-4 rounded-md bg-surface-sunken p-4 sm:p-5">
      <div className="grid gap-1">
        <h3 id="hide-more-title" className={H3}>
          Hide more words
        </h3>
        <p className="max-w-[var(--measure)] text-small text-ink-muted">
          Use &ldquo;Show original&rdquo; to read what the reporter wrote, then copy the words exactly. Every place they
          appear is hidden. Nothing is saved until you {mode === "revise" ? "save the corrected redaction" : "approve"}.
        </p>
      </div>
      <ErrorSummary errors={summaryItems(errors, HIDE_IDS)} focusKey={errors?.at} />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] md:items-start">
        <TextField
          id={HIDE_IDS.words}
          name="words"
          label="Exact words to hide"
          autoComplete="off"
          spellCheck={false}
          maxLength={HIDE_WORDS_MAX}
          value={words}
          onChange={(ev) => setWords(ev.currentTarget.value)}
          error={e.words}
          required
        />
        <SelectField id={HIDE_IDS.type} name="type" label="Kind of detail" defaultValue="PERSON" error={e.type} required
          options={PII_TYPES.map((t) => ({ value: t, label: PII_TYPE_LABELS[t] }))} />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="secondary" pending={pending} iconStart={<Icon icon={EyeOff} />}>
          Hide these words
        </Button>
      </div>
      {done ? (
        <p ref={doneRef} tabIndex={-1} className={done.tone === "success" ? "font-bold text-success" : "font-bold text-danger"}>
          {done.message}
        </p>
      ) : null}
    </form>
  );
}
