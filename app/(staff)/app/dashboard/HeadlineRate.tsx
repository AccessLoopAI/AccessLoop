import Link from "next/link";
import type { ReactNode } from "react";
import { Disclosure } from "@/components/ui/Disclosure";
import { ProgressRing } from "@/components/ui/LoopRing";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import { inboxHref, percentLabel, type CaseSet, type VerifiedFixRate } from "@/lib/metrics";

/**
 * One part of the headline's denominator: a key that matches the ring (top-level parts only), the count, and the
 * link to its cases. `children` are the parts it is made of, as a nested list under it.
 */
function Part({
  set,
  label,
  tone,
  children,
}: {
  set: CaseSet;
  label: string;
  tone?: "arc" | "track" | "apart";
  children?: ReactNode;
}) {
  const text = (
    <>
      <span className="font-bold">{set.count}</span> {label}
    </>
  );
  return (
    <li>
      <span className="flex items-center gap-2.5">
        {tone ? <span aria-hidden="true" className="al-key shrink-0" data-tone={tone} /> : null}
        {set.count > 0 ? (
          <Link href={inboxHref(set.filter)} className="inline-flex min-h-11 items-center">
            <span>{text}</span>
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center text-ink-muted">
            <span>{text}</span>
          </span>
        )}
      </span>
      {children ? <ul className="m-0 grid list-none gap-0 p-0 ps-6">{children}</ul> : null}
    </li>
  );
}

/**
 * The dashboard's headline (domain §10): the verified-fix rate as the closing ring, the counts next to it, and the
 * cases behind every part. The denominator is every case with a logged fix (Phase 7 D6), so a fix still waiting for
 * the reporter, sent back, reopened or closed afterwards counts as not verified. Staff-relayed verifications are
 * shown apart (domain §3): in the denominator, never the numerator. The ring draws once on load (nothing moves under
 * reduced motion); the percent is real text.
 */
export function HeadlineRate({ rate }: { rate: VerifiedFixRate }) {
  const pct = percentLabel(rate.rate);
  const logged = rate.fixLogged.count;
  return (
    <div
      data-testid="tile-verified-fix-rate"
      data-closed={logged > 0 && rate.verified.count >= logged ? "" : undefined}
      className="al-card al-headline relative flex h-full min-w-0 flex-col justify-between gap-5 rounded-lg border border-border bg-surface-raised p-6 shadow-2 sm:p-7"
    >
      {/* Phones: the heading, then the ring beside the count, then the sentence and the parts at full width. From sm
          the ring takes the left column and everything else stacks beside it. DOM order = reading order. */}
      <div className="grid flex-1 grid-cols-[auto_minmax(0,1fr)] content-center items-center gap-x-5 gap-y-3 sm:gap-x-8">
        <h2 className="col-span-2 font-sans text-small font-bold tracking-normal text-ink-muted sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:self-end">
          Verified-fix rate
        </h2>
        <div className="relative col-start-1 row-start-2 grid size-[6.5rem] shrink-0 place-items-center sm:row-span-4 sm:row-start-1 sm:size-[11rem] xl:size-[12.5rem]">
          <ProgressRing value={rate.verified.count} max={logged} size="100%" strokeWidth={3.6} animate hollow className="absolute inset-0" />
          <p className="relative grid justify-items-center text-center leading-none">
            <span data-testid="verified-fix-percent" className="font-display text-[1.75rem] font-semibold text-ink sm:text-[2.875rem]">
              {pct ?? "–"}
            </span>
            {pct ? null : <span className="mt-1 text-small font-bold text-ink-muted">No data yet</span>}
          </p>
        </div>
        {logged > 0 ? (
          <>
            <p data-testid="verified-fix-value" className="col-start-2 row-start-2 font-display text-stat font-semibold text-ink">
              {rate.verified.count} of {logged}
            </p>
            <p className="col-span-2 max-w-[34ch] text-lead text-ink sm:col-span-1 sm:col-start-2 sm:row-start-3">
              logged fixes were confirmed by the person who reported them.
            </p>
          </>
        ) : (
          <p data-testid="verified-fix-value" className="col-start-2 row-start-2 max-w-[40ch] text-lead text-ink sm:row-span-2">
            No fix has been logged for feedback received in this period yet. When one is, and its reporter confirms
            it, the loop closes here.
          </p>
        )}
        <ul className="col-span-2 m-0 grid list-none gap-0 self-start p-0 text-small sm:col-span-1 sm:col-start-2 sm:row-start-4">
          <Part set={rate.verified} label="verified by the reporter" tone="arc" />
          <Part set={rate.notVerified} label="not verified by the reporter" tone="track">
            <Part set={rate.waiting} label="waiting for the reporter to check" />
            <Part set={rate.fixedUnverified} label="fixed, not confirmed by the reporter" />
            {rate.backInProgress.count > 0 ? <Part set={rate.backInProgress} label="sent back or reopened after a fix" /> : null}
            {rate.closedAfterFix.count > 0 ? <Part set={rate.closedAfterFix} label="closed after a fix" /> : null}
          </Part>
          <Part set={rate.verifiedStaffRelayed} label="confirmed with a code staff passed on (counted apart)" tone="apart" />
        </ul>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border pt-3">
        <Disclosure
          summary={
            <>
              What is this?<VisuallyHidden> (Verified-fix rate)</VisuallyHidden>
            </>
          }
          className="text-small"
          panelClassName="text-small text-ink"
        >
          <p>
            Of the barriers with a fix logged, the share the person who reported them confirmed with &ldquo;Yes, it works
            now&rdquo;. Every logged fix counts, whatever happened next: one still waiting for the reporter, one they
            could not check or did not answer, and one sent back, reopened or closed afterwards all count as not
            verified, so closing a fixed case never raises the rate. Only the person who reported a barrier can confirm
            it, with their receipt code. When staff passed the code on (phone, mail or in person intake), a confirmation
            still counts in the total here but not as verified, so the rate can only be understated.
          </p>
        </Disclosure>
        {logged > 0 ? (
          <Link href={inboxHref(rate.fixLogged.filter)} className="inline-flex min-h-11 items-center text-small font-bold">
            <span>
              See all {logged} logged fixes<VisuallyHidden> for Verified-fix rate</VisuallyHidden>
            </span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
