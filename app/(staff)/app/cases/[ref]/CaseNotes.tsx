// The "Notes" card of the staff case page (docs/phase7-prompt.md T2 item 4): the case's internal notes and interim
// accommodations, newest first, and "Add a note" for the lead and the owner the case is assigned to. Every note is
// also a line in the History (lib/cases/history.ts), where it sits in the evidence chain. For staff only: the
// reporter's page never reads notes. Server component; the form is the client NoteForm.
import { HandHeart, NotebookPen } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { RedactedText } from "@/components/ui/RedactedText";
import { NOTE_KIND_LABELS, type StaffNote } from "@/lib/cases/notes";
import { cx } from "@/components/ui/cx";
import { formatDateTime } from "@/lib/format";
import { NoteForm } from "./CaseForms";

export function CaseNotes({
  caseRef,
  notes,
  memberName,
  canAdd,
}: {
  caseRef: string;
  notes: StaffNote[];
  memberName: (id: string | null | undefined) => string | null;
  canAdd: boolean;
}) {
  if (!notes.length && !canAdd) return null;
  return (
    <Card
      as="section"
      id="notes"
      title="Notes"
      description="Internal notes and interim accommodations, newest first. For staff only: the reporter never sees them."
    >
      <div className="grid gap-6">
        {notes.length ? (
          <ul className="m-0 grid list-none gap-4 p-0">
            {notes.map((n) => {
              const interim = n.kind === "interim_accommodation";
              return (
                <li
                  key={n.seq}
                  className={cx("grid gap-1 border-l-4 pl-3", interim ? "border-info" : "border-border-strong")}
                  data-note-kind={n.kind}
                >
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
                    <span className={cx("inline-flex items-center gap-1.5 font-bold", interim ? "text-info" : undefined)}>
                      <Icon icon={interim ? HandHeart : NotebookPen} size="1.1em" />
                      <span>{NOTE_KIND_LABELS[n.kind]}</span>
                    </span>
                    <span className="text-ink-muted">
                      {memberName(n.actorId) ?? "A staff member"}, <time dateTime={n.at.toISOString()}>{formatDateTime(n.at)}</time>
                    </span>
                  </p>
                  <RedactedText text={n.text} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-ink-muted">No notes yet.</p>
        )}
        {canAdd ? (
          <div className="border-t border-border pt-6">
            <NoteForm caseRef={caseRef} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
