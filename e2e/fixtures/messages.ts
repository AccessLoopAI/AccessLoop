// E2E-only fixture (never imported by the app): reads what the mailer logged (outbound_messages) and an org's
// settings, and puts settings back after a test changed them. Uses the app's one db/client pool, like
// e2e/fixtures/cases.ts: never end it in a spec. outbound_messages is read inside withOrg (RLS); orgs is not
// tenant-scoped (domain §9), so it is read and restored with `db`, by slug.
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { cases, orgs, outboundMessages } from "@/db/schema";
import { withOrg } from "@/db/tenant";

async function orgIdOf(slug: string): Promise<string> {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!org) throw new Error(`org ${slug} is not in the database (run npm run local:setup)`);
  return org.id;
}

export interface LoggedMessage {
  id: string;
  template: string;
  status: string;
  channel: string;
  providerId: string | null;
}

/** Every email logged for one case, oldest first. */
export async function messagesOf(slug: string, ref: string): Promise<LoggedMessage[]> {
  const orgId = await orgIdOf(slug);
  return withOrg({ orgId, role: "system" }, (tx) =>
    tx
      .select({
        id: outboundMessages.id,
        template: outboundMessages.template,
        status: outboundMessages.status,
        channel: outboundMessages.channel,
        providerId: outboundMessages.providerId,
      })
      .from(outboundMessages)
      .innerJoin(cases, and(eq(cases.id, outboundMessages.caseId), eq(cases.orgId, outboundMessages.orgId)))
      .where(and(eq(outboundMessages.orgId, orgId), eq(cases.ref, ref)))
      .orderBy(asc(outboundMessages.createdAt)),
  );
}

/** How many emails an org has logged. */
export async function outboxCount(slug: string): Promise<number> {
  const orgId = await orgIdOf(slug);
  const [row] = await withOrg({ orgId, role: "system" }, (tx) =>
    tx.select({ n: sql<number>`count(*)::int` }).from(outboundMessages).where(eq(outboundMessages.orgId, orgId)),
  );
  return row?.n ?? 0;
}

export type OrgSettingsRow = Pick<
  typeof orgs.$inferSelect,
  "feedbackDesignateTitle" | "contactMailingAddress" | "contactPhone" | "contactEmail" | "retestOfferText" | "planAreas" | "entityClass"
>;

export async function orgSettingsOf(slug: string): Promise<OrgSettingsRow> {
  const [row] = await db
    .select({
      feedbackDesignateTitle: orgs.feedbackDesignateTitle,
      contactMailingAddress: orgs.contactMailingAddress,
      contactPhone: orgs.contactPhone,
      contactEmail: orgs.contactEmail,
      retestOfferText: orgs.retestOfferText,
      planAreas: orgs.planAreas,
      entityClass: orgs.entityClass,
    })
    .from(orgs)
    .where(eq(orgs.slug, slug))
    .limit(1);
  if (!row) throw new Error(`org ${slug} is not in the database`);
  return row;
}

/** Put an org's settings back exactly as they were (tests must never leave them changed). */
export async function restoreOrgSettings(slug: string, values: OrgSettingsRow): Promise<void> {
  await db.update(orgs).set(values).where(eq(orgs.slug, slug));
}
