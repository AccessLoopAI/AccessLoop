import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Icon } from "@/components/ui/Icon";
import { VisuallyHidden } from "@/components/ui/VisuallyHidden";
import {
  ATTENTION_REASONS,
  attentionReasonLabel,
  attentionWaitLabel,
  countLabel,
  inboxHref,
  type NeedsAttention as NeedsAttentionData,
} from "@/lib/metrics";

/** How many cases each reason lists before "See all": the oldest first. */
const PER_REASON = 3;
/** ...or 2 when three or more reasons share the card, so it stays beside the headline instead of towering over it. */
const PER_REASON_CROWDED = 2;

/**
 * "Needs attention" (domain §10 item 4): work waiting on the team NOW, whatever the period. One group per reason
 * that has cases, the longest waiting first, each row linking to its case; "See all" opens the inbox filtered to
 * exactly that reason's cases.
 */
export function NeedsAttention({ data }: { data: NeedsAttentionData }) {
  const groups = ATTENTION_REASONS.map((reason) => ({
    reason,
    set: data.byReason[reason],
    items: data.items.filter((i) => i.reason === reason),
  })).filter((g) => g.set.count > 0);
  const shown = groups.length >= 3 ? PER_REASON_CROWDED : PER_REASON;

  return (
    <div data-testid="needs-attention" className="al-card flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-[var(--card-pad)]">
      <div className="grid gap-1">
        <h2 className="text-card-title font-sans font-bold tracking-normal">Needs attention</h2>
        <p className="text-small text-ink-muted">
          {data.all.count === 0
            ? "Nothing is waiting on your team right now."
            : `${countLabel(data.all.count)} waiting on your team now, from any period.`}
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="flex items-center gap-2 font-bold text-success">
          <Icon icon={CircleCheck} />
          <span>All clear</span>
        </p>
      ) : (
        <div className="grid gap-4">
          {groups.map((g) => (
            <div key={g.reason} className="grid gap-1" data-reason={g.reason}>
              <h3 className="al-subhead">
                {attentionReasonLabel(g.reason)} ({g.set.count})
              </h3>
              <ul className="m-0 list-none divide-y divide-border p-0">
                {g.items.slice(0, shown).map((item) => (
                  <li key={`${item.reason}-${item.caseId}`} className="flex flex-wrap items-center justify-between gap-x-4">
                    <Link href={`/app/cases/${item.ref}`} className="inline-flex min-h-11 items-center font-mono font-bold">
                      {item.ref}
                    </Link>
                    <span className="text-small text-ink-muted">{attentionWaitLabel(item)}</span>
                  </li>
                ))}
              </ul>
              {g.set.count > shown ? (
                <Link href={inboxHref(g.set.filter)} className="inline-flex min-h-11 items-center text-small font-bold">
                  <span>
                    See all {g.set.count}
                    <VisuallyHidden>{` ${attentionReasonLabel(g.reason).toLowerCase()}`}</VisuallyHidden>
                  </span>
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {data.all.count > 0 ? (
        <Link href={inboxHref(data.all.filter)} className="mt-auto inline-flex min-h-11 items-center self-start text-small font-bold">
          <span>
            Open {countLabel(data.all.count)} in the inbox<VisuallyHidden> (Needs attention)</VisuallyHidden>
          </span>
        </Link>
      ) : null}
    </div>
  );
}
