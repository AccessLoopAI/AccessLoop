// Reading reports for the pages (server-only, Node runtime; opens withOrg). The org always comes from the server:
// the staff session (getStaff) or a public slug lookup (getPublicOrg), never from the request. Staff see their own
// org's reports (drafts included); the public sees a report only once it is signed off AND published.
import { cache } from "react";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { orgMembers, orgs, reports } from "@/db/schema";
import { resolvePublishedReport, withOrg, type TenantRole } from "@/db/tenant";
import { absoluteUrl } from "@/lib/app-url";
import { getPublicOrg, type PublicOrg } from "@/lib/orgs";
import { buildEvidenceBundle, type EvidenceBundle } from "./bundle";
import { citedCaseIds } from "./compose";
import type { EvidenceCheck } from "./evidence";
import type { CheckResult } from "./headings";
import { SIGNING_KEYS_PATH, VERIFIER_PATH } from "./labels";
import { reportReadiness, type ReportReadiness } from "./readiness";
import type { ReportContent, ReportPeriod, ReportSnapshot } from "./types";
import { loadChains, loadVerifyTarget, runEvidenceCheck, type VerifyTarget } from "./verify";
import { reportState, type ReportState } from "./view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A report id from a URL: only a well-formed uuid can be one (anything else is a 404 without a query). */
export const isReportId = (id: string): boolean => UUID.test(id);

export interface ReportRow {
  id: string;
  orgId: string;
  title: string;
  status: "draft" | "signed_off";
  periodStart: string;
  periodEnd: string;
  snapshot: ReportSnapshot;
  manifestHash: string;
  content: ReportContent;
  headingCheck: CheckResult[];
  areaText: Record<string, string>;
  consultationsText: string | null;
  createdBy: string;
  createdAt: Date;
  signedOffBy: string | null;
  signedOffAt: Date | null;
  publishedAt: Date | null;
}

const COLUMNS = {
  id: reports.id,
  orgId: reports.orgId,
  title: reports.title,
  status: reports.status,
  periodStart: reports.periodStart,
  periodEnd: reports.periodEnd,
  snapshot: reports.snapshot,
  manifestHash: reports.manifestHash,
  content: reports.content,
  headingCheck: reports.headingCheck,
  areaText: reports.areaText,
  consultationsText: reports.consultationsText,
  createdBy: reports.createdBy,
  createdAt: reports.createdAt,
  signedOffBy: reports.signedOffBy,
  signedOffAt: reports.signedOffAt,
  publishedAt: reports.publishedAt,
};

const asRow = (r: Record<string, unknown>): ReportRow => ({ ...(r as unknown as ReportRow), areaText: (r.areaText ?? {}) as Record<string, string> });

export interface StaffReport {
  report: ReportRow;
  /** Display names of the member who generated it and the one who signed it off (staff pages only). */
  createdByName: string | null;
  signedOffByName: string | null;
  /** orgs.regulator: who to notify within 48 hours of publishing (ACR s.16). */
  regulator: string;
}

/** One report of the signed-in member's org, or null (unknown id, another org's report). */
export async function loadStaffReport(staff: { orgId: string; role: TenantRole }, id: string): Promise<StaffReport | null> {
  if (!isReportId(id)) return null;
  const found = await withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const [row] = await tx.select(COLUMNS).from(reports).where(and(eq(reports.id, id), eq(reports.orgId, staff.orgId))).limit(1);
    if (!row) return null;
    const ids = [row.createdBy, row.signedOffBy].filter((x): x is string => !!x);
    const names = await tx
      .select({ id: orgMembers.id, name: orgMembers.displayName })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, staff.orgId), inArray(orgMembers.id, ids)));
    const nameOf = (m: string | null) => (m ? (names.find((n) => n.id === m)?.name ?? null) : null);
    return { report: asRow(row), createdByName: nameOf(row.createdBy), signedOffByName: nameOf(row.signedOffBy) };
  });
  if (!found) return null;
  const [org] = await db.select({ regulator: orgs.regulator }).from(orgs).where(eq(orgs.id, staff.orgId)).limit(1);
  return { ...found, regulator: org?.regulator ?? "accessibility_commissioner" };
}

export interface ReportListItem {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  status: "draft" | "signed_off";
  headingCheck: CheckResult[];
  createdAt: Date;
  createdByName: string | null;
  publishedAt: Date | null;
}

/** Every report of the member's org, newest first. */
export async function listStaffReports(staff: { orgId: string; role: TenantRole }): Promise<ReportListItem[]> {
  return withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const rows = await tx
      .select({
        id: reports.id,
        title: reports.title,
        periodStart: reports.periodStart,
        periodEnd: reports.periodEnd,
        status: reports.status,
        headingCheck: reports.headingCheck,
        createdAt: reports.createdAt,
        createdByName: orgMembers.displayName,
        publishedAt: reports.publishedAt,
      })
      .from(reports)
      .leftJoin(orgMembers, eq(orgMembers.id, reports.createdBy))
      .where(eq(reports.orgId, staff.orgId))
      .orderBy(desc(reports.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r, headingCheck: (r.headingCheck ?? []) as CheckResult[] }));
  });
}

export interface DashboardReport {
  id: string;
  title: string;
  period: ReportPeriod;
  state: ReportState;
  createdAt: Date;
  createdByName: string | null;
}

export interface DashboardReports {
  /** The newest report for exactly the dashboard's period (any state), with its checks; null when there is none. */
  forPeriod: (DashboardReport & { readiness: ReportReadiness }) | null;
  /** The org's newest report, whatever its period: where the evidence-integrity card's /verify link goes. */
  latest: DashboardReport | null;
}

/**
 * The dashboard's two report cards (docs/domain.md §10 items 5 and 6), for the org's lead or auditor (owners never
 * see the dashboard, so they get nothing). "For the period" = the same start and end dates; newest first, as on
 * /app/reports. The checks are re-run from the stored content (lib/report/readiness.ts), never read from a cache.
 */
export async function loadDashboardReports(staff: { orgId: string; role: TenantRole }, period: ReportPeriod): Promise<DashboardReports> {
  if (staff.role !== "lead" && staff.role !== "auditor") return { forPeriod: null, latest: null };
  return withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const base = {
      id: reports.id,
      title: reports.title,
      status: reports.status,
      periodStart: reports.periodStart,
      periodEnd: reports.periodEnd,
      createdAt: reports.createdAt,
      publishedAt: reports.publishedAt,
      createdByName: orgMembers.displayName,
    };
    const newestFirst = [desc(reports.createdAt), desc(reports.id)] as const;
    const [p] = await tx
      .select({ ...base, content: reports.content, areaText: reports.areaText, consultationsText: reports.consultationsText })
      .from(reports)
      .leftJoin(orgMembers, eq(orgMembers.id, reports.createdBy))
      .where(and(eq(reports.orgId, staff.orgId), eq(reports.periodStart, period.start), eq(reports.periodEnd, period.end)))
      .orderBy(...newestFirst)
      .limit(1);
    const [l] = await tx
      .select(base)
      .from(reports)
      .leftJoin(orgMembers, eq(orgMembers.id, reports.createdBy))
      .where(eq(reports.orgId, staff.orgId))
      .orderBy(...newestFirst)
      .limit(1);
    const summary = (r: NonNullable<typeof l>): DashboardReport => ({
      id: r.id,
      title: r.title,
      period: { start: r.periodStart, end: r.periodEnd },
      state: reportState(r),
      createdAt: r.createdAt,
      createdByName: r.createdByName,
    });
    return {
      forPeriod: p
        ? {
            ...summary(p),
            readiness: reportReadiness({
              status: p.status,
              publishedAt: p.publishedAt,
              content: p.content as ReportContent,
              areaText: (p.areaText ?? {}) as Record<string, string>,
              consultationsText: p.consultationsText,
            }),
          }
        : null,
      latest: l ? summary(l) : null,
    };
  });
}

export interface PublishedListItem {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  publishedAt: Date;
}

/** An org's published reports (newest first), for its public page. */
export async function listPublishedReports(orgId: string): Promise<PublishedListItem[]> {
  return withOrg({ orgId, role: "public" }, async (tx) => {
    const rows = await tx
      .select({ id: reports.id, title: reports.title, periodStart: reports.periodStart, periodEnd: reports.periodEnd, publishedAt: reports.publishedAt })
      .from(reports)
      .where(and(eq(reports.orgId, orgId), eq(reports.status, "signed_off"), isNotNull(reports.publishedAt)))
      .orderBy(desc(reports.publishedAt))
      .limit(100);
    return rows.filter((r): r is PublishedListItem => r.publishedAt !== null);
  });
}

/**
 * A published report of the org with this public slug, or null (unknown slug or id, draft, signed off only).
 * Cached per request (the page and its metadata share one lookup).
 */
export const loadPublishedReport = cache(async (slug: string, id: string): Promise<{ org: PublicOrg; report: ReportRow } | null> => {
  if (!isReportId(id)) return null;
  const org = await getPublicOrg(slug);
  if (!org) return null;
  const row = await withOrg({ orgId: org.id, role: "public" }, async (tx) => {
    const [r] = await tx
      .select(COLUMNS)
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.orgId, org.id), eq(reports.status, "signed_off"), isNotNull(reports.publishedAt)))
      .limit(1);
    return r ?? null;
  });
  return row ? { org, report: asRow(row) } : null;
});

/**
 * "Download evidence bundle" (lib/report/bundle.ts): a PUBLISHED report of the org with this slug, with its cited
 * cases' histories as public-safe fields only, or null (anything not published). Reads case_events only.
 */
export async function loadPublishedBundle(slug: string, id: string, now: Date): Promise<{ report: ReportRow; bundle: EvidenceBundle } | null> {
  const found = await loadPublishedReport(slug, id);
  if (!found) return null;
  const { org, report } = found;
  const chains = await withOrg({ orgId: org.id, role: "public" }, (tx) => loadChains(tx, org.id, citedCaseIds(report.content, report.snapshot)));
  const bundle = buildEvidenceBundle({
    org: { name: org.name, slug: org.slug },
    report,
    chains,
    now,
    links: {
      report: absoluteUrl(`/p/${org.slug}/reports/${report.id}`),
      verify: absoluteUrl(`/verify/${report.id}`),
      signingKeys: absoluteUrl(SIGNING_KEYS_PATH),
      verifier: absoluteUrl(VERIFIER_PATH),
    },
  });
  return { report, bundle };
}

export interface Evidence {
  target: VerifyTarget;
  check: EvidenceCheck;
}

/**
 * /verify for signed-in staff: a report of the member's own org, draft or published, or null. Leads and auditors
 * only (domain §2: owners see only their assigned cases, and a draft's evidence lists every case of its period).
 */
export async function loadStaffEvidence(staff: { orgId: string; role: TenantRole }, id: string): Promise<Evidence | null> {
  if (!isReportId(id) || (staff.role !== "lead" && staff.role !== "auditor")) return null;
  return withOrg({ orgId: staff.orgId, role: staff.role }, async (tx) => {
    const target = await loadVerifyTarget(tx, staff.orgId, id, { publishedOnly: false });
    return target ? { target, check: await runEvidenceCheck(tx, staff.orgId, target) } : null;
  });
}

export interface PublicEvidence extends Evidence {
  org: { id: string; name: string; slug: string };
}

/** /verify for everyone else: only a signed-off AND published report (its org from resolvePublishedReport), or null. */
export async function loadPublicEvidence(id: string): Promise<PublicEvidence | null> {
  if (!isReportId(id)) return null;
  const orgId = await resolvePublishedReport(id);
  if (!orgId) return null;
  // orgs is not tenant-scoped: read it directly, by the id the database function resolved.
  const [org] = await db.select({ id: orgs.id, name: orgs.name, slug: orgs.slug }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (!org) return null;
  const found = await withOrg({ orgId, role: "public" }, async (tx) => {
    const target = await loadVerifyTarget(tx, orgId, id, { publishedOnly: true });
    return target ? { target, check: await runEvidenceCheck(tx, orgId, target) } : null;
  });
  return found ? { ...found, org } : null;
}
