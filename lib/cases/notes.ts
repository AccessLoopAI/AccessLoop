// Staff notes on a case (docs/phase7-prompt.md T2 item 4; docs/domain.md §3 "note_added"). Pure and client-safe:
// the case page lists them and the server action (app/(staff)/app/cases/[ref]/actions.ts addNote) writes them.
// A note is a `note_added` event written with appendCaseEvent (the log is append-only, so a note is never edited):
// { kind: "internal" | "interim_accommodation", note } with the text layer-1 redacted first (CLAUDE.md "Security
// rules"). Staff notes are for staff: the reporter's page never reads them, and no metric or report counts them.
import { applyRedaction, detectPatterns } from "@/lib/redaction/patterns";

export const NOTE_KINDS = ["internal", "interim_accommodation"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** The kind's label, wherever a note is shown (the Notes card, the History). */
export const NOTE_KIND_LABELS: Record<NoteKind, string> = {
  internal: "Internal note",
  interim_accommodation: "Interim accommodation",
};

export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === "string" && (NOTE_KINDS as readonly string[]).includes(v);
}

/** Free text goes into the immutable log, so layer-1 redaction (emails, phone numbers, ...) runs on it first. */
export function scrubNote(text: string): string {
  const t = text.trim();
  return applyRedaction(t, detectPatterns(t));
}

export interface StaffNote {
  seq: number;
  kind: NoteKind;
  text: string;
  actorId: string | null;
  at: Date;
}

/**
 * The staff notes of a case, newest first. A reporter's note (the comment they left when they asked not to be
 * contacted) is not a staff note: it stays in the History, where only the lead reads it. A staff note from before
 * Phase 7 without a kind is an internal note.
 */
export function staffNotes(
  events: readonly { seq: number; type: string; actorKind: string; actorId: string | null; payload: Record<string, unknown>; createdAt: Date }[],
): StaffNote[] {
  return events
    .filter((e) => e.type === "note_added" && e.actorKind === "staff" && typeof e.payload.note === "string" && e.payload.note.trim())
    .map((e) => ({
      seq: e.seq,
      kind: isNoteKind(e.payload.kind) ? e.payload.kind : "internal",
      text: String(e.payload.note),
      actorId: e.actorId,
      at: e.createdAt,
    }))
    .sort((a, b) => b.seq - a.seq);
}
