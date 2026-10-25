// The emails AccessLoop sends (docs/decisions.md "Message model"): four to reporters, and three to the staff member a
// case is assigned to: "A barrier was assigned to you" when the lead assigns it (Phase 7 T2 item 7), and the daily
// job's two alerts (app/api/cron/daily, docs/decisions.md 2026-10-20). Pure and client-safe: the
// mailer renders them at send time, and the Outbox renders them again for display from (template, case ref, org).
// outbound_messages has no body or recipient column, and neither the receipt code nor a re-test link's token is ever
// stored, so they are only in the email that was sent; the Outbox shows CODE_PLACEHOLDER / LINK_PLACEHOLDER instead.
// Reporter copy: plain words (grade 6-8), never "priority area", "barrier classification", "compliant", "certified"
// or "guarantees". Staff alerts carry no report text: the case reference and a link to the case page only.

export const EMAIL_TEMPLATES = [
  "ack",
  "receipt_code",
  "retest_request",
  "retest_reminder",
  "owner_stalled",
  "owner_overdue",
  "owner_assigned",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

/** Who an email goes to: the person who gave the feedback, or the staff member a case is assigned to. */
export const EMAIL_AUDIENCE: Record<EmailTemplate, "reporter" | "owner"> = {
  ack: "reporter",
  receipt_code: "reporter",
  retest_request: "reporter",
  retest_reminder: "reporter",
  owner_stalled: "owner",
  owner_overdue: "owner",
  owner_assigned: "owner",
};

export function isEmailTemplate(value: unknown): value is EmailTemplate {
  return typeof value === "string" && (EMAIL_TEMPLATES as readonly string[]).includes(value);
}

/** What each email is, in staff words (the Outbox "What" column). */
export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplate, string> = {
  ack: "Acknowledgement",
  receipt_code: "Receipt code",
  retest_request: "Re-test request",
  retest_reminder: "Re-test reminder",
  owner_stalled: "No-fix alert to the owner",
  owner_overdue: "Past-due alert to the owner",
  owner_assigned: "Assignment email to the owner",
};

/** Shown instead of the code when an email is rendered again for display. Never in an email that is sent. */
export const CODE_PLACEHOLDER = "[receipt code: in the sent email only, never stored]";

/** Shown instead of a re-test email's one-round link (lib/retest-link.ts) for display. Never in a sent email. */
export const LINK_PLACEHOLDER = "[link for this check: in the sent email only, never stored]";

export interface EmailData {
  orgName: string;
  /** ACR s.9(1): the position title of the person who receives feedback. */
  designateTitle: string;
  /** The non-secret case reference, e.g. "BAR-0017". */
  ref: string;
  /** Absolute link to /check (lib/app-url.ts). Never carries a code. */
  checkUrl: string;
  /** The receipt code, only when it is known at send time (or CODE_PLACEHOLDER for display). */
  code?: string | null;
  /** Re-test emails: the one-round link /r/t/{token} (or LINK_PLACEHOLDER for display). Without it, /check only. */
  retestUrl?: string | null;
  /** Owner emails: the absolute link to the staff case page (no report text is ever in a staff email). */
  caseUrl?: string | null;
}

export interface RenderedEmail {
  subject: string;
  /** Plain text: paragraphs separated by a blank line. */
  text: string;
  /** Simple, escaped HTML version of the same paragraphs. */
  html: string;
}

/** A paragraph: plain strings, plus at most one link (the /check page). */
type Para = string | { before: string; link: string; after: string };

const CHECK_HOW = (url: string): Para => ({ before: "To see where your report is, go to ", link: url, after: " and type your receipt code." });

function signOff(d: EmailData): Para[] {
  return [`The ${d.designateTitle} receives feedback about accessibility for ${d.orgName}.`];
}

/** The staff alerts' closing line: where it comes from, and that the words are on the case page only. */
function staffSignOff(d: EmailData): Para[] {
  return [`This alert comes from AccessLoop for ${d.orgName}. It never holds report text: the case page has it.`];
}

/** "Open the case" with its link, when there is one (the daily job always gives it). */
function caseLink(d: EmailData): Para[] {
  return d.caseUrl?.trim() ? [{ before: "Open the case: ", link: d.caseUrl.trim(), after: "" }] : [];
}

/** The re-test email's own link, and what it does, when the email carries one. */
function retestLinkParas(d: EmailData): Para[] {
  const url = d.retestUrl?.trim();
  if (!url) return [];
  return [
    { before: "To answer, open this link: ", link: url, after: "" },
    "The link works for this check only, for 30 days at most. Please don't share it.",
  ];
}

function codeParas(code: string): Para[] {
  return [
    `Your receipt code is: ${code}`,
    "Keep this code. It is the only way to check your report or to tell us if a fix works for you. We don't keep a copy of it, so we can't send it again.",
  ];
}

function paragraphs(template: EmailTemplate, d: EmailData): { subject: string; paras: Para[] } {
  const code = d.code?.trim() ? d.code.trim() : null;
  switch (template) {
    case "ack":
      return {
        subject: `We received your feedback (${d.ref})`,
        paras: [
          "Hello,",
          `Thank you for your feedback to ${d.orgName}. This email confirms that we received it.`,
          `Your reference number is ${d.ref}. You can give this number if you call or write to us about it.`,
          ...(code
            ? [...codeParas(code), CHECK_HOW(d.checkUrl)]
            : [{ before: "If you have a receipt code, you can check your report at ", link: d.checkUrl, after: "." }]),
          ...signOff(d),
        ],
      };
    case "receipt_code":
      return {
        subject: `Your receipt code (${d.ref})`,
        paras: [
          "Hello,",
          `Thank you for your feedback to ${d.orgName}. Our team wrote it down as ${d.ref}.`,
          ...codeParas(code ?? CODE_PLACEHOLDER),
          CHECK_HOW(d.checkUrl),
          ...signOff(d),
        ],
      };
    case "retest_request":
      return {
        subject: `Does the fix work for you? (${d.ref})`,
        paras: [
          "Hello,",
          `${d.orgName} made a change after your feedback (${d.ref}). Please tell us if it works for you now.`,
          ...retestLinkParas(d),
          {
            before: d.retestUrl?.trim() ? "You can also go to " : "Go to ",
            link: d.checkUrl,
            after: " and type your receipt code. Then choose one answer.",
          },
          "You can say that it works now, that it partly works, that it is still a barrier, or that you can't check right now. You can also ask us not to contact you about this again.",
          "Your answer tells us if the barrier is really gone.",
          ...signOff(d),
        ],
      };
    case "retest_reminder":
      return {
        subject: `Reminder: does the fix work for you? (${d.ref})`,
        paras: [
          "Hello,",
          `We asked you if the change ${d.orgName} made after your feedback (${d.ref}) works for you. If you have a minute, please tell us.`,
          ...retestLinkParas(d),
          { before: d.retestUrl?.trim() ? "You can also go to " : "Go to ", link: d.checkUrl, after: " and type your receipt code." },
          "This is the only reminder we will send about this fix. If you don't want to be asked again, choose \"Don't contact me about this again\" on that page.",
          ...signOff(d),
        ],
      };
    case "owner_stalled":
      return {
        subject: `No fix logged yet: ${d.ref}`,
        paras: [
          "Hello,",
          `${d.ref} was assigned to you in AccessLoop 30 or more days ago, and no fix is logged on it yet.`,
          "When you have made a fix, log it on the case page. Then the person who reported it can check it.",
          `If you can't fix it, or it is not yours to fix, tell the ${d.designateTitle}.`,
          ...caseLink(d),
          ...staffSignOff(d),
        ],
      };
    case "owner_assigned":
      return {
        subject: `A barrier was assigned to you: ${d.ref}`,
        paras: [
          "Hello,",
          `A barrier someone reported to ${d.orgName} was assigned to you in AccessLoop, so that you can fix it. Its reference is ${d.ref}.`,
          "The case page says what was reported and where, and the due date if there is one. Names and contact details are removed.",
          "When you have made a fix, log it on the case page. Then the person who reported it can check it.",
          `If it is not yours to fix, tell the ${d.designateTitle}.`,
          ...caseLink(d),
          ...staffSignOff(d),
        ],
      };
    case "owner_overdue":
      return {
        subject: `Past its due date: ${d.ref}`,
        paras: [
          "Hello,",
          `${d.ref} is assigned to you in AccessLoop. Its due date has passed, and no fix is logged on it yet.`,
          "When you have made a fix, log it on the case page. Then the person who reported it can check it.",
          `If you need more time, tell the ${d.designateTitle}.`,
          ...caseLink(d),
          ...staffSignOff(d),
        ],
      };
  }
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

function paraText(p: Para): string {
  return typeof p === "string" ? p : `${p.before}${p.link}${p.after}`;
}

function paraHtml(p: Para): string {
  if (typeof p === "string") return `<p>${escapeHtml(p)}</p>`;
  return `<p>${escapeHtml(p.before)}<a href="${escapeHtml(p.link)}">${escapeHtml(p.link)}</a>${escapeHtml(p.after)}</p>`;
}

/** Subject, plain text and HTML of one email. */
export function renderEmail(template: EmailTemplate, data: EmailData): RenderedEmail {
  const { subject, paras } = paragraphs(template, data);
  return {
    subject,
    text: paras.map(paraText).join("\n\n"),
    html: `<!doctype html><html lang="en"><body style="font-family: sans-serif; font-size: 18px; line-height: 1.5;">${paras
      .map(paraHtml)
      .join("")}</body></html>`,
  };
}

/**
 * The email again, for display (the Outbox): exactly what was sent, except that a code that was in it is replaced
 * by CODE_PLACEHOLDER and a re-test link by LINK_PLACEHOLDER. `codeIncluded` and `linkIncluded` come from the
 * message_sent event (codeIncluded is true for every receipt_code email).
 */
export function renderForDisplay(
  template: EmailTemplate,
  data: Omit<EmailData, "code" | "retestUrl">,
  codeIncluded: boolean,
  linkIncluded = false,
): RenderedEmail {
  return renderEmail(template, {
    ...data,
    code: codeIncluded || template === "receipt_code" ? CODE_PLACEHOLDER : null,
    retestUrl: linkIncluded ? LINK_PLACEHOLDER : null,
  });
}
