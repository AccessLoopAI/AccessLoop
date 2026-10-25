// What the staff case page's server actions answer (client-safe types and the calm refusal sentences).
// Every action re-checks the signed-in member, their role and the case before it changes anything.
import type { AddedWords, ReviewView } from "./redaction-labels";

/** Field name -> error sentence ("Write a public summary."). Shown on the field and in the form's ErrorSummary. */
export type FieldErrors = Record<string, string>;

export type CaseActionResult =
  | { ok: true; message: string; at: number }
  | { ok: false; message: string; fieldErrors?: FieldErrors; at: number };

/** "Show original": the decrypted text lives only in the browser's memory after this, never in a cache. */
export type RevealResult =
  | { ok: true; text: string; email: string | null; contact: string | null; message: string; at: number }
  | { ok: false; message: string; at: number };

/** "Hide these words": a preview of the review with the words hidden. Nothing is saved until approval. */
export type HidePreviewResult =
  | { ok: true; review: ReviewView; added: AddedWords[]; message: string; at: number }
  | { ok: false; message: string; fieldErrors?: FieldErrors; at: number };

export const REFUSED = {
  notFound: "We can't find this case. Nothing was saved.",
  role: "Your role can't do this. Nothing was saved.",
  failed: "That didn't work just now. Nothing was saved. Please try again.",
  invalid: "Part of the form could not be read. Reload the page and try again.",
} as const;

/** The case moved on while the page was open (another tab, another lead): say where it is now. */
export function staleMessage(statusLabel: string): string {
  return `Nothing was saved: this case is now "${statusLabel}", so that step doesn't apply any more. The page now shows what you can do.`;
}
