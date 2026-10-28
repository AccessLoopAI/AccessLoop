// The feedback-process description (ACA s.70(1), ACR s.9; docs/domain.md §1.3) and the lead's checklist for it on
// /app/settings (docs/archive/phase7-prompt.md T6 item 4). The public page /p/{org} renders the description from the org's
// settings (components/feedback-process/FeedbackProcessDescription.tsx); Settings previews the same component and
// lists, rule by rule, what is in place and what is missing. Pure and client-safe. Never says "compliant": each row
// says what AccessLoop can see, and the rows it cannot see are marked for the lead to check.

export interface FeedbackProcessSettings {
  name: string;
  slug: string;
  feedbackDesignateTitle: string;
  contactMailingAddress: string;
  contactPhone: string;
  contactEmail: string;
}

/** "Accessibility Lead" from "the Accessibility Lead" (the sentence adds its own "The"). */
export function designateTitleInSentence(title: string): string {
  return title.trim().replace(/^the\s+/i, "");
}

/** The description's fixed lines (one source for /p and the Settings preview). */
export const PROCESS_LINES = {
  anonymous: "You can stay anonymous. You don’t need an account, and you don’t have to give your name.",
  acknowledgement: "We let you know we got your feedback in the same way it reached us, unless you stay anonymous.",
  formats:
    "You can ask for this description, or any of our progress reports, in print, large print, braille, audio, or an electronic format that works with assistive technology.",
} as const;

/** The opening sentence of the description: who receives feedback, and about what (ACA s.70(1)(a)-(b), ACR s.9(1)). */
export function processIntro(org: Pick<FeedbackProcessSettings, "name" | "feedbackDesignateTitle">): string {
  return (
    `The ${designateTitleInSentence(org.feedbackDesignateTitle)} receives feedback about accessibility on behalf of ${org.name}. ` +
    "You can tell us about a barrier you met when dealing with us, or about how we are carrying out our accessibility plan."
  );
}

export type ProcessCheckState = "met" | "missing" | "check";

export interface ProcessCheck {
  id: "designate" | "anonymous" | "channels" | "other_channels" | "acknowledgement" | "formats";
  /** The rule, as cited in the UI. */
  rule: string;
  label: string;
  state: ProcessCheckState;
  /** One plain sentence: what AccessLoop sees, or what to do. */
  detail: string;
  /** Where to fix or see it (a field on Settings, or the inbox filtered to the cases). */
  action?: { href: string; text: string };
}

/** Words that a position title usually contains (ACR s.9(1) asks for the title, not a person's name). */
const ROLE_WORDS =
  /\b(lead|leader|manager|director|officer|coordinator|co-ordinator|advisor|adviser|specialist|head|chief|team|office|desk|services?|president|analyst|administrator|representative|champion|accessibility|ombuds\w*|commissioner|secretary|liaison|partner|consultant|supervisor|executive|vp|department|unit|centre|center|responsable|directeur|directrice|gestionnaire|conseill\w*|agent|bureau)\b/i;

/** "check" when the saved title has none of the usual title words, so it may be a person's name. */
function titleLooksLikeAName(title: string): boolean {
  return !ROLE_WORDS.test(title) || /@|\d/.test(title);
}

export interface AcknowledgementSeen {
  /** Non-anonymous feedback received this year (it needs an acknowledgement in the same way, ACR s.9(4)). */
  required: number;
  /** ...of which none is recorded in the way it came in. */
  missing: number;
  /** The inbox, filtered to exactly those cases. */
  missingHref: string | null;
  /** The year the counts cover, e.g. "2026". */
  periodLabel: string;
}

/**
 * The ACR s.9 checklist for /app/settings, in the regulation's order. The settings form already requires the title
 * and the three contact details, so "missing" there means a saved value is empty (an older row); "check" marks what
 * AccessLoop cannot see for itself.
 */
export function feedbackProcessChecks(org: FeedbackProcessSettings, ack: AcknowledgementSeen | null): ProcessCheck[] {
  const title = org.feedbackDesignateTitle.trim();
  const checks: ProcessCheck[] = [];

  checks.push(
    !title
      ? {
          id: "designate",
          rule: "ACR s.9(1)",
          label: "The position title of the person who receives feedback",
          state: "missing",
          detail: "No title is saved. Add the position title, not a person’s name.",
          action: { href: "#designate-title", text: "Add the title" },
        }
      : titleLooksLikeAName(title)
        ? {
            id: "designate",
            rule: "ACR s.9(1)",
            label: "The position title of the person who receives feedback",
            state: "check",
            detail: `“${title}” may be a person’s name. The rule asks for a position title, like Accessibility Lead.`,
            action: { href: "#designate-title", text: "Edit the title" },
          }
        : {
            id: "designate",
            rule: "ACR s.9(1)",
            label: "The position title of the person who receives feedback",
            state: "met",
            detail: `Your description names the ${designateTitleInSentence(title)}.`,
          },
  );

  checks.push({
    id: "anonymous",
    rule: "ACR s.9(2)",
    label: "People can give feedback anonymously",
    state: "met",
    detail: "Your online form is anonymous unless the person chooses to add an email, and nobody needs an account.",
  });

  const missingChannels = [
    !org.contactMailingAddress.trim() ? "a mailing address" : null,
    !org.contactPhone.trim() ? "a phone number" : null,
    !org.contactEmail.trim() ? "an email address" : null,
  ].filter((x): x is string => !!x);
  checks.push(
    missingChannels.length
      ? {
          id: "channels",
          rule: "ACR s.9(3)",
          label: "Feedback by mail, telephone and email",
          state: "missing",
          detail: `Add ${missingChannels.join(" and ")}. Your description lists every way to reach you.`,
          action: { href: "#mailing-address", text: "Add the contact details" },
        }
      : {
          id: "channels",
          rule: "ACR s.9(3)",
          label: "Feedback by mail, telephone and email",
          state: "met",
          detail: "Your description lists your mailing address, phone number and email address, next to the online form. Staff log what arrives by mail, phone or email with Log feedback.",
        },
  );

  checks.push({
    id: "other_channels",
    rule: "ACR s.9(3)",
    label: "Every other way you communicate with the public",
    state: "check",
    detail:
      "AccessLoop can’t see this. If you also talk with the public another way, such as in person, by live chat or on social media, people must be able to give feedback that way too: log it with Log feedback.",
    action: { href: "/app/cases/new", text: "Open Log feedback" },
  });

  if (!ack) {
    checks.push({
      id: "acknowledgement",
      rule: "ACR s.9(4)",
      label: "Acknowledgement in the same way the feedback came in",
      state: "check",
      detail: "AccessLoop could not read this year’s cases just now. The dashboard shows the same count.",
    });
  } else if (ack.missing > 0) {
    checks.push({
      id: "acknowledgement",
      rule: "ACR s.9(4)",
      label: "Acknowledgement in the same way the feedback came in",
      state: "missing",
      detail: `${ack.missing === 1 ? "1 case" : `${ack.missing} cases`} received in ${ack.periodLabel} that ${ack.missing === 1 ? "was" : "were"} not anonymous ${ack.missing === 1 ? "has" : "have"} no acknowledgement recorded in the way ${ack.missing === 1 ? "it" : "they"} came in.`,
      action: ack.missingHref ? { href: ack.missingHref, text: ack.missing === 1 ? "See the case" : "See the cases" } : undefined,
    });
  } else {
    checks.push({
      id: "acknowledgement",
      rule: "ACR s.9(4)",
      label: "Acknowledgement in the same way the feedback came in",
      state: "met",
      detail:
        ack.required === 0
          ? `Nothing to acknowledge in ${ack.periodLabel} yet: all of it was anonymous. Web reports get a receipt on screen; email gets an email; staff record a call or a letter on the case.`
          : `Every case received in ${ack.periodLabel} that was not anonymous has its acknowledgement recorded (${ack.required === 1 ? "1 case" : `${ack.required} cases`}).`,
    });
  }

  checks.push({
    id: "formats",
    rule: "ACR s.14(2)(b)",
    label: "The description in another format, on request",
    state: "met",
    detail: "Your description says people can ask for it in print, large print, braille, audio or an electronic format, using your contact details.",
  });

  return checks;
}

/** "4 in place, 1 to check, 1 missing" style counts. */
export function processCheckCounts(checks: readonly ProcessCheck[]): Record<ProcessCheckState, number> {
  return {
    met: checks.filter((c) => c.state === "met").length,
    check: checks.filter((c) => c.state === "check").length,
    missing: checks.filter((c) => c.state === "missing").length,
  };
}

/** The checklist's first line. */
export function processCheckSummary(checks: readonly ProcessCheck[]): string {
  const n = processCheckCounts(checks);
  const parts = [`${n.met} of ${checks.length} in place`];
  if (n.missing) parts.push(`${n.missing} missing`);
  if (n.check) parts.push(`${n.check} for you to check`);
  return `${parts.join(", ")}.`;
}
