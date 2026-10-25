// Deterministic claim wording (docs/domain.md §7 steps 3-5): a claim's template with every {slot} replaced by its value.
// It is the fake backend's phraseClaims answer AND the fallback for any phrased sentence that drops a slot value, or
// for a whole phraseClaims call that fails. Pure.
import type { Claim } from "./schemas";

const SLOT = /\{(\w+)\}/g;

/** The template with each known {slot} filled in. Unknown slots stay visible, so the report validator rejects them. */
export function fillClaimTemplate(claim: Pick<Claim, "template" | "slots">): string {
  return claim.template.replace(SLOT, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(claim.slots, key) ? String(claim.slots[key]) : whole,
  );
}

/** The slot values a sentence for this claim must contain: those its template actually uses. */
export function usedSlotValues(claim: Pick<Claim, "template" | "slots">): string[] {
  const out: string[] = [];
  for (const m of claim.template.matchAll(SLOT)) {
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(claim.slots, key)) out.push(String(claim.slots[key]));
  }
  return out;
}

/** domain §7 step 4: phrasing "must keep every slot value". */
export function keepsEverySlotValue(claim: Pick<Claim, "template" | "slots">, text: string): boolean {
  return usedSlotValues(claim).every((v) => text.includes(v));
}
