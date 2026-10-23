// The only writes to a report after it is generated (docs/domain.md §7 steps 7-9): the lead's text for each plan area
// and for Consultations, sign-off, and publishing. Each runs inside the caller's withOrg() transaction, locks the row,
// and updates it only while it is in the state the step needs (`where status = 'draft'` for text and sign-off), so a
// signed-off report can never change: every later edit is refused (docs/decisions.md: immutability is enforced by
// the app, because the app role keeps UPDATE on reports). Takes a tx only (testable on PGlite). Sign-off also writes
// reports.content.signing, once, in the same UPDATE (the signed root, lib/report/signing.ts).
import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { reports } from "@/db/schema";
import { reportChecks, type ReportChecks } from "./compose";
import { LEAD_TEXT_MAX } from "./labels";
import type { PriorityArea } from "./headings";
import { buildSigning } from "./signing";
import { loadReportSigner, SigningKeyError, type ReportSigner } from "./signing-key";
import type { ReportContent } from "./types";
import { loadOrgHeads, runEvidenceCheck } from "./verify";

export type EditRefusal =
  /** No such report in this org. */
  | "not_found"
  /** Text or sign-off on a report that is already signed off. */
  | "not_draft"
  /** A section that has no text box (General, Feedback, an area outside the draft's plan). */
  | "invalid_section"
  | "too_long"
  /** Sign-off while a required check fails, a part is unwritten, or a sentence has no sources. */
  | "not_ready"
  /** Publishing a draft. */
  | "not_signed_off"
  | "already_published"
  /** Sign-off with no report signing key configured (REPORT_SIGNING_KEY; derived only in AUTH_MODE=local). */
  | "signing_unavailable"
  /** Sign-off while the report's evidence check fails or any case history of the org does not verify. */
  | "evidence_failed";

export type EditResult = { ok: true; checks: ReportChecks } | { ok: false; reason: EditRefusal; checks?: ReportChecks };

async function lockReport(tx: Tx, orgId: string, reportId: string) {
  const [row] = await tx
    .select({
      status: reports.status,
      content: reports.content,
      areaText: reports.areaText,
      consultationsText: reports.consultationsText,
      publishedAt: reports.publishedAt,
    })
    .from(reports)
    .where(and(eq(reports.id, reportId), eq(reports.orgId, orgId)))
    .for("update");
  return row ? { ...row, content: row.content as ReportContent, areaText: (row.areaText ?? {}) as Record<string, string> } : null;
}

/** Line endings normalised, outer blank space trimmed. */
export function normalizeLeadText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/**
 * Save the lead's text for one section: `key` is "area:<area>" for an area of the plan the draft was built from
 * (content.settings.planAreas, frozen with the draft) or "consultations". Empty text clears the section again.
 * The checks are recomputed and stored with the text (reports.heading_check).
 */
export async function saveLeadText(tx: Tx, a: { orgId: string; reportId: string; key: string; text: string }): Promise<EditResult> {
  const text = normalizeLeadText(a.text);
  if (text.length > LEAD_TEXT_MAX) return { ok: false, reason: "too_long" };
  const row = await lockReport(tx, a.orgId, a.reportId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "draft") return { ok: false, reason: "not_draft" };

  const planAreas: readonly PriorityArea[] = row.content.settings?.planAreas ?? [];
  let areaText = row.areaText;
  let consultationsText = row.consultationsText;
  if (a.key === "consultations") consultationsText = text || null;
  else if (a.key.startsWith("area:") && planAreas.includes(a.key.slice(5) as PriorityArea)) {
    const area = a.key.slice(5);
    areaText = { ...areaText };
    if (text) areaText[area] = text;
    else delete areaText[area];
  } else return { ok: false, reason: "invalid_section" };

  const checks = reportChecks(row.content, areaText, consultationsText);
  const updated = await tx
    .update(reports)
    .set({ areaText, consultationsText, headingCheck: checks.results })
    .where(and(eq(reports.id, a.reportId), eq(reports.orgId, a.orgId), eq(reports.status, "draft")))
    .returning({ id: reports.id });
  if (updated.length !== 1) return { ok: false, reason: "not_draft" };
  return { ok: true, checks };
}

/**
 * Sign off (lead): only a draft whose checks allow it (reportChecks().canSignOff). Afterwards it is immutable.
 * In the same UPDATE it seals and signs the report (docs/domain.md §8 "Signed at sign-off"): only when the
 * report's own evidence check passes (checks 1-3, as /verify runs them) AND every case history of the org verifies,
 * the root over all their heads, the snapshot fingerprint, the lead's text and the sentences is signed with the
 * report signing key and stored as reports.content.signing. `signer` defaults to the key from the environment
 * (lib/report/signing-key.ts); without one nothing is signed off ("signing_unavailable").
 */
export async function signOffReport(
  tx: Tx,
  a: { orgId: string; reportId: string; memberId: string; now: Date; signer?: Pick<ReportSigner, "keyId" | "privateKey"> },
): Promise<EditResult> {
  const row = await lockReport(tx, a.orgId, a.reportId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "draft") return { ok: false, reason: "not_draft" };
  const checks = reportChecks(row.content, row.areaText, row.consultationsText);
  if (!checks.canSignOff) return { ok: false, reason: "not_ready", checks };

  let signer: Pick<ReportSigner, "keyId" | "privateKey">;
  try {
    signer = a.signer ?? loadReportSigner();
  } catch (err) {
    if (err instanceof SigningKeyError) {
      console.error(`[reports] sign-off refused: ${err.message}`); // the variable's name only, never a value
      return { ok: false, reason: "signing_unavailable", checks };
    }
    throw err;
  }

  // Sign only what verifies: the report as /verify checks it, then every case history of the org.
  const [stored] = await tx
    .select({ snapshot: reports.snapshot, manifestHash: reports.manifestHash })
    .from(reports)
    .where(and(eq(reports.id, a.reportId), eq(reports.orgId, a.orgId)));
  const evidence = await runEvidenceCheck(tx, a.orgId, { snapshot: stored.snapshot, content: row.content, manifestHash: stored.manifestHash });
  if (!evidence.allOk) return { ok: false, reason: "evidence_failed", checks };
  const { heads, broken } = await loadOrgHeads(tx, a.orgId);
  if (broken.length > 0) return { ok: false, reason: "evidence_failed", checks };

  // Millisecond precision, so the stored signed_off_at reads back as exactly the signed `signedAt`.
  const signedAt = new Date(Math.floor(a.now.getTime()));
  const signing = buildSigning({
    reportId: a.reportId,
    signedAt,
    heads,
    manifestHash: stored.manifestHash,
    areaText: row.areaText,
    consultationsText: row.consultationsText,
    content: row.content,
    signer,
  });
  const updated = await tx
    .update(reports)
    .set({ status: "signed_off", signedOffBy: a.memberId, signedOffAt: signedAt, headingCheck: checks.results, content: { ...row.content, signing } })
    .where(and(eq(reports.id, a.reportId), eq(reports.orgId, a.orgId), eq(reports.status, "draft")))
    .returning({ id: reports.id });
  if (updated.length !== 1) return { ok: false, reason: "not_draft" };
  return { ok: true, checks };
}

/** Publish (lead): a signed-off report, once. The public page and the public /verify open from then on. */
export async function publishReport(tx: Tx, a: { orgId: string; reportId: string; now: Date }): Promise<EditResult> {
  const row = await lockReport(tx, a.orgId, a.reportId);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "signed_off") return { ok: false, reason: "not_signed_off" };
  if (row.publishedAt) return { ok: false, reason: "already_published" };
  const checks = reportChecks(row.content, row.areaText, row.consultationsText);
  const updated = await tx
    .update(reports)
    .set({ publishedAt: a.now })
    .where(and(eq(reports.id, a.reportId), eq(reports.orgId, a.orgId), eq(reports.status, "signed_off"), isNull(reports.publishedAt)))
    .returning({ id: reports.id });
  if (updated.length !== 1) return { ok: false, reason: "already_published" };
  return { ok: true, checks };
}
