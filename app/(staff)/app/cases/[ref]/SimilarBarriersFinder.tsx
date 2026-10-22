"use client";

// The lead's "Find similar past barriers" button and its answer (docs/domain.md §6.2). The AI runs only when the
// lead asks (never on page load: every view would cost a model call, and claude-cli takes seconds). The answer stays
// in this component: its heading (or the "not available" line) takes focus and the count is announced through the
// page's one StatusRegion. Only counts are announced, never AI text. Nothing here changes the case.
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { RedactedText } from "@/components/ui/RedactedText";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { actionFailureMessage } from "@/lib/auth/signed-out";
import { CLOSED_REASON_STAFF_LABELS } from "@/lib/cases/labels";
import type { SimilarFindResult } from "@/lib/cases/similar";
import { findSimilarBarriers } from "./similar-actions";

const FAILED = "That didn't work just now. Nothing was changed. Please try again.";

export function SimilarBarriersFinder({ caseRef, intro }: { caseRef: string; intro: string }) {
  const [result, setResult] = useState<SimilarFindResult | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  const find = () => {
    if (pending) return;
    const data = new FormData();
    data.set("ref", caseRef);
    announce("Looking for similar past barriers.");
    start(async () => {
      let r: SimilarFindResult;
      try {
        r = await findSimilarBarriers(data);
      } catch (err) {
        r = { ok: false, message: actionFailureMessage(err, FAILED), at: Date.now() };
      }
      setResult(r);
      announce(r.message);
    });
  };

  return (
    <div className="grid gap-4">
      <p className="max-w-[var(--measure)]">{intro}</p>
      <div>
        <Button variant="secondary" onClick={find} pending={pending} iconStart={<Icon icon={ScanSearch} />}>
          Find similar past barriers
        </Button>
      </div>
      {result ? <Answer r={result} /> : null}
    </div>
  );
}

function Answer({ r }: { r: SimilarFindResult }) {
  const failed = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!r.ok) failed.current?.focus();
  }, [r]);

  if (!r.ok) {
    return (
      <div ref={failed} tabIndex={-1} data-testid="similar-result" className="rounded-lg">
        <Notice tone="warning">{r.message}</Notice>
      </div>
    );
  }
  if (r.kind === "none") {
    return (
      <div data-testid="similar-result" className="grid gap-2 border-t border-border pt-4">
        <Heading level={3} focusOnMount focusKey={r.at} className="text-body font-bold">
          {r.checked === 0 ? "Nothing to compare" : "AI suggestion: no past case looks like the same barrier"}
        </Heading>
        <p className="max-w-[var(--measure)]">{r.message}</p>
        {r.aiWords ? <p className="text-small text-ink-muted">Checked by {r.aiWords}, from the public summaries only.</p> : null}
      </div>
    );
  }
  const n = r.matches.length;
  return (
    <div data-testid="similar-result" className="grid gap-3 border-t border-border pt-4">
      <Heading level={3} focusOnMount focusKey={r.at} className="text-body font-bold">
        {`AI suggestion: ${n === 1 ? "1 past case may be" : `${n} past cases may be`} the same barrier`}
      </Heading>
      <ol className="m-0 grid gap-3 p-0">
        {r.matches.map((m) => (
          <li key={m.ref} className="grid min-w-0 gap-2 rounded-md border border-border bg-surface-raised p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/app/cases/${m.ref}`} className="inline-flex min-h-11 items-center font-mono font-bold">
                {m.ref}
              </Link>
              <StatusBadge status={m.status} />
              <span className="text-small text-ink-muted">
                Received <time dateTime={m.receivedAt}>{m.receivedLabel}</time>
                {m.status === "closed" && m.closedReason ? `. ${CLOSED_REASON_STAFF_LABELS[m.closedReason]}` : null}
              </span>
            </div>
            <RedactedText text={m.publicSummary} />
            <p className="text-small wrap-anywhere">
              <span className="font-bold">Why it may be the same: </span>
              {m.reason}
            </p>
          </li>
        ))}
      </ol>
      <p className="max-w-[var(--measure)] text-small text-ink-muted">
        Suggested by {r.aiWords}, from the public summaries of {r.checked === 1 ? "1 case" : `${r.checked} cases`} with the
        same area and place. Check each one yourself: nothing was merged, linked or closed. If one is the same barrier,
        you decide what happens next, for example closing this case as a duplicate.
      </p>
    </div>
  );
}
