// The daily job (app/api/cron/daily; docs/archive/phase7-prompt.md T3 item 12; docs/decisions.md 2026-10-20). Server-only.
//
// For every org: read the cases waiting on someone (retest_open, assigned) with their events, plan each one
// (lib/cron/daily.ts), then do each part in its OWN short transaction, with the case row locked (FOR UPDATE) and the
// case planned again on that fresh state, so a run racing a person (or another run) does nothing twice:
//   expire  transition(expire_retest) as the system actor; only with CRON_EXPIRE_RETEST=1 (domain §10);
//   remind  queueRetestReminder (one per round, never twice while one is in flight) in a LEAD transaction, the only
//           role row-level security lets read the reporter's address, like the re-test request after a fix;
//   alert   the owner alert, recorded like every other email (lib/email/send.ts): queued in the transaction, sent
//           after it commits (5 s at most), its result recorded in a second short transaction.
// One case failing never stops the others; the answer counts what happened, with no case data at all. Nothing here
// logs a reference, an address, a code or a link.
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { caseEvents, cases, orgMembers, orgs } from "@/db/schema";
import { withOrg, type TenantCtx } from "@/db/tenant";
import { inFlight, queueRetestReminder } from "@/lib/email/case-emails";
import { deliverEmail, emailData, queueEmail, type QueuedEmail, type TxRunner } from "@/lib/email/send";
import { staffEmailAddress } from "@/lib/email/staff-address";
import type { MetricEvent } from "@/lib/metrics/replay";
import { TransitionError, transition } from "@/lib/state-machine";
import { OWNER_ALERT_TEMPLATE, planDailyCase, type DailyCaseInput, type DailyCasePlan } from "./daily";

export type OrgTxRunner = <T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface DailyOptions {
  now?: Date;
  /** Plan and count only: nothing is written or sent. */
  dryRun?: boolean;
  /** CRON_EXPIRE_RETEST=1 (default: read from the environment). */
  expireRetest?: boolean;
  /** Tests: the orgs to visit and the transaction runner (default: every org, withOrg()). */
  orgIds?: () => Promise<string[]>;
  inOrg?: OrgTxRunner;
}

interface Counts {
  /** Planned for today (in a dry run, the only number filled in). */
  due: number;
  /** Done: expired, or an email recorded as sent (or, with FAKE_EMAIL=1, logged to the Outbox). */
  done: number;
  /** The email went to the provider and failed (status "failed"). */
  failed: number;
  /** Not done because the case had moved on, or one was already on its way. */
  skipped: number;
  /** Something went wrong (logged by error name only). */
  errors: number;
}

export interface DailySummary {
  ok: boolean;
  dryRun: boolean;
  orgs: number;
  expiry: Counts & { enabled: boolean };
  reminders: Counts & { noEmail: number };
  ownerAlerts: Counts & { noAddress: number };
}

const counts = (): Counts => ({ due: 0, done: 0, failed: 0, skipped: 0, errors: 0 });

const WAITING = ["retest_open", "assigned"] as const;

function logError(what: string, err: unknown) {
  console.error(`[cron] ${what} (${err instanceof Error ? err.name : "UnknownError"})`);
}

async function allOrgIds(): Promise<string[]> {
  return (await db.select({ id: orgs.id }).from(orgs)).map((o) => o.id);
}

type CaseRow = typeof cases.$inferSelect;

/** The planner's view of one case, from its row and events (inside the caller's transaction). */
async function inputOf(tx: Tx, c: CaseRow): Promise<DailyCaseInput> {
  const events = await tx
    .select({ seq: caseEvents.seq, type: caseEvents.type, payload: caseEvents.payload, createdAt: caseEvents.createdAt })
    .from(caseEvents)
    .where(and(eq(caseEvents.orgId, c.orgId), eq(caseEvents.caseId, c.id)))
    .orderBy(asc(caseEvents.seq));
  return { id: c.id, ref: c.ref, status: c.status, retestRound: c.retestRound, assignedTo: c.assignedTo, dueAt: c.dueAt, events };
}

/** Every case of one org that waits on someone, planned (one read-only transaction). */
async function planOrg(inOrg: OrgTxRunner, orgId: string, now: Date, expireRetest: boolean) {
  return inOrg({ orgId, role: "system" }, async (tx) => {
    const rows = await tx
      .select()
      .from(cases)
      .where(and(eq(cases.orgId, orgId), inArray(cases.status, [...WAITING])));
    if (rows.length === 0) return [];
    const events = await tx
      .select({ caseId: caseEvents.caseId, seq: caseEvents.seq, type: caseEvents.type, payload: caseEvents.payload, createdAt: caseEvents.createdAt })
      .from(caseEvents)
      .where(and(eq(caseEvents.orgId, orgId), inArray(caseEvents.caseId, rows.map((r) => r.id))))
      .orderBy(asc(caseEvents.seq));
    const byCase = new Map<string, MetricEvent[]>();
    for (const { caseId, ...e } of events) byCase.set(caseId, [...(byCase.get(caseId) ?? []), e]);
    return rows.map((c) => ({
      caseId: c.id,
      plan: planDailyCase(
        { id: c.id, ref: c.ref, status: c.status, retestRound: c.retestRound, assignedTo: c.assignedTo, dueAt: c.dueAt, events: byCase.get(c.id) ?? [] },
        now,
        { expireRetest },
      ),
    }));
  });
}

/** Lock one case and plan it again on its fresh state; null when it is gone. */
async function lockAndPlan(tx: Tx, orgId: string, caseId: string, now: Date, expireRetest: boolean) {
  const [c] = await tx.select().from(cases).where(and(eq(cases.orgId, orgId), eq(cases.id, caseId))).for("update");
  if (!c) return null;
  return { c, plan: planDailyCase(await inputOf(tx, c), now, { expireRetest }) };
}

/** Send after the commit and count the result. */
async function deliverAndCount(queued: QueuedEmail, runTx: TxRunner, n: Counts) {
  try {
    const sent = await deliverEmail(queued, { runTx });
    if (sent.status === "failed") n.failed++;
    else n.done++;
  } catch (err) {
    n.errors++;
    logError(`could not record the result of a ${queued.template} email`, err);
  }
}

export async function runDailyJob(options: DailyOptions = {}): Promise<DailySummary> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun ?? false;
  const expireRetest = options.expireRetest ?? process.env.CRON_EXPIRE_RETEST === "1";
  const inOrg: OrgTxRunner = options.inOrg ?? withOrg;
  const fake = process.env.FAKE_EMAIL === "1";

  const summary: DailySummary = {
    ok: true,
    dryRun,
    orgs: 0,
    expiry: { enabled: expireRetest, ...counts() },
    reminders: { ...counts(), noEmail: 0 },
    ownerAlerts: { ...counts(), noAddress: 0 },
  };

  const orgIds = await (options.orgIds ?? allOrgIds)();
  for (const orgId of orgIds) {
    summary.orgs++;
    const runTx: TxRunner = (fn) => inOrg({ orgId, role: "system" }, fn);
    let planned: { caseId: string; plan: DailyCasePlan }[];
    try {
      planned = await planOrg(inOrg, orgId, now, expireRetest);
    } catch (err) {
      summary.ok = false;
      logError("could not read an organization's cases", err);
      continue;
    }

    for (const { caseId, plan } of planned) {
      if (plan.expire) summary.expiry.due++;
      if (plan.remind) summary.reminders.due++;
      if (plan.ownerAlert) summary.ownerAlerts.due++;
      if (dryRun) continue;

      // (a) The round has waited 60 days: expire it through the frozen state machine, as the system.
      if (plan.expire) {
        const n = summary.expiry;
        try {
          const done = await inOrg({ orgId, role: "system" }, async (tx) => {
            const fresh = await lockAndPlan(tx, orgId, caseId, now, expireRetest);
            if (!fresh?.plan.expire) return false;
            await transition(tx, orgId, caseId, { kind: "expire_retest" }, { kind: "system" });
            return true;
          });
          if (done) n.done++;
          else n.skipped++;
        } catch (err) {
          if (err instanceof TransitionError) n.skipped++;
          else {
            n.errors++;
            logError("could not expire a re-test round", err);
          }
        }
      }

      // (b) The round's one reminder. The lead role reads the address (case_private), as for every system email.
      if (plan.remind) {
        const n = summary.reminders;
        try {
          const r = await inOrg({ orgId, role: "lead" }, async (tx) => {
            const fresh = await lockAndPlan(tx, orgId, caseId, now, expireRetest);
            if (!fresh?.plan.remind) return null;
            return queueRetestReminder(tx, fresh.c, { kind: "system" });
          });
          if (!r) n.skipped++;
          else if (!r.ok) {
            if (r.reason === "no_email") n.noEmail++;
            else n.skipped++;
          } else await deliverAndCount(r.queued, runTx, n);
        } catch (err) {
          n.errors++;
          logError("could not queue a re-test reminder", err);
        }
      }

      // (c) One alert to the assigned owner per stretch in "assigned" (past due, or no fix for 30+ days).
      if (plan.ownerAlert) {
        const n = summary.ownerAlerts;
        try {
          const r = await inOrg({ orgId, role: "system" }, async (tx) => {
            const fresh = await lockAndPlan(tx, orgId, caseId, now, expireRetest);
            const kind = fresh?.plan.ownerAlert;
            if (!fresh || !kind || !fresh.c.assignedTo) return { kind: "skipped" as const };
            const template = OWNER_ALERT_TEMPLATE[kind];
            if (await inFlight(tx, fresh.c, template)) return { kind: "skipped" as const };
            const [member] = await tx
              .select({ id: orgMembers.id, clerkUserId: orgMembers.clerkUserId })
              .from(orgMembers)
              .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.id, fresh.c.assignedTo)))
              .limit(1);
            if (!member) return { kind: "skipped" as const };
            const to = await staffEmailAddress({ orgId, memberId: member.id, clerkUserId: member.clerkUserId });
            // With FAKE_EMAIL=1 nothing leaves the machine, so the Outbox records it even with no address known.
            if (!to && !fake) return { kind: "no_address" as const };
            const queued = await queueEmail({
              tx,
              orgId,
              caseId,
              template,
              to: to ?? "",
              data: await emailData(tx, orgId, fresh.c.ref),
              actor: { kind: "system" },
            });
            return { kind: "queued" as const, queued };
          });
          if (r.kind === "queued") await deliverAndCount(r.queued, runTx, n);
          else if (r.kind === "no_address") n.noAddress++;
          else n.skipped++;
        } catch (err) {
          n.errors++;
          logError("could not queue an owner alert", err);
        }
      }
    }
  }

  const errors = summary.expiry.errors + summary.reminders.errors + summary.ownerAlerts.errors;
  if (errors > 0) summary.ok = false;
  return summary;
}
