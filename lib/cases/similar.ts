// Server-only. "Similar past barriers" on the staff case page (docs/domain.md §6.2; docs/archive/phase7-prompt.md T2 item 10).
// - Candidates (similarCandidates): the same org, the same priority area, the same kind of place, received in the last
//   24 months, never this case, never a submission closed as spam (not accessibility feedback), only cases with a
//   lead-approved public summary; the 40 newest. Inside the caller's withOrg() (RLS), and the org is in the WHERE too.
// - The AI (lib/ai/similar.ts) reads only those public summaries and this case's own, and may only name candidates;
//   an answer that names anything else is dropped. It changes nothing: no event, no link, no merge, no close.
// - "Don't use AI on my report" (domain §4: no further AI call is made for it) holds here too (review finding,
//   docs/decisions.md 2026-10-21): an opted-out case gets no AI suggestion at all (the table stays), and an opted-out
//   candidate is listed in the table but never sent to the AI.
// - Lead only (the page shows the panel to leads; the server action checks again). The case is always looked up by
//   ref inside the signed-in org.
// Nothing here logs case text: a failed AI call is logged by its error class only.
import { and, desc, eq, gte, isNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { cases } from "@/db/schema";
import type { AiContext } from "@/lib/ai/context";
import { similarBarriersOrNull, SIMILAR_MAX_CANDIDATES, type SimilarBarriersOutput } from "@/lib/ai/similar";
import type { AiBackendName } from "@/lib/ai/backend";
import type { AiResult } from "@/lib/ai/types";
import { formatDateLong } from "@/lib/format";
import type { CaseStatus, ClosedReason } from "@/lib/status";

/** "last 24 months" (the brief). */
export const SIMILAR_WINDOW_MONTHS = 24;

/** The earliest received date a candidate may have: `now` minus 24 calendar months (UTC). */
export function similarWindowStart(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - SIMILAR_WINDOW_MONTHS);
  return d;
}

/** The case the panel is about: the fields the candidate query and the AI need. */
export interface SimilarSubject {
  id: string;
  orgId: string;
  priorityArea: (typeof cases.$inferSelect)["priorityArea"];
  locationKind: (typeof cases.$inferSelect)["locationKind"];
  publicSummary: string | null;
  /** The reporter chose "Don't use AI on my report": no AI call is made for this case. */
  aiOptOut: boolean;
}

/** Ready once the lead set an area and wrote a public summary (at triage): only then is there something to compare. */
export function similarReady(c: Pick<SimilarSubject, "priorityArea" | "publicSummary">): boolean {
  return c.priorityArea !== null && (c.publicSummary ?? "").trim() !== "";
}

export interface SimilarCandidateRow {
  id: string;
  ref: string;
  status: CaseStatus;
  closedReason: ClosedReason | null;
  publicSummary: string;
  receivedAt: Date;
  /** Its reporter chose "Don't use AI on my report": listed for the lead, never sent to the AI. */
  aiOptOut: boolean;
}

/** The candidates the AI may read: never one whose reporter chose "Don't use AI on my report". */
export function aiCandidates<T extends Pick<SimilarCandidateRow, "aiOptOut">>(candidates: readonly T[]): T[] {
  return candidates.filter((c) => !c.aiOptOut);
}

/** The candidates for `subject`, newest first, at most SIMILAR_MAX_CANDIDATES. [] when it has no area yet. */
export async function similarCandidates(tx: Tx, subject: SimilarSubject, now: Date = new Date()): Promise<SimilarCandidateRow[]> {
  if (!subject.priorityArea) return [];
  const rows = await tx
    .select({
      id: cases.id,
      ref: cases.ref,
      status: cases.status,
      closedReason: cases.closedReason,
      publicSummary: cases.publicSummary,
      receivedAt: cases.receivedAt,
      aiOptOut: cases.aiOptOut,
    })
    .from(cases)
    .where(
      and(
        eq(cases.orgId, subject.orgId),
        ne(cases.id, subject.id),
        eq(cases.priorityArea, subject.priorityArea),
        eq(cases.locationKind, subject.locationKind),
        gte(cases.receivedAt, similarWindowStart(now)),
        sql`btrim(coalesce(${cases.publicSummary}, '')) <> ''`,
        or(isNull(cases.closedReason), ne(cases.closedReason, "spam")),
      ),
    )
    .orderBy(desc(cases.receivedAt), desc(cases.seq))
    .limit(SIMILAR_MAX_CANDIDATES);
  return rows.map((r) => ({ ...r, publicSummary: r.publicSummary ?? "" }));
}

/** Who answered, in the case page's words (the same words as its "AI" detail). */
export const SIMILAR_AI_WORDS: Record<AiBackendName, string> = {
  fake: "simulated AI, for testing",
  "claude-cli": "the team's local Claude CLI",
  api: "Claude API",
};

/** One suggestion as the page shows it. Dates are formatted on the server (one display time zone, lib/format.ts). */
export interface SimilarShown {
  ref: string;
  status: CaseStatus;
  closedReason: ClosedReason | null;
  publicSummary: string;
  receivedAt: string;
  receivedLabel: string;
  /** The AI's one sentence on what the two have in common (layer-1 masked). */
  reason: string;
}

/** What the "Find similar past barriers" action answers (client-safe shape: plain data only). */
export type SimilarFindResult =
  | { ok: true; kind: "matches"; matches: SimilarShown[]; checked: number; aiWords: string; message: string; at: number }
  | { ok: true; kind: "none"; checked: number; aiWords: string | null; message: string; at: number }
  | { ok: false; message: string; at: number };

const casesWord = (n: number) => (n === 1 ? "1 case" : `${n} cases`);

export const SIMILAR_MESSAGES = {
  notReady: "This case needs an area and a public summary first. Triage it, then look for similar past barriers.",
  aiOptOut:
    "The person who reported this chose not to use AI on their report, so AccessLoop does not ask the AI about it. Nothing was changed. You can still read the cases with the same area and place below.",
  noAiCandidates: (listed: number) =>
    `The people who reported the ${casesWord(listed)} with the same area and place chose not to use AI on their reports, so the AI has nothing to read. Nothing was changed. You can still read them below.`,
  noCandidates: "No other case from the last 24 months has the same area and place, so there is nothing to compare.",
  unavailable: (checked: number) =>
    `The AI suggestion isn't available right now. Nothing was changed. You can still read the ${casesWord(checked)} with the same area and place below.`,
  none: (checked: number) =>
    `The AI found no past case that looks like the same barrier among the ${casesWord(checked)} it read. Nothing was changed.`,
  found: (n: number) =>
    `The AI suggests ${n === 1 ? "1 past case that may be" : `${n} past cases that may be`} the same barrier. Nothing was changed.`,
} as const;

/**
 * Ask the AI about `subject` (already looked up by ref in the lead's org) and its candidates, and shape the answer
 * for the page. `ai` is the call (similarBarriersOrNull by default; tests pass a stub). Call it OUTSIDE any
 * transaction: a claude-cli call may take up to 60 s.
 */
export async function suggestSimilar(
  subject: SimilarSubject,
  candidates: readonly SimilarCandidateRow[],
  ctx: AiContext | undefined,
  ai: (
    q: Parameters<typeof similarBarriersOrNull>[0],
    ctx: AiContext | undefined,
    onError: (err: unknown) => void,
  ) => Promise<AiResult<SimilarBarriersOutput> | null> = similarBarriersOrNull,
  at: number = Date.now(),
): Promise<SimilarFindResult> {
  if (!subject.priorityArea || !similarReady(subject)) return { ok: false, message: SIMILAR_MESSAGES.notReady, at };
  if (subject.aiOptOut) return { ok: false, message: SIMILAR_MESSAGES.aiOptOut, at };
  if (candidates.length === 0) return { ok: true, kind: "none", checked: 0, aiWords: null, message: SIMILAR_MESSAGES.noCandidates, at };
  const readable = aiCandidates(candidates);
  if (readable.length === 0) {
    return { ok: true, kind: "none", checked: 0, aiWords: null, message: SIMILAR_MESSAGES.noAiCandidates(candidates.length), at };
  }
  const r = await ai(
    {
      summary: subject.publicSummary ?? "",
      area: subject.priorityArea,
      locationKind: subject.locationKind,
      candidates: readable.map((c) => ({ ref: c.ref, summary: c.publicSummary })),
    },
    ctx,
    (err) => console.error(`[case] similar past barriers: no AI suggestion (${err instanceof Error ? err.name : "UnknownError"})`),
  );
  const checked = Math.min(readable.length, SIMILAR_MAX_CANDIDATES);
  if (!r) return { ok: false, message: SIMILAR_MESSAGES.unavailable(candidates.length), at };
  const byRef = new Map(readable.map((c) => [c.ref, c]));
  const matches: SimilarShown[] = [];
  for (const m of r.value.matches) {
    const c = byRef.get(m.ref);
    if (!c) continue; // cannot happen: lib/ai/similar.ts dropped any answer naming a non-candidate
    matches.push({
      ref: c.ref,
      status: c.status,
      closedReason: c.closedReason,
      publicSummary: c.publicSummary,
      receivedAt: c.receivedAt.toISOString(),
      receivedLabel: formatDateLong(c.receivedAt),
      reason: m.reason,
    });
  }
  const aiWords = SIMILAR_AI_WORDS[r.meta.backend];
  if (matches.length === 0) return { ok: true, kind: "none", checked, aiWords, message: SIMILAR_MESSAGES.none(checked), at };
  return { ok: true, kind: "matches", matches, checked, aiWords, message: SIMILAR_MESSAGES.found(matches.length), at };
}
