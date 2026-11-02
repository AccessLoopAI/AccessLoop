// CAN-ASC-5.2.1:2026 Accessible Service Delivery, clause 17 "Feedback" (docs/archive/phase7-prompt.md T6 item 5): the four
// steps the clause names (receive, acknowledge, address, respond), each mapped to a count the dashboard already has
// from lib/metrics, with the cases behind it. Pure and client-safe. No number is computed here: each step picks an
// existing CaseSet or RoundSet of DashboardMetrics. The panel says what the records show for each step; it never
// says the organization meets, or is "compliant" with, the standard.
import { inboxHref, type CaseSet, type DashboardMetrics, type RoundSet } from "@/lib/metrics";

/** The standard's page for clause 17 (Accessibility Standards Canada, published May 2026; read 2026-10-20). */
export const CLAUSE_17_URL =
  "https://accessible.canada.ca/standards-and-technical-guides/standards-and-technical-guides-database/can-asc-5212026-accessible-service-delivery/17-feedback";

/** The one line quoted from the clause (11 words; the rest of the panel is ours). */
export const CLAUSE_17_QUOTE = "establish a process for receiving, acknowledging, addressing, and responding to feedback";

export const CLAUSE_17_SOURCE = "CAN-ASC-5.2.1:2026 Accessible Service Delivery, clause 17";

export type Clause17Key = "receive" | "acknowledge" | "address" | "respond";

export interface Clause17Step {
  key: Clause17Key;
  /** The clause's verb, as the step's name. */
  name: string;
  /** The count shown. */
  count: number;
  /** "of N" context, when the count is part of a whole. */
  of: number | null;
  /** What the count is, in words, after the number ("pieces of feedback received"). */
  what: string;
  /** Which records AccessLoop counts for this step (the "What is counted" line). */
  counted: string;
  /** The inbox filtered to exactly the cases behind the count; null for a zero. */
  href: string | null;
}

const countOf = (set: CaseSet | RoundSet) => ("rounds" in set ? set.rounds : set.count);
const link = (set: CaseSet | RoundSet) => (countOf(set) > 0 && set.caseIds.length > 0 ? inboxHref(set.filter) : null);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The four steps for the dashboard's period, in the clause's order. */
export function clause17Steps(m: Pick<DashboardMetrics, "total" | "acknowledgement" | "funnel" | "retestResponse">): Clause17Step[] {
  const total = m.total.total;
  const ack = m.acknowledgement;
  const fixed = m.funnel.fixLogged;
  const asked = m.retestResponse.requested;
  return [
    {
      key: "receive",
      name: "Receive",
      count: total.count,
      of: null,
      what: plural(total.count, "piece of feedback received", "pieces of feedback received"),
      counted: "Every report received in this period, whichever way it came in: the online form, and what staff logged from email, phone, mail or in person. Spam is left out.",
      href: link(total),
    },
    {
      key: "acknowledge",
      name: "Acknowledge",
      count: ack.acknowledged.count,
      of: ack.required.count,
      what: plural(ack.required.count, "non-anonymous report acknowledged the way it came in", "non-anonymous reports acknowledged the way they came in"),
      counted: "An acknowledgement recorded in the same way the report came in (ACR s.9(4)): the receipt on screen, an email, or a call or letter staff recorded. Anonymous reports still see their receipt.",
      href: link(ack.acknowledged),
    },
    {
      key: "address",
      name: "Address",
      count: fixed.count,
      of: total.count,
      what: plural(total.count, "report with a fix logged", "reports with a fix logged"),
      counted: "A fix was logged for the barrier (the loop funnel's “Fix logged”). Reports still being worked on, or closed without a change, are not counted here.",
      href: link(fixed),
    },
    {
      key: "respond",
      name: "Respond",
      count: asked.rounds,
      of: null,
      what: plural(asked.rounds, "time we went back to the person to check the fix", "times we went back to the person to check the fix"),
      counted: "Each request to the person who reported a barrier to check its fix (the re-test). Anyone can also see where their report stands at any time with their code.",
      href: link(asked),
    },
  ];
}
