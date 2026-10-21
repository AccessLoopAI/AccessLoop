// The "fake" AI backend (FAKE_LLM=1 or AI_BACKEND=fake): canned answers from lib/ai/fakes/*.json, following
// the matching rules in each file's `_doc`. Deterministic and offline. Used by tests, CI, e2e and the
// offline demo. Answers still go through the zod schemas and the shared checks in lib/ai/core.ts, exactly like a
// real model's would.
import structureFakes from "../fakes/structure.json";
import flagPiiFakes from "../fakes/flag-pii.json";
import { sha256Hex } from "@/lib/crypto";
import { fillClaimTemplate } from "../claims";
import {
  FlagPiiOutputSchema,
  PhraseClaimsOutputSchema,
  StructureOutputSchema,
  type Claim,
  type FlagPiiOutput,
  type PhraseClaimsOutput,
  type StructureOutput,
} from "../schemas";

/** What the fake returns before lib/ai/core.ts adds the timing. */
export interface BackendAnswer<T> {
  value: T;
  model: string;
  promptSha: string;
}

export const FAKE_MODEL = "fake";

// For the fake backend, "promptSha" is the sha256 of the fake data that produced the answer, so a
// changed fakes file shows up in the event log like a changed prompt would.
const STRUCTURE_SHA = sha256Hex(JSON.stringify(structureFakes));
const FLAG_PII_SHA = sha256Hex(JSON.stringify(flagPiiFakes));
// phraseClaims has no fakes file: the fake fills each claim's template with its slot values.
const PHRASE_CLAIMS_SHA = sha256Hex("fake:phrase-claims:fill-template:v1");

/** structure.json `_doc`: the FIRST entry whose `match` is a case-insensitive substring of the masked text wins; else `fallback`. */
export function fakeStructure(maskedText: string): BackendAnswer<StructureOutput> {
  const haystack = maskedText.toLowerCase();
  const hit = structureFakes.entries.find((e) => haystack.includes(e.match.toLowerCase()));
  return {
    value: StructureOutputSchema.parse(hit ? hit.output : structureFakes.fallback),
    model: FAKE_MODEL,
    promptSha: STRUCTURE_SHA,
  };
}

/** flag-pii.json `_doc`: EVERY entry whose `match` is a case-sensitive substring of the masked text contributes its items. */
export function fakeFlagPii(maskedText: string): BackendAnswer<FlagPiiOutput> {
  const items = flagPiiFakes.entries.filter((e) => maskedText.includes(e.match)).flatMap((e) => e.items);
  return { value: FlagPiiOutputSchema.parse({ items }), model: FAKE_MODEL, promptSha: FLAG_PII_SHA };
}

/** One sentence per claim: the template with every {slot} replaced by its value (no rewording). */
export function fakePhraseClaims(claims: Claim[]): BackendAnswer<PhraseClaimsOutput> {
  const out = claims.map((c) => ({ claimId: c.claimId, text: fillClaimTemplate(c) }));
  return { value: PhraseClaimsOutputSchema.parse(out), model: FAKE_MODEL, promptSha: PHRASE_CLAIMS_SHA };
}
