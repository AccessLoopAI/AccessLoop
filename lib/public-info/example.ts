// The made-up report that /trust follows step by step ("The path your words take"). It lives here, not in the page,
// so tests/public-info.test.ts can hold it to the real pipeline: `afterRules` must be exactly what layer 1
// (lib/redaction/patterns.ts) makes of `written`, and `afterAi` exactly what layers 1 + 2 make of it when layer 2
// flags the name. The summary is in the second person, like structure()'s (domain §6).
export const TRUST_EXAMPLE = {
  written: "My name is Sam Lee. The ramp at the Elm Road branch is too steep for my wheelchair. Call me at 416-555-0142.",
  afterRules: "My name is Sam Lee. The ramp at the Elm Road branch is too steep for my wheelchair. Call me at [PHONE].",
  afterAi: "My name is [PERSON]. The ramp at the Elm Road branch is too steep for my wheelchair. Call me at [PHONE].",
  /** What layer 2 (flagPii) would answer for `afterRules`: exact substrings only. */
  aiFound: [{ text: "Sam Lee", type: "PERSON" as const, reason: "A person's name" }],
  summary: "The ramp at the branch is too steep for you to use with your wheelchair.",
  /** A receipt code shape for the page (Crockford base32, 4 groups of 4). It belongs to no case. */
  sampleCode: "7K3M-9Q2D-XW4H-B8RT",
} as const;
