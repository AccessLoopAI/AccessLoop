import { Notice } from "@/components/ui/Notice";
import type { OrgCapToday } from "@/lib/rate-limit";

// The org's daily cap on web reports (lib/rate-limit.ts, ORG_DAILY_SUBMISSION_LIMIT; docs/archive/phase7-prompt.md T3 item
// 7): one quiet line while the form takes reports, a warning once it has taken the day's last one. Text only, no
// live region (nothing on the dashboard updates while someone reads it).
export function IntakeCap({ cap, className }: { cap: OrgCapToday; className?: string }) {
  const local = cap.localAllowance ? " In this local prototype, reports sent from this computer are not counted." : "";
  if (cap.reached) {
    return (
      <div data-testid="intake-cap" className={className}>
        <Notice tone="warning" title={`The report form has taken today's ${cap.limit} reports`}>
          It is turning new web reports away until midnight (Toronto time) and gives people your phone number and email
          instead. Feedback you log yourself is not limited.{local}
        </Notice>
      </div>
    );
  }
  return (
    <p data-testid="intake-cap" className={`m-0 text-small text-ink-muted ${className ?? ""}`}>
      Web reports today: <span className="font-bold tabular-nums text-ink">{cap.used}</span> of the {cap.limit} the form
      takes each day, to keep it from being flooded.{local}
    </p>
  );
}
