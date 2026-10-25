// The case History in plain words (docs/domain.md §3 event types, §8 evidence chain). Pure and client-safe: the
// staff case page turns every case_events row into one line with this, and the unit tests pin the wording.
// Payloads hold redacted content only, but a viewer still sees only what their role may read:
// - summaries and other text from before the lead's redaction review are never shown here (the AI summary lives
//   in the append-only ai_structured payload, where the review can't correct it);
// - words the reporter typed that no person reviewed (re-test comments, notes) are shown to the lead only.
import { AREA_HEADINGS, PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";
import { CLOSED_REASON_STAFF_LABELS } from "@/lib/cases/labels";
import { isIsoDate, zonedDate, zonedNoon } from "@/lib/dates";
import { formatDateLong } from "@/lib/format";
import { NOTE_KIND_LABELS, isNoteKind } from "@/lib/cases/notes";
import { isPiiType, PII_TYPE_WORDS } from "@/lib/cases/redaction-labels";
import { RETEST_ANSWERS } from "@/lib/retest";
import { CASE_STATUSES, STAFF_STATUS_LABELS, isClosedReason, type CaseStatus } from "@/lib/status";

export interface HistoryEventInput {
  seq: number;
  type: string;
  actorKind: "reporter" | "staff" | "system";
  actorId: string | null;
  payload: Record<string, unknown>;
  /** The record's own time (case_events.created_at): an acknowledgement says how long after its date it was written. */
  createdAt?: Date;
}

export interface HistoryViewer {
  /** Only the lead reads reporter text that no person reviewed. */
  isLead: boolean;
  /** Display name of an org member (org_members.id), or null when unknown. */
  memberName: (id: string | null | undefined) => string | null;
  /**
   * The viewer opens every case of the org (lead, auditor), so another case's ref may be named and linked (a
   * duplicate's original). An owner opens only their own cases: the History says "another case" instead.
   */
  seesOtherCases?: boolean;
}

export type HistoryTone = "default" | "success" | "warning" | "danger" | "info";

export interface HistoryLine {
  title: string;
  /** Who did it, when the title doesn't already say so. */
  actor?: string;
  /** A short label for the body ("Public summary", "Their comment"). */
  bodyLabel?: string;
  body?: string;
  /** A second labelled line under the body (a retriage's reason). */
  note?: { label: string; text: string };
  /** An http(s) link the staff member gave as evidence. */
  link?: string;
  /** Another case of the org this event points to (a duplicate's original), for a viewer who may open it. */
  caseLink?: { label: string; ref: string };
  /** "New" -> "Triaged" for events that changed the status. */
  statusChange?: { from: string; to: string };
  tone: HistoryTone;
}

const CHANNEL_RECEIVED: Record<string, string> = {
  web: "Report received on the web form",
  email: "Feedback received by email",
  phone: "Feedback received by phone",
  mail: "Feedback received by mail",
  in_person: "Feedback received in person",
  other: "Feedback received another way",
};

/** "by phone", "in person": how an acknowledgement went out (ACR s.9(4): in the same means). */
export const ACK_CHANNEL_WORDS: Record<string, string> = {
  email: "by email",
  phone: "by phone",
  mail: "by mail",
  in_person: "in person",
  other: "another way",
};

const BACKEND_WORDS: Record<string, string> = {
  fake: "the simulated AI",
  "claude-cli": "AI (the team's local Claude CLI)",
  api: "AI",
  seed: "AI (demo data)",
};

const SUMMARY_SOURCE_WORDS: Record<string, string> = {
  ai_confirmed: "The reporter confirmed it.",
  ai_edited: "The reporter changed it.",
  reporter_words: "The reporter kept their own words instead.",
  staff: "Staff logged this feedback, so the person who gave it did not review the summary.",
};

const VERDICT_LABELS: Record<string, string> = Object.fromEntries(RETEST_ANSWERS.map((a) => [a.value, a.label]));

const TEMPLATE_WORDS: Record<string, string> = {
  ack: "acknowledgement email",
  receipt_code: "receipt code email",
  retest_request: "re-test request email",
  retest_reminder: "re-test reminder email",
  owner_stalled: "no-fix alert to the owner",
  owner_overdue: "past-due alert to the owner",
  owner_assigned: "assignment email to the owner",
};

/** message_sent { status }: "skipped_fake" = FAKE_EMAIL=1, nothing left the machine (the Outbox shows it). */
function messageTitle(template: unknown, status: unknown): string {
  const what = TEMPLATE_WORDS[String(template)] ?? "an email";
  if (status === "sent") return `Email sent: ${what}`;
  if (status === "skipped_fake") return `Email logged, not sent (simulated): ${what}`;
  if (status === "failed") return `Email failed: ${what}`;
  return `Message sent: ${what}`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isStatus = (v: unknown): v is CaseStatus => typeof v === "string" && (CASE_STATUSES as readonly string[]).includes(v);
const isArea = (v: unknown): v is PriorityArea => typeof v === "string" && (PRIORITY_AREAS as readonly string[]).includes(v);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A `closed` event's original case (Phase 7 T2 item 8): `duplicateOf: { caseId, ref }`, recorded by the state
 * machine after it found that case in the same org. null for every other close, and for duplicates closed before
 * Phase 7 (and the seed's), which named no original.
 */
export function duplicateOfPayload(payload: Record<string, unknown> | null | undefined): { caseId: string; ref: string } | null {
  const d = payload?.duplicateOf as { caseId?: unknown; ref?: unknown } | null | undefined;
  if (!d || typeof d.caseId !== "string" || typeof d.ref !== "string" || !/^BAR-\d{4,6}$/.test(d.ref)) return null;
  return { caseId: d.caseId, ref: d.ref };
}

/**
 * Whole calendar days between the day a staff record says an acknowledgement was given (`on`, YYYY-MM-DD) and the
 * day it was recorded (the event's own time), in the display time zone. 0 = recorded the same day.
 */
export function ackRecordedAfterDays(givenOn: string, recordedAt: Date): number {
  const day = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return day(zonedDate(recordedAt)) - day(givenOn);
}

/** "recorded the same day" / "recorded 1 day later" / "recorded 12 days later". */
export function ackRecordedWords(days: number): string {
  return days <= 0 ? "recorded the same day" : `recorded ${days === 1 ? "1 day" : `${days} days`} later`;
}

/** The unique type words of a span list, in order: "person, phone". */
export function spanTypeWords(spans: unknown): { count: number; words: string } {
  if (!Array.isArray(spans)) return { count: 0, words: "" };
  const words: string[] = [];
  for (const s of spans) {
    const t = (s as { type?: unknown } | null)?.type;
    if (isPiiType(t) && !words.includes(PII_TYPE_WORDS[t])) words.push(PII_TYPE_WORDS[t]);
  }
  return { count: spans.length, words: words.join(", ") };
}

function actorName(e: HistoryEventInput, v: HistoryViewer): string {
  if (e.actorKind === "reporter") return "The reporter";
  if (e.actorKind === "system") return "AccessLoop";
  return v.memberName(e.actorId) ?? "A staff member";
}

/** One case event in plain words for this viewer. */
export function describeEvent(e: HistoryEventInput, v: HistoryViewer): HistoryLine {
  const p = e.payload ?? {};
  const who = actorName(e, v);
  const from = p.from;
  const to = p.to;
  const statusChange = isStatus(from) && isStatus(to) && from !== to
    ? { from: STAFF_STATUS_LABELS[from], to: STAFF_STATUS_LABELS[to] }
    : undefined;
  const leadOnly = (label: string, text: string | null): Pick<HistoryLine, "bodyLabel" | "body"> =>
    text === null ? {} : v.isLead ? { bodyLabel: label, body: text } : { body: "The reporter wrote something here. Only the lead can read it." };

  switch (e.type) {
    case "submitted": {
      const title = CHANNEL_RECEIVED[String(p.channel)] ?? "Feedback received";
      return {
        title,
        actor: e.actorKind === "staff" ? `Logged by ${who}` : undefined,
        body: p.codeRelayedByStaff === true ? "Staff gave the receipt code to the person." : undefined,
        tone: "default",
      };
    }
    case "ack_recorded": {
      if (p.channel === "web_screen") return { title: "Acknowledgement shown on screen", actor: who, tone: "default" };
      // A recorded acknowledgement keeps the day it was given (`on`), which may be before the day it was recorded
      // (the record's own time). Say both, so the evidence reads right (ACR s.9(4)).
      const on = typeof p.on === "string" && isIsoDate(p.on) ? p.on : null;
      // Phase 7 (acknowledgement honesty): how long after the day it gives the record was written (the record's
      // own time is the line's date). The metric counts records written more than 7 days later.
      const later = on && e.createdAt ? ackRecordedAfterDays(on, e.createdAt) : null;
      return {
        title: `Acknowledgement recorded (${ACK_CHANNEL_WORDS[String(p.channel)] ?? "manually"})`,
        actor: who,
        body: on
          ? `Given to the person on ${formatDateLong(zonedNoon(on))}.${later !== null && later > 0 ? ` ${capitalize(ackRecordedWords(later))}.` : ""}`
          : undefined,
        tone: "default",
      };
    }
    case "ai_structured":
      return {
        title: `Summary made by ${BACKEND_WORDS[String(p.backend)] ?? "AI"}`,
        body: SUMMARY_SOURCE_WORDS[String((p.confirmedValue as { summarySource?: unknown } | undefined)?.summarySource)],
        tone: "default",
      };
    case "redaction_proposed": {
      const { count, words } = spanTypeWords(p.spans);
      return {
        title: count === 0 ? "No personal details found automatically" : `${plural(count, "detail")} hidden automatically${words ? ` (${words})` : ""}`,
        body: p.needsManualRedaction === true ? "Some text was not checked for names automatically, so it needs a check by hand." : undefined,
        tone: "default",
      };
    }
    case "redaction_approved": {
      const { count, words } = spanTypeWords(p.spans);
      const kept = num(p.kept), removed = num(p.removed), added = num(p.added);
      const parts = [`${plural(count, "detail")} hidden${words ? ` (${words})` : ""}.`];
      if (p.revision === true) {
        // Phase 7 T2: the lead hid a detail the approved redaction missed (a new event; the earlier ones stay).
        if (added !== null) parts.push(`${plural(added, "set", "sets")} of words added by hand; every detail hidden before stays hidden.`);
        return { title: `Redaction corrected by ${who}`, body: parts.join(" "), tone: "warning" };
      }
      if (kept !== null && removed !== null && added !== null) {
        parts.push(`Kept ${kept} found automatically, removed ${removed}, added ${added} by hand.`);
      }
      return { title: `Redaction approved by ${who}`, body: parts.join(" "), tone: "success" };
    }
    case "private_revealed":
      return { title: `Original viewed by ${who}`, tone: "warning" };
    case "triaged": {
      if (p.retriage === true) {
        // D2: the lead corrected the area and/or the public summary (status unchanged).
        const changed = Array.isArray(p.changed) ? p.changed : [];
        const area = changed.includes("priorityArea");
        const summary = changed.includes("publicSummary");
        const heading = isArea(p.priorityArea) ? AREA_HEADINGS[p.priorityArea].canonical : null;
        const what = area && summary ? "Area and public summary corrected" : area ? "Area corrected" : "Public summary corrected";
        const reason = str(p.reason);
        return {
          title: area && heading ? `${what}: ${heading}` : what,
          actor: who,
          bodyLabel: str(p.publicSummary) ? "Public summary" : undefined,
          body: str(p.publicSummary) ?? undefined,
          note: reason ? { label: "Why", text: reason } : undefined,
          statusChange,
          tone: "default",
        };
      }
      return {
        // The report heading verbatim after a colon (it is sentence case: "The built environment").
        title: isArea(p.priorityArea) ? `Triaged: ${AREA_HEADINGS[p.priorityArea].canonical}` : "Triaged",
        actor: who,
        bodyLabel: str(p.publicSummary) ? "Public summary" : undefined,
        body: str(p.publicSummary) ?? undefined,
        statusChange,
        tone: "default",
      };
    }
    case "assigned": {
      // D8: the due date set with the assignment (an ISO instant: the last moment of that day), when there is one.
      const due = str(p.dueAt) ? new Date(p.dueAt as string) : null;
      return {
        title: `Assigned to ${v.memberName(str(p.memberId)) ?? "a team member"}`,
        actor: who,
        bodyLabel: due && !Number.isNaN(due.getTime()) ? "Due date" : undefined,
        body: due && !Number.isNaN(due.getTime()) ? formatDateLong(due) : undefined,
        statusChange,
        tone: "default",
      };
    }
    case "fix_logged":
      return {
        title: `Fix logged by ${who}`,
        bodyLabel: str(p.description) ? "What they fixed" : undefined,
        body: str(p.description) ?? undefined,
        link: typeof p.evidenceUrl === "string" && /^https?:\/\//i.test(p.evidenceUrl) ? p.evidenceUrl : undefined,
        statusChange,
        tone: "default",
      };
    case "retest_requested":
      return { title: `Re-test requested (round ${num(p.round) ?? 1})`, actor: who, tone: "info" };
    case "retest_verdict": {
      const verdict = String(p.verdict);
      return {
        title: `The reporter answered: ${VERDICT_LABELS[verdict] ?? "an answer"} (round ${num(p.round) ?? 1})`,
        ...leadOnly("Their comment", str(p.comment)),
        statusChange,
        tone: verdict === "fixed" ? "success" : verdict === "cant_check" ? "default" : "warning",
      };
    }
    case "opted_out":
      return { title: "Reporter asked not to be contacted", statusChange, tone: "default" };
    case "note_added": {
      if (e.actorKind === "reporter") return { title: "The reporter added a note", ...leadOnly("Their note", str(p.note)), tone: "default" };
      // Phase 7 T2 item 4: a staff note is internal, or an interim accommodation (what the person was offered
      // meanwhile), which gets its own label. A note from before Phase 7 has no kind.
      if (e.actorKind === "staff" && isNoteKind(p.kind)) {
        const interim = p.kind === "interim_accommodation";
        return {
          title: `${NOTE_KIND_LABELS[p.kind]} added by ${who}`,
          bodyLabel: str(p.note) ? (interim ? "Offered meanwhile" : "Note") : undefined,
          body: str(p.note) ?? undefined,
          tone: interim ? "info" : "default",
        };
      }
      return { title: `Note added by ${who}`, bodyLabel: str(p.note) ? "Note" : undefined, body: str(p.note) ?? undefined, tone: "default" };
    }
    case "reopened":
      return {
        title: `Reopened by ${who}`,
        bodyLabel: str(p.reason) ? "Why" : undefined,
        body: str(p.reason) ?? undefined,
        statusChange,
        tone: "warning",
      };
    case "closed": {
      // Phase 7 T2 item 8: a duplicate names its original (same org). Only a viewer who opens every case reads its ref.
      const original = p.reason === "duplicate" ? duplicateOfPayload(p) : null;
      const named = original && v.seesOtherCases ? original : null;
      return {
        title: named
          ? `Closed: duplicate of ${named.ref}`
          : `Closed: ${isClosedReason(p.reason) ? CLOSED_REASON_STAFF_LABELS[p.reason].toLowerCase() : "no reason given"}`,
        actor: who,
        bodyLabel: str(p.note) ? "Note" : undefined,
        body: str(p.note) ?? undefined,
        caseLink: named ? { label: "Original case", ref: named.ref } : undefined,
        statusChange,
        tone: "default",
      };
    }
    case "retest_expired":
      // D3: the lead stopped waiting (14 days or more), or the system closed the round after 60 days.
      if (p.reason === "reporter_unreachable") {
        return {
          title: `Stopped waiting for the reporter after ${plural(num(p.afterDays) ?? 14, "day")}: reporter unreachable`,
          actor: who,
          body: "The fix counts as not verified by the reporter.",
          statusChange,
          tone: "default",
        };
      }
      return { title: `Re-test closed with no answer after ${num(p.afterDays) ?? 60} days`, statusChange, tone: "default" };
    case "message_sent": {
      const round = num(p.round);
      return {
        title: messageTitle(p.template, p.status),
        actor: who,
        body: round !== null ? `Re-test round ${round}.` : undefined,
        tone: p.status === "failed" ? "danger" : "default",
      };
    }
    default:
      return { title: `Event: ${e.type.replace(/_/g, " ")}`, actor: who, tone: "default" };
  }
}
