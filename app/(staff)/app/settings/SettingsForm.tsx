"use client";

// The org settings form. Accessible names are the e2e contract (e2e/channels.spec.ts): "Title of the person who
// receives feedback", "Mailing address", "Phone number", "Email address", "What you offer people who check a fix
// (optional)", the group "Areas in your accessibility plan", "Organization type" and "Save settings". The server
// action validates everything again; errors come back inline with an ErrorSummary, success is one focused line.
import { ArrowRight, Save } from "lucide-react";
import { ActionFeedbackProvider, fieldErrorItems, useFormAction } from "@/components/ui/ActionFeedback";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { TextareaField, TextField } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { SelectField } from "@/components/ui/Select";
import { ENTITY_CLASS_OPTIONS, PLAN_AREA_OPTIONS, SETTINGS_LIMITS, type EntityClass } from "@/lib/org-settings";
import { saveSettings } from "./actions";

const IDS = {
  feedbackDesignateTitle: "designate-title",
  contactMailingAddress: "mailing-address",
  contactPhone: "contact-phone",
  contactEmail: "contact-email",
  retestOfferText: "retest-offer",
  planAreas: "plan-areas-0",
  entityClass: "entity-class",
};

export interface SettingsValues {
  feedbackDesignateTitle: string;
  contactMailingAddress: string;
  contactPhone: string;
  contactEmail: string;
  retestOfferText: string;
  planAreas: readonly string[];
  entityClass: EntityClass;
}

export function SettingsForm({ initial, orgSlug }: { initial: SettingsValues; orgSlug: string }) {
  return (
    <ActionFeedbackProvider testId="settings-result">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,48rem)_minmax(16rem,22rem)] lg:items-start lg:gap-10">
        <div className="min-w-0">
          <Form initial={initial} orgSlug={orgSlug} />
        </div>
        <WhereShown orgSlug={orgSlug} />
      </div>
    </ActionFeedbackProvider>
  );
}

/** Where each setting appears, beside the form (below it on small screens). */
function WhereShown({ orgSlug }: { orgSlug: string }) {
  const places: [string, string][] = [
    ["Your public feedback form", "The title and the other ways to reach you: phone, email and mail (ACR s.9(3))."],
    ["Emails to people who give feedback", "The title of the person who receives feedback."],
    ["Your progress report", "The General section (title and contact details) and one heading for each area in your plan."],
    ["The page where people check a fix", "What you offer them, if anything."],
  ];
  return (
    <Card as="section" id="settings-where" title="Where this shows" tone="inset">
      <ul className="m-0 grid list-none gap-4 p-0">
        {places.map(([title, text]) => (
          <li key={title}>
            <span className="block font-bold">{title}</span>
            <span className="block text-small text-ink-muted">{text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-5">
        <a href={`/o/${orgSlug}/report`} className="inline-flex min-h-11 items-center gap-1.5 font-bold">
          <span>Open your public form</span>
          <Icon icon={ArrowRight} size="1em" />
        </a>
      </p>
    </Card>
  );
}

function Form({ initial, orgSlug }: { initial: SettingsValues; orgSlug: string }) {
  const { onSubmit, pending, errors } = useFormAction(saveSettings);
  const e = errors?.fields ?? {};
  return (
    <form onSubmit={onSubmit} method="post" noValidate className="grid gap-8">
      <ErrorSummary errors={fieldErrorItems(errors, IDS)} focusKey={errors?.at} />

      <Card as="section" id="feedback-contact" title="Who to contact" tone="raised">
        <div className="grid gap-6">
          <TextField
            id="designate-title"
            name="feedbackDesignateTitle"
            label="Title of the person who receives feedback"
            hint="ACR s.9(1): the position title, not a person's name. It is shown on your public pages, in emails to people who give feedback and in the General section of your progress report."
            defaultValue={initial.feedbackDesignateTitle}
            maxLength={SETTINGS_LIMITS.title * 2}
            autoComplete="organization-title"
            required
            error={e.feedbackDesignateTitle}
          />
          {/* The three contact fields under their own sub-heading (the note used to float between two fields). */}
          <div className="grid gap-2 border-t border-border pt-6">
            <h3 className="al-subhead">Other ways to reach you</h3>
            <p className="max-w-[var(--measure)] text-small text-ink-muted">
              ACR s.14(2): the progress report gives a mailing address, a phone number and an email address, so people
              can give feedback or ask for the report or this process in another format. Your public form at{" "}
              <span className="font-mono">/o/{orgSlug}/report</span> lists them too.
            </p>
          </div>
          <TextareaField
            id="mailing-address"
            name="contactMailingAddress"
            label="Mailing address"
            defaultValue={initial.contactMailingAddress}
            rows={3}
            autoComplete="street-address"
            required
            error={e.contactMailingAddress}
          />
          <TextField
            id="contact-phone"
            name="contactPhone"
            type="tel"
            label="Phone number"
            defaultValue={initial.contactPhone}
            autoComplete="tel"
            inputWidth="medium"
            required
            error={e.contactPhone}
          />
          <TextField
            id="contact-email"
            name="contactEmail"
            type="email"
            label="Email address"
            defaultValue={initial.contactEmail}
            autoComplete="email"
            spellCheck={false}
            inputWidth="medium"
            required
            error={e.contactEmail}
          />
        </div>
      </Card>

      <Card as="section" id="report-settings" title="Your plan and your report">
        <div className="grid gap-6">
          <CheckboxGroup
            id="plan-areas"
            name="planAreas"
            legend="Areas in your accessibility plan"
            hint="ACR s.14(1)(b): your progress report has a heading for each area in your plan. Choose at least one."
            options={PLAN_AREA_OPTIONS}
            defaultValues={initial.planAreas}
            columns="two"
            error={e.planAreas}
          />
          <SelectField
            id="entity-class"
            name="entityClass"
            label="Organization type"
            hint="It sets your next deadline: federal public sector and large private organizations publish progress reports; small ones update their plan."
            options={ENTITY_CLASS_OPTIONS}
            defaultValue={initial.entityClass}
            required
            error={e.entityClass}
          />
        </div>
      </Card>

      <Card as="section" id="retest-settings" title="Checking fixes">
        <TextareaField
          id="retest-offer"
          name="retestOfferText"
          label="What you offer people who check a fix (optional)"
          hint={`Shown on the page where people say if a fix works, for example: "We offer a $25 gift card to thank you for checking a fix." AccessLoop does not handle payments. Up to ${SETTINGS_LIMITS.offer} characters.`}
          defaultValue={initial.retestOfferText}
          rows={2}
          error={e.retestOfferText}
        />
      </Card>

      <div>
        <Button type="submit" size="lg" pending={pending} iconStart={<Icon icon={Save} />}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
