"use client";

// "Generate draft": the two native date inputs (labelled exactly "Period start" and "Period end", demo.spec) and
// the button. Field errors come back to the fields with an ErrorSummary; any other refusal (a broken case history)
// is the page's one result line. On success the action redirects to the draft, which announces "Draft ready" and
// takes focus on its heading. While it works the button shows a spinner and a visible line says what is happening;
// the same line is announced once through the page's one StatusRegion (WCAG 4.1.3), as the reporter form announces
// "Summarizing your report". The draft's "Draft ready", or a failure's result line, replaces it.
import { useEffect } from "react";
import { FileText } from "lucide-react";
import { ActionFeedbackProvider, fieldErrorItems, useFormAction } from "@/components/ui/ActionFeedback";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { generateDraft } from "./actions";

const IDS = { start: "period-start", end: "period-end" };
const BUILDING = "Building your draft from the records. This can take up to a minute.";

export function NewReportForm({ defaults }: { defaults: { start: string; end: string } }) {
  return (
    <ActionFeedbackProvider testId="new-report-result">
      <Form defaults={defaults} />
    </ActionFeedbackProvider>
  );
}

function Form({ defaults }: { defaults: { start: string; end: string } }) {
  const { onSubmit, pending, errors } = useFormAction(generateDraft);
  const announce = useAnnounce();
  useEffect(() => {
    if (pending) announce(BUILDING);
  }, [pending, announce]);
  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate className="grid gap-8">
      <ErrorSummary errors={fieldErrorItems(errors, IDS)} focusKey={errors?.at} />
      <Card as="section" id="report-period" title="Reporting period" tone="raised" description="Feedback received on these days, Toronto time. Both days count.">
        {/* Side by side, the hints differ in length: the hint row takes the slack (1fr), so the two date inputs
            line up on one row. */}
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField
            id={IDS.start}
            name="start"
            type="date"
            label="Period start"
            hint="The first day, for example January 1."
            defaultValue={defaults.start}
            inputWidth="medium"
            required
            error={e.start}
            className="sm:grid-rows-[auto_1fr_auto]"
          />
          <TextField
            id={IDS.end}
            name="end"
            type="date"
            label="Period end"
            hint="The last day. It can be after today: the draft counts what has arrived so far."
            defaultValue={defaults.end}
            inputWidth="medium"
            required
            error={e.end}
            className="sm:grid-rows-[auto_1fr_auto]"
          />
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button type="submit" size="lg" pending={pending} iconStart={<Icon icon={FileText} />}>
          Generate draft
        </Button>
        {pending ? <p className="text-ink-muted">{BUILDING}</p> : null}
      </div>
    </form>
  );
}
