// The AI wording step of a report (docs/domain.md §7 step 4). phraseClaims may only rewrite for plain language; the
// validator (lib/report/validate.ts) then decides sentence by sentence. Rules:
//   - Call it OUTSIDE any database transaction (claude-cli can take up to 60 s).
//   - Any AiError (not allowed here, timeout, call failed, bad output, backend unavailable) means the domain's own
//     fallback: every sentence uses its template, and the draft says so. Templates are not another backend.
//   - AiConfigError (AI_BACKEND holds an unknown value) is rethrown: a configuration mistake stays loud.
//   - Anything else (a bug) is rethrown.
// Only the error's class name is kept, never its message context, claim text or model output. Server-only.
import type { AiContext } from "@/lib/ai/context";
import { isAiError } from "@/lib/ai/errors";
import type { Claim, PhraseClaimsOutput } from "@/lib/ai/schemas";
import type { AiResult } from "@/lib/ai/types";
import type { PhraseMeta } from "./types";

export type PhraseClaimsFn = (claims: Claim[], ctx?: AiContext) => Promise<AiResult<PhraseClaimsOutput>>;

export interface PhraseOutcome {
  /** null: phrasing failed, use every claim's template. */
  sentences: PhraseClaimsOutput | null;
  meta: Omit<PhraseMeta, "fallbacks">;
}

const CASE_CLAIM = "C:F_CASE:"; // CLAIM.case(ref) in ./claims

/** The refs of the cases that have their own sentence (one F_CASE claim per verified or fixed case). */
export function caseClaimRefs(claims: readonly Pick<Claim, "claimId">[]): string[] {
  return claims.filter((c) => c.claimId.startsWith(CASE_CLAIM)).map((c) => c.claimId.slice(CASE_CLAIM.length));
}

/**
 * The claims the AI may reword. domain §4: once a reporter chose "Don't use AI on my report", no further AI call is
 * made for that case, so its own sentence (it quotes the case's public summary) keeps the template and is never
 * sent (review finding, docs/decisions.md 2026-10-21). Sentences about counts cite many cases and carry no case text.
 */
export function claimsForAi<T extends Pick<Claim, "claimId">>(claims: readonly T[], aiOptedOutRefs: ReadonlySet<string>): T[] {
  return claims.filter((c) => !(c.claimId.startsWith(CASE_CLAIM) && aiOptedOutRefs.has(c.claimId.slice(CASE_CLAIM.length))));
}

export async function phraseOrTemplates(claims: Claim[], ctx: AiContext | undefined, phrase: PhraseClaimsFn): Promise<PhraseOutcome> {
  try {
    const r = await phrase(claims, ctx);
    return {
      sentences: r.value,
      meta: { ok: true, backend: r.meta.backend, model: r.meta.model, promptSha: r.meta.promptSha, latencyMs: r.meta.latencyMs },
    };
  } catch (err) {
    if (!isAiError(err) || err.name === "AiConfigError") throw err;
    return { sentences: null, meta: { ok: false, backend: null, model: null, promptSha: null, latencyMs: null, error: err.name } };
  }
}
