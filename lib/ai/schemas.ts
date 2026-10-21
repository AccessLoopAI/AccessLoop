// zod output schemas of the three AI functions (docs/domain.md §6). Every backend's answer is parsed with
// these, so a model can never hand the app a shape it does not expect. lib/ai/requests.ts builds the JSON
// schemas for the claude-cli and api backends from the same objects (z.toJSONSchema).
import { z } from "zod";

/** ACA s.5 (a)-(f) incl. (c.1): the canonical keys of the DB enum `priority_area` (domain §1.2). */
export const PRIORITY_AREAS = [
  "employment",
  "built_environment",
  "ict",
  "communication_other",
  "procurement",
  "programs_services",
  "transportation",
] as const;
export const PriorityAreaSchema = z.enum(PRIORITY_AREAS);
export type PriorityArea = z.infer<typeof PriorityAreaSchema>;

/** Longest summary we accept (domain §6: at most 2 plain sentences). */
export const SUMMARY_MAX = 400;

/** structure(maskedText, locationKind): a short second-person summary plus 1-3 areas with confidence. */
export const StructureOutputSchema = z.object({
  summary: z.string().min(1).max(SUMMARY_MAX),
  priorityAreas: z
    .array(z.object({ area: PriorityAreaSchema, confidence: z.number().min(0).max(1) }))
    .min(1)
    .max(3),
  uncertain: z.array(z.string()),
});
export type StructureOutput = z.infer<typeof StructureOutputSchema>;

/** The types the LLM redaction layer may report (layer 2, domain §5). Layer 1 types come from patterns. */
export const PII_ITEM_TYPES = ["PERSON", "STAFF_NAME", "DOB", "QUASI_ID", "OTHER_ID"] as const;
export type PiiItemType = (typeof PII_ITEM_TYPES)[number];

/** flagPii(maskedText): exact substrings only (no offsets, no rewritten text). */
export const PiiItemSchema = z.object({
  text: z.string().min(1),
  type: z.enum(PII_ITEM_TYPES),
  reason: z.string(),
});
export type PiiItem = z.infer<typeof PiiItemSchema>;

export const FlagPiiOutputSchema = z.object({ items: z.array(PiiItemSchema) });
export type FlagPiiOutput = z.infer<typeof FlagPiiOutputSchema>;

/** phraseClaims(claims): one plain-language sentence per compiled claim (domain §7, used from Phase 4). */
export const PhraseClaimsOutputSchema = z.array(z.object({ claimId: z.string().min(1), text: z.string().min(1) }));
export type PhraseClaimsOutput = z.infer<typeof PhraseClaimsOutputSchema>;

/**
 * What a MODEL returns for phraseClaims: the list wrapped in an object, because a tool's input_schema (api) and a
 * structured output (claude-cli --json-schema) must be JSON objects. lib/ai/core.ts unwraps `sentences`.
 */
export const PhraseClaimsWireSchema = z.object({ sentences: PhraseClaimsOutputSchema });

/** A compiled claim (domain §7 step 3). Slot values are the only numbers a phrased sentence may contain. */
export interface Claim {
  claimId: string;
  heading: string;
  /** e.g. "Of these, {verified} were fixed and confirmed by the person who reported them." */
  template: string;
  slots: Record<string, number | string>;
  factIds: string[];
}
