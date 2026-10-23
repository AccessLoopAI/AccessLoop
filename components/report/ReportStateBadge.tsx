// Draft / Signed off / Published, as a badge (text + icon, never colour alone).
import { FilePen, FileCheck2, Globe } from "lucide-react";
import { cx } from "@/components/ui/cx";
import { Icon, type Glyph } from "@/components/ui/Icon";
import { REPORT_STATE_LABELS, type ReportState } from "@/lib/report/view";

const ICON: Record<ReportState, Glyph> = { draft: FilePen, signed_off: FileCheck2, published: Globe };
const TONE: Record<ReportState, string> = {
  draft: "bg-accent-soft text-accent-ink",
  signed_off: "bg-info-bg text-info",
  published: "bg-success-bg text-success",
};

export function ReportStateBadge({ state, className }: { state: ReportState; className?: string }) {
  return (
    <span
      data-report-state={state}
      className={cx("al-badge inline-flex items-center gap-[0.45em] rounded-pill border border-transparent px-3 py-1 text-small font-bold", TONE[state], className)}
    >
      <Icon icon={ICON[state]} size="1.05em" />
      <span>{REPORT_STATE_LABELS[state]}</span>
    </span>
  );
}
