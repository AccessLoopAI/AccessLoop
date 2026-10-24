// Claims and their templates (docs/domain.md §7 step 3): each fact becomes one plain sentence with every number as
// a {slot}. Template texts contain NO digits at all; singular and plural words (was/were, piece/pieces, ...) are
// chosen here, from the slot values, so the AI never has to. The deterministic wording is lib/ai's
// fillClaimTemplate (the fake backend and every fallback use the same one). Pure.
import { fillClaimTemplate } from "@/lib/ai/claims";
import { AREA_HEADINGS, PRIORITY_AREAS, type PriorityArea } from "./headings";
import { FACT } from "./facts";
import type { Fact, ReportClaim, ReportSnapshot } from "./types";

/** The deterministic sentence of a claim: its template with every slot filled in. */
export const fillTemplate = fillClaimTemplate;

export const CLAIM = {
  total: "C:F_TOTAL",
  anon: "C:F_ANON",
  notFeedback: "C:F_NOT_FEEDBACK",
  outcome: "C:F_OUTCOME",
  outcomeRelayed: "C:F_OUTCOME:relayed",
  noneFixed: "C:F_OUTCOME:none_fixed",
  verifyTime: "C:F_VERIFY_TIME",
  ack: "C:F_ACK",
  retest: "C:F_RETEST",
  area: (a: PriorityArea) => `C:F_AREA:${a}`,
  case: (ref: string) => `C:F_CASE:${ref}`,
} as const;

const FEEDBACK = "Feedback";

/** The channel words, in the order a sentence lists them (domain §1.3 / ACR s.9(3) channels). */
const CHANNEL_WORDS = [
  ["web", "through our online form"],
  ["email", "by email"],
  ["phone", "by phone"],
  ["mail", "by mail"],
  ["in_person", "in person"],
  ["other", "in other ways"],
] as const;

const num = (f: Fact, key: string): number => {
  const v = f.values[key];
  return typeof v === "number" ? v : 0;
};
const one = (n: number) => n === 1;

/** "a, b and c" (the channel list) or "a, b, and c" / "a, and b" (the outcome clauses: long, with commas of their own). */
function joinList(parts: string[], serialComma = false): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]}${serialComma ? "," : ""} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}${serialComma ? "," : ""} and ${parts[parts.length - 1]}`;
}

/** "the built environment" for an area heading inside a sentence (ACA headings start with a common word). */
const inSentence = (heading: string) => heading.charAt(0).toLowerCase() + heading.slice(1);

/** A public summary as the end of a sentence: it keeps its own final punctuation, or gets a full stop. */
const endsSentence = (s: string) => /[.!?]["'’”)]*$/.test(s.trim());

function claim(place: ReportClaim["place"], claimId: string, heading: string, template: string, slots: Record<string, number | string>, factIds: string[]): ReportClaim {
  return { claimId, heading, template, slots, factIds, place };
}

/**
 * The claims of a report, in reading order: the Feedback claims (received, anonymous, outcomes, timing, follow-up,
 * then one per fixed case) and one "Feedback received in this area: N" per plan area. An area outside the plan
 * that received feedback gets a Feedback sentence instead. Only facts in the snapshot are cited.
 */
export function compileClaims(snapshot: Pick<ReportSnapshot, "facts">, org: { planAreas: readonly PriorityArea[] }): ReportClaim[] {
  const byId = new Map(snapshot.facts.map((f) => [f.id, f]));
  const plan = new Set(org.planAreas);
  const out: ReportClaim[] = [];

  const total = byId.get(FACT.total);
  const totalCount = total ? num(total, "total") : 0;

  // ---- Received, by channel ----
  if (total) {
    if (totalCount === 0) {
      out.push(claim("feedback:intro", CLAIM.total, FEEDBACK, "We received no feedback about accessibility in this reporting period.", {}, [FACT.total]));
    } else {
      const used = CHANNEL_WORDS.filter(([k]) => num(total, k) > 0);
      const pieces = one(totalCount) ? "piece" : "pieces";
      let template: string;
      const slots: Record<string, number> = { total: totalCount };
      if (used.length === 1) {
        template = `In this reporting period, we received {total} ${pieces} of feedback about accessibility, ${one(totalCount) ? "" : "all "}${used[0][1]}.`;
      } else {
        for (const [k] of used) slots[k] = num(total, k);
        template = `In this reporting period, we received {total} ${pieces} of feedback about accessibility: ${joinList(used.map(([k, words]) => `{${k}} ${words}`))}.`;
      }
      out.push(claim("feedback:intro", CLAIM.total, FEEDBACK, template, slots, [FACT.total]));
    }
  }

  // ---- Anonymous ----
  const anon = byId.get(FACT.anon);
  if (anon && totalCount > 0) {
    const n = num(anon, "anonymous");
    // Never start a sentence with a numeral: the number goes mid-sentence.
    out.push(
      n === 0
        ? claim("feedback:intro", CLAIM.anon, FEEDBACK, `None of ${one(totalCount) ? "it was" : "them were"} sent anonymously, which our feedback process always allows.`, {}, [FACT.anon])
        : one(totalCount)
          ? claim("feedback:intro", CLAIM.anon, FEEDBACK, "It was sent anonymously, which our feedback process always allows.", {}, [FACT.anon])
          : claim("feedback:intro", CLAIM.anon, FEEDBACK, "People chose to stay anonymous for {anonymous} of them, which our feedback process always allows.", { anonymous: n }, [FACT.anon]),
    );
  }

  // ---- Submissions that were not accessibility feedback (D6): never counted above, but never silently left out ----
  const nf = byId.get(FACT.notFeedback);
  if (nf && num(nf, "notFeedback") > 0) {
    const n = num(nf, "notFeedback");
    out.push(
      claim(
        "feedback:intro",
        CLAIM.notFeedback,
        FEEDBACK,
        one(n)
          ? "We also closed {notFeedback} submission as not accessibility feedback, so it is not counted in this section."
          : "We also closed {notFeedback} submissions as not accessibility feedback, so they are not counted in this section.",
        { notFeedback: n },
        [FACT.notFeedback],
      ),
    );
  }

  // ---- What happened to the feedback ----
  const outcome = byId.get(FACT.outcome);
  if (outcome && totalCount > 0) {
    const v = num(outcome, "verified");
    const u = num(outcome, "unverified");
    const o = num(outcome, "open");
    const c = num(outcome, "closed");
    const parts: string[] = [];
    const slots: Record<string, number> = {};
    const relayed = num(outcome, "verifiedViaStaffCode");
    if (v === 0) {
      parts.push(
        relayed > 0
          ? "none were confirmed by the person who reported them with a code only they held"
          : "none have been fixed and confirmed by the person who reported them yet",
      );
    } else {
      slots.verified = v;
      parts.push(`{verified} ${one(v) ? "was" : "were"} fixed and confirmed by the person who reported ${one(v) ? "it" : "them"}`);
    }
    if (u > 0) {
      slots.unverified = u;
      parts.push(`{unverified} ${one(u) ? "was" : "were"} fixed but not yet confirmed`);
    }
    if (o > 0) {
      slots.open = o;
      parts.push(`{open} ${one(o) ? "is" : "are"} still in progress`);
    }
    if (c > 0) {
      slots.closed = c;
      parts.push(`{closed} ${one(c) ? "was" : "were"} closed without a change`);
    }
    out.push(claim("feedback:outcome", CLAIM.outcome, FEEDBACK, `Of these, ${joinList(parts, true)}.`, slots, [FACT.outcome]));

    if (relayed > 0) {
      const more = v > 0 ? " more" : "";
      out.push(
        claim(
          "feedback:outcome",
          CLAIM.outcomeRelayed,
          FEEDBACK,
          one(relayed)
            ? `The person who reported it confirmed {verifiedViaStaffCode}${more} fix, using a code our staff passed on to them.`
            : `The people who reported them confirmed {verifiedViaStaffCode}${more} fixes, using a code our staff passed on to them.`,
          { verifiedViaStaffCode: relayed },
          [FACT.outcome],
        ),
      );
    }
  }

  const vt = byId.get(FACT.verifyTime);
  if (vt) {
    const n = num(vt, "verified");
    const d = num(vt, "medianDays");
    const days = one(d) ? "day" : "days";
    out.push(
      claim(
        "feedback:outcome",
        CLAIM.verifyTime,
        FEEDBACK,
        one(n)
          ? `For the fix confirmed by the person who reported it, the time from receiving the feedback to that confirmation was {medianDays} ${days}.`
          : `For the fixes confirmed by the person who reported them, the median time from receiving the feedback to that confirmation was {medianDays} ${days}.`,
        { medianDays: d },
        [FACT.verifyTime],
      ),
    );
  }

  // ---- How we followed up ----
  const ack = byId.get(FACT.ack);
  if (ack && totalCount > 0) {
    const need = num(ack, "nonAnonymous");
    const acked = num(ack, "acked");
    const hours = ack.values.medianHours;
    let template: string;
    const slots: Record<string, number> = {};
    if (need === 0) {
      template = "All of it was sent anonymously, so none of it needed an acknowledgement.";
    } else if (acked === 0) {
      slots.nonAnonymous = need;
      template = `We have not yet recorded an acknowledgement for the {nonAnonymous} ${one(need) ? "piece" : "pieces"} of feedback that ${one(need) ? "was" : "were"} not anonymous.`;
    } else {
      slots.acked = acked;
      slots.nonAnonymous = need;
      template = `We acknowledged {acked} of the {nonAnonymous} ${one(need) ? "piece" : "pieces"} of feedback that ${one(need) ? "was" : "were"} not anonymous, in the same way ${one(need) ? "it" : "they"} reached us.`;
      if (typeof hours === "number") {
        slots.medianHours = hours;
        template += one(acked)
          ? ` It took {medianHours} ${one(hours) ? "hour" : "hours"} to acknowledge.`
          : ` The median time to acknowledge was {medianHours} ${one(hours) ? "hour" : "hours"}.`;
      }
    }
    out.push(claim("feedback:followup", CLAIM.ack, FEEDBACK, template, slots, [FACT.ack]));
  }

  const retest = byId.get(FACT.retest);
  if (retest && totalCount > 0) {
    const req = num(retest, "requested");
    const ans = num(retest, "answered");
    const back = num(retest, "partlyOrNotFixed");
    let template: string;
    const slots: Record<string, number> = {};
    if (req === 0) {
      template = "We did not ask anyone to check a fix in this reporting period.";
    } else {
      slots.requested = req;
      template = `We asked the person who reported a barrier to check the fix {requested} ${one(req) ? "time" : "times"}`;
      if (ans === 0) template += ", and have not had an answer yet.";
      else {
        slots.answered = ans;
        template += ` and got {answered} ${one(ans) ? "answer" : "answers"}.`;
      }
      if (back > 0) {
        slots.partlyOrNotFixed = back;
        template += " In {partlyOrNotFixed} of those checks, the person told us the fix only partly worked or did not work yet, so we kept working on it.";
      }
    }
    out.push(claim("feedback:followup", CLAIM.retest, FEEDBACK, template, slots, [FACT.retest]));
  }

  // ---- Areas: one sentence per plan area (its own section); areas outside the plan with feedback go to Feedback ----
  for (const a of PRIORITY_AREAS) {
    const f = byId.get(FACT.area(a));
    if (!f) continue;
    const n = num(f, "count");
    if (plan.has(a)) {
      out.push(claim(`area:${a}`, CLAIM.area(a), AREA_HEADINGS[a].canonical, "Feedback received in this area: {count}.", { count: n }, [f.id]));
    } else if (n > 0) {
      out.push(
        claim(
          "feedback:followup",
          CLAIM.area(a),
          FEEDBACK,
          `We also received {count} ${one(n) ? "piece" : "pieces"} of feedback about ${inSentence(AREA_HEADINGS[a].canonical)}, which is not an area in our current accessibility plan.`,
          { count: n },
          [f.id],
        ),
      );
    }
  }

  // ---- How feedback was taken into consideration: one sentence per fixed case ----
  const fixed = snapshot.facts.filter((f) => f.kind === "F_CASE");
  for (const f of fixed) {
    const ref = f.id.slice("F_CASE:".length);
    const summary = typeof f.values.publicSummary === "string" ? f.values.publicSummary.trim() : "";
    const lead =
      f.values.outcome === "verified"
        ? f.values.viaStaffCode === "yes"
          ? "Fixed and confirmed by the person who reported it, using a code our staff passed on"
          : "Fixed and confirmed by the person who reported it"
        : "Fixed, but not yet confirmed by the person who reported it";
    out.push(
      summary
        ? claim("feedback:consideration", CLAIM.case(ref), FEEDBACK, `${lead}: {publicSummary}${endsSentence(summary) ? "" : "."}`, { publicSummary: summary }, [f.id])
        : claim("feedback:consideration", CLAIM.case(ref), FEEDBACK, `${lead}.`, {}, [f.id]),
    );
  }
  if (fixed.length === 0 && outcome && totalCount > 0) {
    out.push(claim("feedback:consideration", CLAIM.noneFixed, FEEDBACK, "None of the feedback in this period has led to a fix yet.", {}, [FACT.outcome]));
  }
  return out;
}
