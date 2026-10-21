// Staff-logged intake (/app/cases/new, docs/domain.md §1.3 s.9(3), §3, §4): shapes, options and limits shared by the
// form (client) and its server action. Client-safe: types and constants only. The option labels are the radios'
// exact names (e2e/channels.spec.ts).
import type { FieldErrors } from "@/lib/cases/action-result";

/** "How did it arrive?" -> cases.intakeChannel (ACR s.9(3): mail, telephone, email and any other means). */
export const STAFF_CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "mail", label: "Mail" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
] as const;

export type StaffChannel = (typeof STAFF_CHANNEL_OPTIONS)[number]["value"];
export const STAFF_CHANNELS = STAFF_CHANNEL_OPTIONS.map((o) => o.value) as [StaffChannel, ...StaffChannel[]];

export const CONTACT_MAX = 300;

/** The form's field names (FormData keys), also the keys of its field errors. */
export const STAFF_INTAKE_FIELDS = [
  "channel",
  "receivedDate",
  "text",
  "locationKind",
  "locationDetail",
  "anonymous",
  "email",
  "contact",
  "wantsRetest",
] as const;

/** The exact instruction under a code shown to staff (CLAUDE.md security rules, domain §3). */
export const READ_CODE_INSTRUCTION = "Read this code to the person; it won't be shown again";

/**
 * The answer of "Log feedback". On success the receipt code comes back ONCE, in this POST answer only, when no email
 * was given (the browser shows it and forgets it); with an email the system emailed it and `code` is null.
 */
export type LogFeedbackResult =
  | {
      ok: true;
      ref: string;
      code: string | null;
      /** The receipt code went to the email address given (or, with FAKE_EMAIL=1, was logged as simulated). */
      emailed: boolean;
      emailSimulated: boolean;
      /** Not anonymous: the lead still has to acknowledge it in the same means (ACR s.9(4)). */
      needsAck: boolean;
      message: string;
      at: number;
    }
  | { ok: false; message: string; fieldErrors?: FieldErrors; at: number };
