import { RedactedText } from "./RedactedText";

/**
 * A sample of report text at one stage, with a caption that says which stage ("After the rules"): the worked example
 * on /trust. The text goes through RedactedText, so each `[TYPE]` label is marked the same way staff see it. Only
 * ever made-up text: never pass a real report.
 */
export function TextSpecimen({ caption, text }: { caption: string; text: string }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-surface px-4 py-3">
      <p className="text-small font-bold text-ink-muted">{caption}</p>
      <RedactedText text={text} />
    </div>
  );
}
