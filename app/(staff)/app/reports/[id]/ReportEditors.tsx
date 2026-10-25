"use client";

// The lead's controls on a report page: one text box per plan area and Consultations (draft only), and the sign-off
// and publish panel. Each answers through the ActionFeedback pattern: a section's save shows its result under its
// own button and keeps focus there (a long document: focus never jumps to the top), announced through the page's one
// StatusRegion; sign-off and publish show their result at the top of the panel and move focus to it, because the
// button that was pressed is replaced by the next step.
import { useEffect } from "react";
import { ExternalLink, FileCheck2, Globe, Save } from "lucide-react";
import { ActionFeedbackProvider, useFormAction } from "@/components/ui/ActionFeedback";
import { Button } from "@/components/ui/Button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Card } from "@/components/ui/Card";
import { TextareaField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { useAnnounce } from "@/components/ui/StatusRegion";
import { BUILT_COOKIE, LEAD_TEXT_MAX } from "@/lib/report/labels";
import { publish, saveSectionText, signOff } from "./actions";

export function LeadEditor({
  reportId,
  sectionKey,
  heading,
  label,
  hint,
  initial,
}: {
  reportId: string;
  sectionKey: string;
  heading: string;
  label: string;
  hint: string;
  initial: string;
}) {
  const id = `lead-${sectionKey.replace(/[^a-z0-9]+/gi, "-")}`;
  return (
    <ActionFeedbackProvider testId={`${id}-result`} placement="after" focusResult={false}>
      <LeadForm id={id} reportId={reportId} sectionKey={sectionKey} heading={heading} label={label} hint={hint} initial={initial} />
    </ActionFeedbackProvider>
  );
}

function LeadForm({ id, reportId, sectionKey, heading, label, hint, initial }: { id: string; reportId: string; sectionKey: string; heading: string; label: string; hint: string; initial: string }) {
  const { onSubmit, pending } = useFormAction(saveSectionText);
  return (
    <form onSubmit={onSubmit} method="post" noValidate className="al-lead-editor grid gap-4">
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="key" value={sectionKey} />
      <TextareaField
        id={id}
        name="text"
        label={label}
        hint={`${hint} Plain text; leave a blank line between paragraphs. Up to ${LEAD_TEXT_MAX.toLocaleString("en-CA")} characters.`}
        defaultValue={initial}
        rows={5}
        maxLength={LEAD_TEXT_MAX}
      />
      <div>
        <Button type="submit" variant="secondary" pending={pending} iconStart={<Icon icon={Save} />}>
          {`Save ${heading} text`}
        </Button>
      </div>
    </form>
  );
}

export interface SignOffState {
  reportId: string;
  state: "draft" | "signed_off" | "published";
  /** The lead may act (auditors see the same panel without buttons). */
  canAct: boolean;
  canSignOff: boolean;
  /** What still stands between the draft and sign-off, in words. */
  missing: string[];
  signedOff: { by: string | null; at: string; atIso: string } | null;
  /** `signed`: the report carries a signed fingerprint (the footer shows it) for the ACR s.16 notice. */
  published: { at: string; atIso: string; due: string; dueIso: string; regulator: string; signed: boolean } | null;
  publicHref: string;
}

export function SignOffPanel(props: SignOffState) {
  return (
    <Card as="section" id="sign-off" title="Sign off and publish" tone="raised">
      <ActionFeedbackProvider testId="report-result">
        <SignOffBody {...props} />
      </ActionFeedbackProvider>
    </Card>
  );
}

function SignOffBody({ reportId, state, canAct, canSignOff, missing, signedOff, published, publicHref }: SignOffState) {
  const sign = useFormAction(signOff);
  const pub = useFormAction(publish);

  if (state === "draft") {
    return (
      <div className="grid gap-4">
        <p>
          Signing off makes this version final. Nobody can change it afterwards; a new version is a new report. Your name
          and the time are recorded.
        </p>
        {missing.length ? (
          <div>
            <p className="font-bold">Before you can sign off:</p>
            <ul className="mt-1 list-disc pl-6">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : canSignOff ? (
          <p className="font-bold text-success">Everything is written and every required check passes.</p>
        ) : null}
        {canAct ? (
          <form onSubmit={sign.onSubmit} method="post" noValidate>
            <input type="hidden" name="reportId" value={reportId} />
            <Button type="submit" pending={sign.pending} iconStart={<Icon icon={FileCheck2} />}>
              Sign off
            </Button>
          </form>
        ) : (
          <p className="text-small text-ink-muted">Only the lead can sign off.</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {signedOff ? (
        <p>
          Signed off{signedOff.by ? ` by ${signedOff.by}` : ""} on <time dateTime={signedOff.atIso}>{signedOff.at}</time>. This
          version can&rsquo;t change any more.
        </p>
      ) : null}
      {state === "signed_off" ? (
        canAct ? (
          <>
            <p>Publishing puts this report on your public page, with its sources and the evidence check open to everyone.</p>
            <form onSubmit={pub.onSubmit} method="post" noValidate>
              <input type="hidden" name="reportId" value={reportId} />
              <Button type="submit" pending={pub.pending} iconStart={<Icon icon={Globe} />}>
                Publish
              </Button>
            </form>
          </>
        ) : (
          <p className="text-small text-ink-muted">Not published yet. Only the lead can publish.</p>
        )
      ) : null}
      {published ? (
        <>
          <p>
            Published on <time dateTime={published.atIso}>{published.at}</time>.
          </p>
          <Notice tone="warning" title={`Tell ${published.regulator} within 48 hours`}>
            <p>
              ACR s.16: notify {published.regulator} within 48 hours of publishing, by{" "}
              <time dateTime={published.dueIso}>{published.due}</time>. AccessLoop doesn&rsquo;t send this notice.
              {published.signed ? " Include the signed fingerprint shown at the end of the report." : ""}
            </p>
          </Notice>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={publicHref} variant="secondary" iconStart={<Icon icon={ExternalLink} />}>
              View the published page
            </ButtonLink>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Signature moment 2 (CLAUDE.md): "Generate draft" sets a one-time cookie with the new report's id
 * (lib/report/labels.ts BUILT_COOKIE), the server renders data-building, and the sections fill in order while the
 * checks tick (CSS only, nothing under reduced motion). This announces "Draft ready" once, puts focus on the draft's
 * heading, and deletes the cookie, so a reload or the refresh after a save never replays it or announces it again.
 */
export function BuildReveal() {
  const announce = useAnnounce();
  useEffect(() => {
    announce("Draft ready");
    document.querySelector<HTMLElement>('main h1[tabindex="-1"]')?.focus();
    document.cookie = `${BUILT_COOKIE}=; Max-Age=0; Path=/app/reports; SameSite=Lax`;
  }, [announce]);
  return null;
}
