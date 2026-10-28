// The pilot tenant (docs/decisions.md 2026-10-28): made-up submissions for the made-up organization Northbound Rail &
// Ferry, each one a barrier THEME from a public source written again in our own words. The data is
// data/pilot/submissions.json; `npm run pilot:ingest` (scripts/ingest-pilot.ts) runs them through the real intake and
// plays their steps through transition(). Like data/scenarios.json there is no table for it: submission N is case
// BAR-000N of the org (the ingest stops if a ref differs), and the staff case page and /sources look a case up here by
// (org slug, ref). Sources are the file's own plus any data/scenarios.json source, by id. Validated with zod when the
// module loads: a broken file fails the build and the tests, never a page.
import { z } from "zod";
import raw from "@/data/pilot/submissions.json";
import { intakeChannel, locationKind } from "@/db/schema";
import { PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";
import { SCENARIO_ORG, SCENARIO_SOURCES, SourceSchema, type ScenarioSource } from "@/lib/scenarios";

const Day = z.string().regex(/^2026-\d{2}-\d{2}$/);

/** The owners of the pilot org (scripts/ingest-pilot.ts creates them with these display names). */
export const PILOT_OWNERS = {
  stations: "Stations team",
  fleet: "Trains and ferries team",
  digital: "Digital team",
  customer: "Customer care team",
  people: "People team",
} as const;
export type PilotOwner = keyof typeof PILOT_OWNERS;
export const PILOT_LEAD = "Morgan Tremblay";

const STEP_KINDS = ["fix", "fixed", "partly", "not_fixed", "cant_check", "close_no_action", "close_duplicate"] as const;
type StepKind = (typeof STEP_KINDS)[number];
const VERDICTS: readonly StepKind[] = ["fixed", "partly", "not_fixed", "cant_check"];

/** One planned step after triage: `[days after received, step]`. */
const StepSchema = z.tuple([z.number().int().min(0).max(120), z.enum(STEP_KINDS)]);

const SubmissionSchema = z.object({
  id: z.string().regex(/^P\d{2}$/),
  source: z.string(),
  /** A short title for the theme (shown on /sources). Ours, not the source's wording. */
  theme: z.string().min(10).max(120),
  receivedOn: Day,
  channel: z.enum(intakeChannel.enumValues),
  locationKind: z.enum(locationKind.enumValues),
  locationDetail: z.string().max(200),
  /** Web reports are anonymous (no email in the pilot); a named person gives a made-up phone or mailing address. */
  anonymous: z.boolean(),
  contact: z.string().min(5).max(120).nullable(),
  wantsRetest: z.boolean(),
  /** The area the made-up lead files it under at triage (the AI's suggestion is recorded separately). */
  area: z.enum(PRIORITY_AREAS),
  /** What the made-up person said. Our words; made-up names and numbers only. */
  text: z.string().min(20).max(400),
  /** "" = the case stays NEW (waiting for the lead's redaction review). */
  publicSummary: z.string().max(200),
  owner: z.enum(Object.keys(PILOT_OWNERS) as [PilotOwner, ...PilotOwner[]]).nullable(),
  steps: z.array(StepSchema),
  /** For a close as duplicate: the earlier submission it repeats. */
  duplicateOf: z.string().regex(/^P\d{2}$/).nullable(),
});

const FileSchema = z
  .object({
    _doc: z.string(),
    org: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(3), about: z.string().min(10) }),
    sources: z.array(SourceSchema).min(1),
    submissions: z.array(SubmissionSchema).min(40).max(60),
  })
  .superRefine((f, ctx) => {
    const issue = (i: number, field: string, message: string) =>
      ctx.addIssue({ code: "custom", path: ["submissions", i, field], message });
    if (f.org.slug === SCENARIO_ORG.slug) ctx.addIssue({ code: "custom", path: ["org", "slug"], message: "not the scenario org" });
    const own = new Set(f.sources.map((s) => s.id));
    if (own.size !== f.sources.length) ctx.addIssue({ code: "custom", path: ["sources"], message: "duplicate source id" });
    for (const s of f.sources) {
      if (SCENARIO_SOURCES.some((x) => x.id === s.id)) ctx.addIssue({ code: "custom", path: ["sources"], message: `${s.id} is already in data/scenarios.json` });
    }
    f.submissions.forEach((s, i) => {
      if (s.id !== `P${String(i + 1).padStart(2, "0")}`) issue(i, "id", "ids follow file order");
      const src = f.sources.find((x) => x.id === s.source) ?? SCENARIO_SOURCES.find((x) => x.id === s.source);
      if (!src) issue(i, "source", `unknown source ${s.source}`);
      else if (src.status !== "read") issue(i, "source", "source was not read");
      if (s.anonymous !== (s.contact === null)) issue(i, "contact", "a named person has a contact; an anonymous one has none");
      if (s.channel === "web" && !s.anonymous) issue(i, "anonymous", "web reports are anonymous in the pilot (no emails)");

      const kinds = s.steps.map(([, k]) => k);
      const days = s.steps.map(([d]) => d);
      if (days.some((d, j) => j > 0 && d < days[j - 1])) issue(i, "steps", "steps go forward in time");
      if (!s.publicSummary && (s.steps.length > 0 || s.owner)) issue(i, "publicSummary", "a NEW case has no steps and no owner");
      if (s.duplicateOf !== null) {
        const j = f.submissions.findIndex((x) => x.id === s.duplicateOf);
        if (j < 0 || j >= i) issue(i, "duplicateOf", "must name an earlier submission");
        if (kinds.length !== 1 || kinds[0] !== "close_duplicate" || s.owner) issue(i, "steps", "a duplicate is closed and nothing else");
      } else if (kinds.includes("close_duplicate")) issue(i, "steps", "close_duplicate needs duplicateOf");
      if (kinds.includes("close_no_action") && (kinds.length !== 1 || s.owner)) issue(i, "steps", "close_no_action is the only step, with no owner");
      if (kinds.includes("fix") && !s.owner) issue(i, "owner", "a fix needs an owner");
      kinds.forEach((k, j) => {
        if (!VERDICTS.includes(k)) return;
        if (!s.wantsRetest) issue(i, "steps", "a verdict needs wantsRetest");
        if (kinds[j - 1] !== "fix") issue(i, "steps", "a verdict follows a fix");
      });
    });
  });

const data = FileSchema.parse(raw);

export type PilotSubmission = z.infer<typeof SubmissionSchema> & { area: PriorityArea };

export const PILOT_ORG = data.org;
/** The pilot's own sources (data/scenarios.json sources it uses are looked up there). */
export const PILOT_SOURCES: readonly ScenarioSource[] = data.sources;
export const PILOT_SUBMISSIONS: readonly PilotSubmission[] = data.submissions;

export function pilotSource(s: Pick<PilotSubmission, "source">): ScenarioSource {
  const src = PILOT_SOURCES.find((x) => x.id === s.source) ?? SCENARIO_SOURCES.find((x) => x.id === s.source);
  if (!src) throw new Error(`pilot source ${s.source} is missing`); // the schema above already refuses this
  return src;
}

/** Every source the pilot uses, its own first, each once. */
export function pilotSourcesUsed(): ScenarioSource[] {
  const ids = new Set(PILOT_SUBMISSIONS.map((s) => s.source));
  return [...PILOT_SOURCES, ...SCENARIO_SOURCES].filter((s) => ids.has(s.id));
}

/** The case ref submission `index` (0-based) gets in the pilot org. */
export function pilotRef(index: number): string {
  return `BAR-${String(index + 1).padStart(4, "0")}`;
}

/** The submission behind a case, looked up by the org's slug and the case's ref. */
export function pilotForCase(orgSlug: string, ref: string): { submission: PilotSubmission; source: ScenarioSource } | null {
  if (orgSlug !== PILOT_ORG.slug) return null;
  const i = PILOT_SUBMISSIONS.findIndex((_, j) => pilotRef(j) === ref);
  if (i < 0) return null;
  const submission = PILOT_SUBMISSIONS[i];
  return { submission, source: pilotSource(submission) };
}

/** Where the made-up case ends up after `npm run pilot:ingest`, in words for /sources. */
export function pilotStage(s: Pick<PilotSubmission, "publicSummary" | "owner" | "steps" | "wantsRetest">): string {
  if (!s.publicSummary) return "New: waiting for the lead's redaction review";
  const last = s.steps.at(-1)?.[1];
  if (last === "close_duplicate") return "Closed as a duplicate of an earlier report";
  if (last === "close_no_action") return "Closed: no action was possible";
  if (last === "fixed") return "Fixed and confirmed by the person who reported it";
  if (last === "partly") return "Partly fixed, says the person who reported it: back with the team";
  if (last === "not_fixed") return "Not fixed, says the person who reported it: back with the team";
  if (last === "cant_check") return "The person who reported it couldn't check the fix";
  if (last === "fix") return s.wantsRetest ? "Fixed: waiting for the person who reported it to check" : "Fixed, not checked by the person who reported it";
  if (s.owner) return "Assigned: someone is working on a fix";
  return "Triaged: waiting to be assigned";
}
