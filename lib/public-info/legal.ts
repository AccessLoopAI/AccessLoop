// Legal text quoted on public pages, copied word for word from docs/domain.md §1.3 (retrieved 2026-10-18 from the
// Justice Laws website). domain.md: "Do not paraphrase them in code; copy them from here."

/** ACR s.19 (retention), verbatim. */
export const ACR_S19 =
  "A regulated entity must retain an electronic copy or print copy of any feedback it receives under section 9 for a period of seven years beginning on the day on which it is received.";

/** The Accessible Canada Regulations (SOR/2021-241) on the Justice Laws website (domain.md §1 sources). */
export const ACR_URL = "https://laws-lois.justice.gc.ca/eng/regulations/SOR-2021-241/FullText.html";

/** The source line under the s.19 quote on /trust (the link text names the section). */
export const ACR_SOURCE = { href: ACR_URL, label: "Accessible Canada Regulations, section 19" } as const;
