"use client";

// "Show original" (lead only, any status; docs/domain.md §5): the server action records a private_revealed event
// first, then returns the decrypted text. It lives only in this component's state: never in the URL, a cache,
// storage or the server-rendered page. "Hide original" forgets it, and so does the page being hidden (pagehide, so a
// bfcache snapshot never holds it and Back never re-shows it without a new private_revealed record; or a route kept
// hidden by React Activity). Owners and auditors never get this component.
import { useEffect, useLayoutEffect, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { actionFailureMessage } from "@/lib/auth/signed-out";
import { REFUSED } from "@/lib/cases/action-result";
import { revealOriginal } from "./actions";

interface Shown {
  text: string;
  email: string | null;
  contact: string | null;
}

export function OriginalReport({ caseRef }: { caseRef: string }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useAnnounce();

  // Forget the text whenever this page stops being shown. flushSync, so the DOM no longer holds it when the
  // browser takes its back/forward-cache snapshot (the same guard as the receipt code in LogFeedbackForm).
  useEffect(() => {
    const forget = () => flushSync(() => setShown(null));
    window.addEventListener("pagehide", forget);
    return () => window.removeEventListener("pagehide", forget);
  }, []);
  useLayoutEffect(() => () => setShown(null), []);

  const show = () => {
    if (pending) return;
    const data = new FormData();
    data.set("ref", caseRef);
    start(async () => {
      let r;
      try {
        r = await revealOriginal(data);
      } catch (err) {
        r = { ok: false as const, message: actionFailureMessage(err, REFUSED.failed), at: Date.now() };
      }
      if (!r) return;
      if (r.ok) {
        setError(null);
        setShown({ text: r.text, email: r.email, contact: r.contact });
      } else {
        setError(r.message);
      }
      announce(r.message);
    });
  };

  const hide = () => {
    setShown(null);
    announce("The original report is hidden again.");
    requestAnimationFrame(() => document.getElementById("show-original")?.focus());
  };

  if (shown) {
    return (
      <section
        id="original-report"
        aria-labelledby="original-report-title"
        className="al-card grid min-w-0 gap-4 rounded-lg border-2 border-warning-border bg-surface p-[var(--card-pad)]"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Heading level={2} id="original-report-title" focusOnMount className="font-sans text-card-title font-bold tracking-normal">
            Original report
          </Heading>
          <Button variant="secondary" onClick={hide} iconStart={<Icon icon={EyeOff} />}>
            Hide original
          </Button>
        </div>
        <Notice tone="warning">
          Only leads can see this. Your view is recorded in the history. Don&rsquo;t copy it into notes, tickets or the
          public summary.
        </Notice>
        <p className="max-w-[var(--measure)] whitespace-pre-wrap wrap-anywhere rounded-md bg-surface-sunken p-4">{shown.text}</p>
        {shown.email || shown.contact ? (
          <dl className="m-0 grid gap-3">
            {shown.email ? (
              <div className="grid gap-0.5">
                <dt className="text-small font-bold text-ink-muted">Reporter&rsquo;s email</dt>
                <dd className="m-0 wrap-anywhere">{shown.email}</dd>
              </div>
            ) : null}
            {shown.contact ? (
              <div className="grid gap-0.5">
                <dt className="text-small font-bold text-ink-muted">Reporter&rsquo;s contact details</dt>
                <dd className="m-0 whitespace-pre-wrap wrap-anywhere">{shown.contact}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-dashed border-border-strong bg-surface p-4">
      <p className="flex max-w-[var(--measure)] items-start gap-3 text-small text-ink-muted">
        <Icon icon={LockKeyhole} className="mt-[0.15em] text-ink" />
        <span>
          The original words, with names and contact details, are stored encrypted. Only leads can show them, and every
          view is recorded in the history.
        </span>
      </p>
      <Button id="show-original" variant="secondary" onClick={show} pending={pending} iconStart={<Icon icon={Eye} />}>
        Show original
      </Button>
      {error ? (
        <p className="w-full font-bold text-danger">{error}</p>
      ) : null}
    </div>
  );
}
