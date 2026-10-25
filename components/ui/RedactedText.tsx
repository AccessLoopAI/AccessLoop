import { Fragment } from "react";
import { cx } from "./cx";

// The [TYPE] tokens that layer-1 redaction and review put in place of personal details
// (lib/redaction/patterns.ts PiiType).
const TOKEN = /\[(EMAIL|PHONE|SIN|POSTAL_CODE|HEALTH_CARD|ACCOUNT_NUMBER|STREET_ADDRESS|URL|PERSON|STAFF_NAME|DOB|QUASI_ID|OTHER_ID)\]/g;

interface RedactedTextProps {
  /** Already-redacted text (cases.redactedText, summaries). Never pass original text here. */
  text: string;
  /** "p" (default) for a paragraph; "span" for a piece inside a sentence (e.g. the words around one token). */
  as?: "p" | "span";
  className?: string;
}

/**
 * Redacted text with each [TYPE] token highlighted (colour + dashed underline + the token itself, never
 * colour alone). The token text is kept, so screen readers read "[PERSON]" and e2e can match it.
 * `wrap-anywhere` (overflow-wrap: anywhere, which, unlike break-word, also lowers the min-content width), so a long
 * token that survives redaction (a file name, a URL) wraps at 320px instead of widening a grid track and the page.
 */
export function RedactedText({ text, as: Tag = "p", className }: RedactedTextProps) {
  const parts: { text: string; token: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), token: false });
    parts.push({ text: m[0], token: true });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), token: false });
  return (
    <Tag className={cx(Tag === "p" ? "max-w-[var(--measure)] whitespace-pre-wrap wrap-anywhere" : "whitespace-pre-wrap wrap-anywhere", className)}>
      {parts.map((p, i) =>
        p.token ? (
          <mark key={i} className="al-redact">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </Tag>
  );
}
