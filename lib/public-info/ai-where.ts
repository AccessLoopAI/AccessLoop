// The one sentence the report form shows at the point of collection (docs/phase7-prompt.md Wave 4 item 1; docs/domain.md
// §4): where the reporter's words go when the AI is on, true for THIS running copy. It sits in the AI notice on step 3
// (the summary is made when the person presses Next there) and under "Don't use AI on my report" on the review.
//
// Pure: it takes only which of describeThisCopy()'s fixed cases applies (lib/public-info/this-copy.ts) and never an env
// value. Truthful per backend: Anthropic is a company in the United States (/trust "Services we plan to use" has where
// its data is kept and processed); only contact details and ID numbers (layer 1) are taken out before any AI reads the
// words, since finding names is the AI's own job (/trust step 3). Grade 6-8 words; never "compliant", "certified" or
// "guarantees".
import type { ThisCopy } from "./this-copy";

export const AI_WHERE: Readonly<Record<"api" | "claude-cli" | "simulated_here" | "simulated" | "misconfigured", string>> = {
  api: "When AI is on, your words go to Anthropic, an AI company in the United States, after we take out contact details and ID numbers.",
  "claude-cli":
    "This test copy uses our team's own Claude account, so your words go to Anthropic, an AI company in the United States, after we take out contact details and ID numbers.",
  simulated_here: "In this copy the AI is simulated with ready-made answers, so your words don't leave this computer.",
  simulated: "In this copy the AI is simulated with ready-made answers, so your words are not sent to any AI company.",
  misconfigured: "AI is not working in this copy, so your words are not sent to any AI company.",
};

/** Where the words go when AI is on, for this copy's AI setting (and, for simulated AI, where its database is). */
export function aiWhereSentence(copy: Pick<ThisCopy, "ai" | "storage">): string {
  switch (copy.ai) {
    case "api":
      return AI_WHERE.api;
    case "claude-cli":
      return AI_WHERE["claude-cli"];
    case "simulated":
      // "this computer" only when the server's database is on a loopback host (the local prototype); a hosted copy
      // with simulated AI (a preview deployment) still sends the words to its host, just to no AI company.
      return copy.storage === "this_computer" ? AI_WHERE.simulated_here : AI_WHERE.simulated;
    case "misconfigured":
      return AI_WHERE.misconfigured;
  }
}
