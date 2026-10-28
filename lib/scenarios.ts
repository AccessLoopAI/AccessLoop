// Scenario cases derived from published accessibility progress reports (docs/archive/phase7-prompt.md T6 item 1;
// docs/decisions.md 2026-10-20). The data is data/scenarios.json: one made-up organization (Kestrel Bay Group), the
// reports we read, and 10-15 scenarios, each a barrier THEME from one report written again in our own words.
//
// This is the "table-free" mechanism: there is no column or table for it (no schema change). db/seed.ts creates the
// scenario cases in file order through the frozen core, so scenario N is case BAR-000N of that org (the seed stops if
// a ref differs), and the staff case page and the public /sources page look a case up here by (org slug, ref).
// A case another person logs in the same org later gets the next ref, which is in no scenario, so it never shows a
// note. Validated with zod when the module loads: a broken file fails the build, the seed and the tests, never a page.
import { z } from "zod";
import raw from "@/data/scenarios.json";
import { intakeChannel, locationKind } from "@/db/schema";
import { PRIORITY_AREAS, type PriorityArea } from "@/lib/report/headings";

const Day = z.string().regex(/^2026-\d{2}-\d{2}$/);
const HttpsUrl = z.url({ protocol: /^https$/ });

const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{3,40}$/),
  /** The organization that published the report. It is only ever a SOURCE, never a tenant. */
  org: z.string().min(2).max(80),
  year: z.string().regex(/^20\d{2}(-20\d{2})?$/),
  title: z.string().min(3).max(160),
  url: HttpsUrl,
  /** "unreachable": we could not read it (nothing here comes from it). */
  status: z.enum(["read", "unreachable"]),
  /** What we used it for, in plain words (shown on /sources). */
  used: z.string().min(10).max(400),
});

/** One step after triage, `[days after received, step]`: like the Maple Harbour seed, plus a close. */
const StepSchema = z.tuple([
  z.number().int().min(0).max(120),
  z.enum(["fix", "fixed", "partly", "not_fixed", "cant_check", "close_no_action"]),
]);

const ScenarioSchema = z.object({
  id: z.string().regex(/^SC\d{2}$/),
  ref: z.string().regex(/^BAR-\d{4}$/),
  source: z.string(),
  /** A short title for the theme (shown on /sources). Ours, not the report's wording. */
  theme: z.string().min(10).max(120),
  receivedOn: Day,
  channel: z.enum(intakeChannel.enumValues),
  locationKind: z.enum(locationKind.enumValues),
  anonymous: z.boolean(),
  wantsRetest: z.boolean(),
  /** The area the made-up lead files it under (the case's triage); for a NEW case, the area it would get. */
  area: z.enum(PRIORITY_AREAS),
  /** What the made-up reporter wrote. Our words; no person, contact detail or real organization in it. */
  text: z.string().min(20).max(400),
  summary: z.string().min(10).max(200),
  /** "" = the case stays NEW (waiting for the lead's redaction review), like BAR-0016 at Maple Harbour. */
  publicSummary: z.string().max(200),
  owner: z.enum(["operations"]).nullable(),
  steps: z.array(StepSchema),
});

const FileSchema = z
  .object({
    _doc: z.string(),
    org: z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(3), about: z.string().min(10) }),
    sources: z.array(SourceSchema).min(1),
    scenarios: z.array(ScenarioSchema).min(10).max(15),
  })
  .superRefine((f, ctx) => {
    const ids = new Set(f.sources.map((s) => s.id));
    f.scenarios.forEach((s, i) => {
      const src = f.sources.find((x) => x.id === s.source);
      if (!src) ctx.addIssue({ code: "custom", path: ["scenarios", i, "source"], message: `unknown source ${s.source}` });
      else if (src.status !== "read") ctx.addIssue({ code: "custom", path: ["scenarios", i, "source"], message: "source was not read" });
      const want = `BAR-${String(i + 1).padStart(4, "0")}`;
      if (s.ref !== want) ctx.addIssue({ code: "custom", path: ["scenarios", i, "ref"], message: `expected ${want} (file order)` });
      if (s.id !== `SC${String(i + 1).padStart(2, "0")}`) ctx.addIssue({ code: "custom", path: ["scenarios", i, "id"], message: "ids follow file order" });
    });
    if (ids.size !== f.sources.length) ctx.addIssue({ code: "custom", path: ["sources"], message: "duplicate source id" });
  });

const data = FileSchema.parse(raw);

export type ScenarioSource = z.infer<typeof SourceSchema>;
export type Scenario = z.infer<typeof ScenarioSchema> & { area: PriorityArea };

/** The made-up organization that holds the scenario cases (never Maple Harbour: domain §10's table stays as it is). */
export const SCENARIO_ORG = data.org;
export const SCENARIO_SOURCES: readonly ScenarioSource[] = data.sources;
export const SCENARIOS: readonly Scenario[] = data.scenarios;

export function scenarioSource(s: Pick<Scenario, "source">): ScenarioSource {
  const src = SCENARIO_SOURCES.find((x) => x.id === s.source);
  if (!src) throw new Error(`scenario source ${s.source} is missing`); // the schema above already refuses this
  return src;
}

/** The scenario behind a case, looked up by the org's slug and the case's ref (refs repeat across orgs). */
export function scenarioForCase(orgSlug: string, ref: string): { scenario: Scenario; source: ScenarioSource } | null {
  if (orgSlug !== SCENARIO_ORG.slug) return null;
  const scenario = SCENARIOS.find((s) => s.ref === ref);
  return scenario ? { scenario, source: scenarioSource(scenario) } : null;
}

/** The fixed parts of the note (domain: "Scenario derived from public report: {org}, {year}, {url}; wording ours; not a real submission"). */
export const SCENARIO_NOTE_START = "Scenario derived from public report:";
export const SCENARIO_NOTE_END = "wording ours; not a real submission";

/** The note as one plain string (the page renders the URL as a link inside the same words). */
export function scenarioNote(source: Pick<ScenarioSource, "org" | "year" | "url">): string {
  return `${SCENARIO_NOTE_START} ${source.org}, ${source.year}, ${source.url}; ${SCENARIO_NOTE_END}`;
}

/** Where the made-up case stands in the demo, in words for /sources (from its steps, like db/seed.ts plays them). */
export function scenarioStage(s: Pick<Scenario, "publicSummary" | "owner" | "steps" | "wantsRetest">): string {
  if (!s.publicSummary) return "New: waiting for the lead's redaction review";
  const last = s.steps.at(-1)?.[1];
  if (last === "close_no_action") return "Closed: no action was possible";
  if (last === "fixed") return "Fixed and confirmed by the person who reported it";
  if (last === "fix") return s.wantsRetest ? "Fixed: waiting for the person who reported it to check" : "Fixed, not checked by the person who reported it";
  if (s.owner) return "Assigned: someone is working on a fix";
  return "Triaged: a team is looking at it";
}
