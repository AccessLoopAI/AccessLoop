// Demo seed: three FICTIONAL organizations. Maple Harbour Bank: 16 historical cases in 2026 covering every state,
// several intake channels and 6 priority areas (domain §10's expected values). Lakeview Telecom: the tenancy test
// (no cases). Kestrel Bay Group: the scenario cases of data/scenarios.json (lib/scenarios.ts), each derived from a
// public progress report, wording ours, not a real submission; it never changes Maple Harbour's numbers.
// Run: `npm run db:seed` (add `-- --reset` to wipe first). Each org's cases are seeded only while it has none, so
// running it on an existing database adds what is missing (the scenario org) and leaves the rest as it is.
// Uses only the frozen core (createCase, transition, appendCaseEvent), so seeded chains verify like live ones.
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { db } from "./client";
import { withOrg } from "./tenant";
import { orgs, orgMembers, cases } from "./schema";
import { createCase } from "@/lib/cases/create";
import { transition, type Actor } from "@/lib/state-machine";
import { appendCaseEvent } from "@/lib/case-events";
import { applyRedaction, detectPatterns, mergeSpans, spansFromValues, type PiiType } from "@/lib/redaction/patterns";
import fakePii from "@/lib/ai/fakes/flag-pii.json";
import { SCENARIO_ORG, SCENARIOS } from "@/lib/scenarios";

/** Same layers as live intake with FAKE_LLM=1: patterns, then the fake flagPii entries. */
function redactLikeIntake(raw: string) {
  const llmItems = fakePii.entries.filter((e) => raw.includes(e.match))
    .flatMap((e) => e.items.map((i) => ({ text: i.text, type: i.type as PiiType })));
  return mergeSpans([...detectPatterns(raw), ...spansFromValues(raw, llmItems)]);
}

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`seed: ${k} is not set (see .env.example)`);
  return v;
};
/** The scenario org's IDs are optional, so an existing .env.local keeps working (local sign-in reads them from the DB). */
const optional = (k: string, fallback: string) => process.env[k]?.trim() || fallback;

type Area = "employment" | "built_environment" | "ict" | "communication_other" | "procurement" | "programs_services" | "transportation";
type Channel = "web" | "email" | "phone" | "mail" | "in_person" | "other";
type Loc = "digital" | "place" | "phone_or_service" | "document" | "other";
type Step = "fix" | "fixed" | "partly" | "not_fixed" | "cant_check" | "close_duplicate" | "close_no_action";

interface Spec {
  day: string;                  // received date (2026)
  channel: Channel;
  loc: Loc;
  anonymous: boolean;
  wantsRetest: boolean;
  raw: string;                  // fictional; no real people
  summary: string;
  area: Area;
  publicSummary: string;
  owner: string | null;         // a key of the org's owners (seedCases)
  // lifecycle after triage; each step is [daysAfterReceived, step]
  steps: [number, Step][];
  ref?: string;                 // the ref this case must get (scenario cases: data/scenarios.json)
}

const SPECS: Spec[] = [
  { day: "2026-01-14", channel: "web", loc: "digital", anonymous: true, wantsRetest: true, area: "ict", owner: "web",
    raw: "The 'Send money' button in the mobile app is not announced by VoiceOver, it just says 'button'.",
    summary: "The Send money button in the app has no name for screen readers.",
    publicSummary: "A button in the mobile banking app had no label for screen readers.",
    steps: [[9, "fix"], [12, "fixed"]] },
  { day: "2026-01-28", channel: "phone", loc: "phone_or_service", anonymous: false, wantsRetest: false, area: "communication_other", owner: "facilities",
    raw: "Caller said phone agents hang up on relay calls. Call back at 613-555-0177.",
    summary: "Phone agents hung up on calls made through a relay service.",
    publicSummary: "Phone agents ended calls made through a relay service.",
    steps: [[20, "fix"]] },
  { day: "2026-02-10", channel: "web", loc: "place", anonymous: true, wantsRetest: true, area: "built_environment", owner: "facilities",
    raw: "Ramp at the Queen St branch has no handrail and is icy every morning.",
    summary: "The ramp at a branch has no handrail and is often icy.",
    publicSummary: "A branch entrance ramp had no handrail and was not cleared of ice.",
    steps: [[15, "fix"], [18, "partly"], [30, "fix"], [34, "fixed"]] },
  { day: "2026-02-24", channel: "email", loc: "document", anonymous: false, wantsRetest: true, area: "communication_other", owner: "web",
    raw: "I asked for large-print statements twice. Still tiny print. reply to r.lam@example.com",
    summary: "Large-print statements were requested but not provided.",
    publicSummary: "Account statements were not provided in large print on request.",
    steps: [[10, "fix"], [21, "fixed"]] },
  { day: "2026-03-09", channel: "web", loc: "digital", anonymous: true, wantsRetest: true, area: "ict", owner: "web",
    raw: "Login page CAPTCHA has no audio option.",
    summary: "The login CAPTCHA has no audio option.",
    publicSummary: "The online banking sign-in used a visual-only CAPTCHA.",
    steps: [[6, "fix"], [7, "fixed"]] },
  { day: "2026-03-30", channel: "in_person", loc: "place", anonymous: true, wantsRetest: false, area: "programs_services", owner: "facilities",
    raw: "Customer at the counter said staff refused to write things down for a Deaf customer.",
    summary: "Branch staff would not write notes for a Deaf customer.",
    publicSummary: "Branch staff did not offer written communication to a Deaf customer.",
    steps: [[14, "fix"]] },
  { day: "2026-04-15", channel: "web", loc: "digital", anonymous: true, wantsRetest: true, area: "employment", owner: "web",
    raw: "The careers site assessment has a timer you can't extend.",
    summary: "The online job assessment has a timer that can't be extended.",
    publicSummary: "An online job assessment did not allow extra time as an accommodation.",
    steps: [[25, "fix"], [29, "fixed"]] },
  { day: "2026-05-05", channel: "mail", loc: "document", anonymous: false, wantsRetest: false, area: "procurement", owner: "web",
    raw: "Letter: the new kiosks you bought are touch-only with no audio.",
    summary: "Newly bought self-serve kiosks are touch-only with no audio.",
    publicSummary: "Newly purchased self-serve kiosks had no audio or tactile option.",
    steps: [[40, "fix"]] },
  { day: "2026-05-20", channel: "web", loc: "place", anonymous: true, wantsRetest: true, area: "built_environment", owner: "facilities",
    raw: "Accessible parking spot at the Halifax branch is always blocked by trucks.",
    summary: "The accessible parking spot at a branch is often blocked.",
    publicSummary: "An accessible parking space at a branch was often blocked by deliveries.",
    steps: [[8, "fix"], [11, "fixed"]] },
  { day: "2026-06-11", channel: "web", loc: "digital", anonymous: true, wantsRetest: true, area: "ict", owner: "web",
    raw: "Chat support times out before I can finish typing with my switch.",
    summary: "The support chat times out too fast for switch users.",
    publicSummary: "The support chat closed before people using switch access could finish typing.",
    steps: [[12, "fix"], [13, "cant_check"]] },
  { day: "2026-06-11", channel: "web", loc: "digital", anonymous: true, wantsRetest: false, area: "ict", owner: null,
    raw: "chat closes too fast when typing slowly",
    summary: "The support chat closes too fast.",
    publicSummary: "Duplicate of an earlier report about the support chat.",
    steps: [[1, "close_duplicate"]] },
  { day: "2026-07-22", channel: "web", loc: "place", anonymous: true, wantsRetest: true, area: "built_environment", owner: "facilities",
    raw: "The elevator at the Bay Street branch is out almost every week.",
    summary: "A branch elevator is often out of service.",
    publicSummary: "A branch elevator was frequently out of service with no alternative route.",
    steps: [[10, "fix"], [14, "fixed"]] },
  { day: "2026-09-08", channel: "email", loc: "phone_or_service", anonymous: false, wantsRetest: false, area: "programs_services", owner: "facilities",
    raw: "Service animal policy sign at the branch door says no animals.",
    summary: "A branch door sign says no animals, which excludes service animals.",
    publicSummary: "A branch sign wrongly excluded service animals.",
    steps: [] }, // stays assigned
  { day: "2026-09-15", channel: "web", loc: "digital", anonymous: true, wantsRetest: true, area: "ict", owner: "web",
    raw: "PDF account-opening form fields have no labels.",
    summary: "The account-opening PDF form has unlabelled fields.",
    publicSummary: "An account-opening PDF form had fields without labels for screen readers.",
    steps: [[9, "fix"]] }, // ends in retest_open: demo can verify it with the printed receipt code
  { day: "2026-09-30", channel: "web", loc: "digital", anonymous: true, wantsRetest: true, area: "ict", owner: null,
    raw: "Video ads on the homepage autoplay with no captions.",
    summary: "Homepage videos autoplay without captions.",
    publicSummary: "Homepage videos played automatically without captions.",
    steps: [] }, // stays triaged (no owner)
  { day: "2026-10-14", channel: "web", loc: "place", anonymous: true, wantsRetest: true, area: "built_environment", owner: null,
    raw: "Branch counter is too high to use from a wheelchair. My name is Sam Example, 416-555-0188.",
    summary: "The branch counter is too high for wheelchair users.",
    publicSummary: "",
    steps: [] }, // stays NEW: redaction waiting for approval (shows the review screen)
];

const DAY = 86_400_000;

async function reset() {
  if (process.env.SEED_ALLOW_RESET !== "1") throw new Error("Refusing to reset: set SEED_ALLOW_RESET=1 (never in production)");
  const owner = postgres(need("MIGRATION_DATABASE_URL"), { prepare: false, max: 1 });
  await owner`TRUNCATE outbound_messages, attachments, reports, case_events, case_private, cases, org_members, orgs, rate_limits RESTART IDENTITY CASCADE`;
  await owner.end();
}

async function upsertOrg(v: typeof orgs.$inferInsert) {
  const [existing] = await db.select().from(orgs).where(eq(orgs.slug, v.slug));
  if (existing) return existing;
  const [row] = await db.insert(orgs).values(v).returning();
  return row;
}

async function main() {
  if (process.argv.includes("--reset")) await reset();

  const demo = await upsertOrg({
    clerkOrgId: need("SEED_CLERK_ORG_ID_DEMO"), slug: "maple-harbour",
    name: "Maple Harbour Bank", regulator: "accessibility_commissioner", entityClass: "private_large",
    planAreas: ["employment", "built_environment", "ict", "communication_other", "procurement", "programs_services"],
    feedbackDesignateTitle: "Director, Accessibility and Inclusion",
    contactMailingAddress: "100 Example Street, Toronto, ON M5V 0A0",
    contactPhone: "1-800-555-0100", contactEmail: "accessibility@example.com",
    retestOfferText: "We offer a $25 gift card to thank you for checking a fix.",
  });
  const other = await upsertOrg({
    clerkOrgId: need("SEED_CLERK_ORG_ID_OTHER"), slug: "lakeview-telecom",
    name: "Lakeview Telecom", regulator: "crtc", entityClass: "private_large",
    planAreas: ["ict", "communication_other", "programs_services"],
    feedbackDesignateTitle: "Accessibility Lead", contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
    contactPhone: "1-800-555-0101", contactEmail: "access@example.org",
  });

  const scenarioOrg = await upsertOrg({
    clerkOrgId: optional("SEED_CLERK_ORG_ID_SCENARIOS", "local_org_kestrel"), slug: SCENARIO_ORG.slug,
    name: SCENARIO_ORG.name, regulator: "accessibility_commissioner", entityClass: "private_large",
    planAreas: ["employment", "built_environment", "ict", "communication_other", "procurement", "programs_services", "transportation"],
    feedbackDesignateTitle: "Manager, Accessibility Feedback",
    contactMailingAddress: "200 Example Avenue, Halifax, NS B3H 0A0",
    contactPhone: "1-800-555-0102", contactEmail: "feedback@example.net",
  });

  const members = await withOrg({ orgId: demo.id, role: "system" }, async (tx) => {
    const ins = (clerkUserId: string, displayName: string, role: "lead" | "owner" | "auditor") =>
      upsertMember(tx, demo.id, clerkUserId, displayName, role);
    return {
      lead: await ins(need("SEED_LEAD_USER_ID"), "Alex Rivera", "lead"),
      web: await ins(need("SEED_OWNER_WEB_USER_ID"), "Web team", "owner"),
      facilities: await ins(need("SEED_OWNER_FACILITIES_USER_ID"), "Facilities team", "owner"),
      auditor: await ins(need("SEED_AUDITOR_USER_ID"), "Internal audit", "auditor"),
    };
  });
  await withOrg({ orgId: other.id, role: "system" }, (tx) =>
    tx.insert(orgMembers).values({ orgId: other.id, clerkUserId: need("SEED_OTHER_LEAD_USER_ID"),
      displayName: "Other org lead", role: "lead" }).onConflictDoNothing());
  // No name here starts like another org's member: e2e signs in by "Sign in as {name}" prefixes.
  const scenarioMembers = await withOrg({ orgId: scenarioOrg.id, role: "system" }, async (tx) => ({
    lead: await upsertMember(tx, scenarioOrg.id, optional("SEED_SCENARIO_LEAD_USER_ID", "local_kestrel_lead"), "Riley Brennan", "lead"),
    operations: await upsertMember(tx, scenarioOrg.id, optional("SEED_SCENARIO_OWNER_USER_ID", "local_kestrel_ops"), "Operations team", "owner"),
  }));

  const printed: string[] = [];
  if (await hasCases(demo.id)) {
    console.log("Demo org already has cases; run with --reset to rebuild.");
  } else {
    await seedCases(demo.id, SPECS, members.lead.id, { web: members.web.id, facilities: members.facilities.id }, printed);
    console.log("Seeded Maple Harbour Bank (made-up demo organization) with", SPECS.length, "cases.");
  }
  if (await hasCases(scenarioOrg.id)) {
    console.log(`${SCENARIO_ORG.name} already has cases; run with --reset to rebuild.`);
  } else {
    await seedCases(scenarioOrg.id, SCENARIO_SPECS, scenarioMembers.lead.id, { operations: scenarioMembers.operations.id }, printed);
    console.log(`Seeded ${SCENARIO_ORG.name} (made-up scenario organization) with`, SCENARIO_SPECS.length,
      "cases derived from public reports (data/scenarios.json).");
  }
  for (const line of printed) console.log("  ", line);
}

type Tx = Parameters<Parameters<typeof withOrg>[1]>[0];

async function upsertMember(tx: Tx, orgId: string, clerkUserId: string, displayName: string, role: "lead" | "owner" | "auditor") {
  const [m] = await tx.insert(orgMembers).values({ orgId, clerkUserId, displayName, role })
    .onConflictDoUpdate({ target: [orgMembers.orgId, orgMembers.clerkUserId], set: { displayName, role } })
    .returning();
  return m;
}

/** data/scenarios.json in the seed's own shape (each ref is checked as its case is created). */
const SCENARIO_SPECS: Spec[] = SCENARIOS.map((s) => ({
  day: s.receivedOn, channel: s.channel, loc: s.locationKind, anonymous: s.anonymous, wantsRetest: s.wantsRetest,
  raw: s.text, summary: s.summary, area: s.area, publicSummary: s.publicSummary, owner: s.owner,
  steps: s.steps.map(([d, step]): [number, Step] => [d, step]), ref: s.ref,
}));

async function hasCases(orgId: string): Promise<boolean> {
  const rows = await withOrg({ orgId, role: "system" }, (tx) =>
    tx.select({ id: cases.id }).from(cases).where(eq(cases.orgId, orgId)).limit(1));
  return rows.length > 0;
}

/** One org's historical cases, in order, through the frozen core. `owners` maps a Spec's owner key to a member id. */
async function seedCases(orgId: string, specs: Spec[], leadId: string, owners: Record<string, string>, printed: string[]) {
  const lead: Actor = { kind: "staff", memberId: leadId, role: "lead" };
  const reporter: Actor = { kind: "reporter", via: "receipt_code" };

  for (const s of specs) {
    const t0 = new Date(`${s.day}T14:00:00.000Z`);
    const spans = redactLikeIntake(s.raw);
    await withOrg({ orgId: orgId, role: "system" }, async (tx) => {
      const { case: c, receiptCode } = await createCase(tx, {
        orgId: orgId, intakeChannel: s.channel, locationKind: s.loc, rawText: s.raw,
        redactedText: applyRedaction(s.raw, spans), spans, needsManualRedaction: false,
        isAnonymous: s.anonymous, wantsRetest: s.wantsRetest, aiOptOut: false, receivedAt: t0,
        ai: { summary: s.summary, priorityAreas: [{ area: s.area, confidence: 0.9 }], uncertain: [],
          backend: "seed", model: "seed", promptSha: "seed", latencyMs: 0 },
        summary: s.summary, summarySource: "ai_confirmed",
        loggedByMemberId: s.channel === "web" ? null : leadId,
        codeRelayedByStaff: s.channel === "phone" || s.channel === "in_person",
      });
      if (s.ref && c.ref !== s.ref) {
        throw new Error(`seed: expected ${s.ref} but createCase gave ${c.ref}; data/scenarios.json is out of order`);
      }
      const at = (days: number, plusMs = 0) => new Date(t0.getTime() + days * DAY + plusMs);

      // Non-web, non-anonymous: acknowledged manually in the same means (ACR s.9(4)).
      if (s.channel !== "web" && !s.anonymous) {
        await appendCaseEvent(tx, { orgId: orgId, caseId: c.id, type: "ack_recorded", actorKind: "staff",
          actorId: leadId, createdAt: at(1), payload: { channel: s.channel, manual: true } });
        await tx.update(cases).set({ ackAt: at(1) }).where(eq(cases.id, c.id));
      }
      if (s.steps.length === 0 && !s.publicSummary) {
        printed.push(`${c.ref} (new, awaiting redaction review)`);
        return;
      }

      await appendCaseEvent(tx, { orgId: orgId, caseId: c.id, type: "redaction_approved", actorKind: "staff",
        actorId: leadId, createdAt: at(0, 3_600_000),
        payload: { spans: spans.map(({ start, end, type, source }) => ({ start, end, type, source })) } });
      await tx.update(cases).set({ redactionApprovedAt: at(0, 3_600_000) }).where(eq(cases.id, c.id));

      if (s.steps[0]?.[1] === "close_duplicate") {
        await transition(tx, orgId, c.id, { kind: "close", reason: "duplicate" }, lead, { at: at(s.steps[0][0]) });
        return;
      }
      await transition(tx, orgId, c.id, { kind: "triage", priorityArea: s.area, publicSummary: s.publicSummary },
        lead, { at: at(0, 7_200_000) });
      if (s.steps[0]?.[1] === "close_no_action") {
        if (s.steps.length !== 1 || s.owner) throw new Error("close_no_action must be the only step, with no owner");
        await transition(tx, orgId, c.id, { kind: "close", reason: "no_action_possible" }, lead, { at: at(s.steps[0][0]) });
        return;
      }
      if (!s.owner) return;
      const ownerId = owners[s.owner];
      if (!ownerId) throw new Error(`seed: unknown owner ${s.owner}`);
      await transition(tx, orgId, c.id, { kind: "assign", memberId: ownerId }, lead, { at: at(1) });
      const ownerActor: Actor = { kind: "staff", memberId: ownerId, role: "owner" };

      for (const [d, step] of s.steps) {
        if (step === "fix") {
          await transition(tx, orgId, c.id, { kind: "log_fix", description: `Fixed: ${s.publicSummary}` },
            ownerActor, { at: at(d) });
        } else if (step === "close_duplicate" || step === "close_no_action") {
          throw new Error(`${step} must be the only step`);
        } else {
          await transition(tx, orgId, c.id, { kind: "verdict", verdict: step }, reporter, { at: at(d) });
        }
      }
      const [final] = await tx.select({ status: cases.status }).from(cases).where(eq(cases.id, c.id));
      if (final.status === "retest_open") printed.push(`${c.ref} (retest_open) receipt code: ${receiptCode}`);
    });
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
