"use client";

// "Hide a detail that was missed" (Phase 7 T2, the lead only, after the redaction was approved): the lead hides the
// exact words of a name or another detail the approval missed. The preview starts from what was approved (every
// detail it hides stays hidden: a revision can only hide more); "Save the corrected redaction" redacts the report,
// the summaries and the place detail again, and appends a NEW redaction_approved event (earlier records are never
// changed). Like the review, this region never shows a hidden value, and the words typed stay in memory only.
import { useEffect, useState, type FormEvent } from "react";
import { RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { Icon } from "@/components/ui/Icon";
import { RedactedText } from "@/components/ui/RedactedText";
import { PII_TYPE_LABELS, type AddedWords, type ReviewView } from "@/lib/cases/redaction-labels";
import { reviseRedaction } from "./actions";
import { useCaseAction } from "./CaseFeedback";
import { HideMoreWords } from "./RedactionReview";

const H3 = "al-subhead";

export function RedactionRevision({ caseRef, approvalSeq }: { caseRef: string; approvalSeq: number }) {
  const [review, setReview] = useState<ReviewView | null>(null);
  const [added, setAdded] = useState<AddedWords[]>([]);
  // A new round (after a save, or "Start again") remounts "Hide more words", so its last answer goes too.
  const [round, setRound] = useState(0);
  const reset = () => {
    setReview(null);
    setAdded([]);
    setRound((r) => r + 1);
  };
  const { submit, pending } = useCaseAction(reviseRedaction, reset);
  // "Start again" removes the button it was pressed on: focus goes to the words field instead of the page body.
  const [refocus, setRefocus] = useState(0);
  useEffect(() => {
    if (refocus) document.getElementById("hide-words")?.focus();
  }, [refocus]);
  const startAgain = () => {
    reset();
    setRefocus((n) => n + 1);
  };
  const onSave = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const data = new FormData();
    data.set("ref", caseRef);
    data.set("approvalSeq", String(approvalSeq));
    data.set("added", JSON.stringify(added));
    submit(data);
  };
  const items = review?.items.filter((i) => i.kind === "added") ?? [];

  return (
    <Disclosure summary="Hide a detail that was missed" variant="inline" panelClassName="max-w-none">
      <div className="grid gap-5">
        <p className="max-w-[var(--measure)] text-ink-muted">
          Staff already read this report. If a name or another detail that identifies someone was missed, hide it here:
          the report, its summary and the place detail are redacted again, and the history records the correction.
          Everything hidden now stays hidden. Earlier records in the history can&rsquo;t be changed.
        </p>
        <HideMoreWords
          key={`${approvalSeq}-${round}`}
          caseRef={caseRef}
          added={added}
          mode="revise"
          onPreview={(next, words) => {
            setReview(next);
            setAdded(words);
          }}
        />
        {review && items.length ? (
          <form onSubmit={onSave} method="post" aria-labelledby="revise-title" className="grid gap-4 border-t border-border pt-5">
            <h3 id="revise-title" className={H3}>
              The report with these words hidden
            </h3>
            <div className="rounded-md bg-surface-sunken p-4">
              <RedactedText text={review.text} />
            </div>
            <ul className="m-0 grid list-disc gap-1 pl-6">
              {items.map((i) => (
                <li key={i.key}>
                  {PII_TYPE_LABELS[i.type]}: {i.places === 1 ? "1 place" : `${i.places} places`}
                  {i.inReport ? "" : ", not in the report itself"}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" pending={pending} iconStart={<Icon icon={ShieldCheck} />}>
                Save the corrected redaction
              </Button>
              <Button type="button" variant="secondary" onClick={startAgain} iconStart={<Icon icon={RotateCcw} />}>
                Start again
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Disclosure>
  );
}
