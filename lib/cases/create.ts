// FROZEN core. The ONLY way to create a case (public intake, staff-logged intake, seed).
// Redaction and AI happen BEFORE this call; this function persists the results and the opening events.
import { eq, sql } from "drizzle-orm";
import { cases, casePrivate } from "@/db/schema";
import type { Tx } from "@/db/client";
import { lockOrgCounter } from "@/db/tenant";
import { appendCaseEvent } from "@/lib/case-events";
import { encrypt } from "@/lib/crypto";
import { generateReceiptCode, hashReceiptCode } from "@/lib/receipt-code";
import type { Span } from "@/lib/redaction/patterns";

type CaseInsert = typeof cases.$inferInsert;

export interface CreateCaseInput {
  orgId: string;
  intakeChannel: CaseInsert["intakeChannel"];
  locationKind: CaseInsert["locationKind"];
  locationDetail?: string | null;   // already redacted
  rawText: string;                  // original, stored encrypted only
  redactedText: string;
  spans: Span[];                    // offsets + types only are logged, never values
  needsManualRedaction: boolean;
  isAnonymous: boolean;
  wantsRetest: boolean;
  aiOptOut: boolean;
  reporterEmail?: string | null;
  reporterContact?: string | null;  // staff-logged phone/mail contact details
  receivedAt: Date;
  ai?: { summary: string; priorityAreas: { area: string; confidence: number }[]; uncertain: string[];
    backend: "fake" | "claude-cli" | "api" | "seed"; // domain §6.1; only claude-cli/api count as real AI
    model: string; promptSha: string; latencyMs: number; cliVersion?: string } | null;
  summary: string | null;           // what the reporter confirmed (redacted)
  summarySource: CaseInsert["summarySource"];
  loggedByMemberId?: string | null; // staff-logged intake
  codeRelayedByStaff?: boolean;     // staff saw/read out the receipt code (domain §3); verifications counted apart
}

export async function createCase(tx: Tx, input: CreateCaseInput) {
  await lockOrgCounter(tx, input.orgId);
  const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${cases.seq}), 0)::int + 1` })
    .from(cases).where(eq(cases.orgId, input.orgId));
  const receiptCode = generateReceiptCode();
  const retention = new Date(input.receivedAt);
  retention.setUTCFullYear(retention.getUTCFullYear() + 7); // ACR s.19

  const [row] = await tx.insert(cases).values({
    orgId: input.orgId,
    seq: next,
    ref: `BAR-${String(next).padStart(4, "0")}`,
    status: "new",
    intakeChannel: input.intakeChannel,
    locationKind: input.locationKind,
    locationDetail: input.locationDetail ?? null,
    isAnonymous: input.isAnonymous,
    wantsRetest: input.wantsRetest,
    aiOptOut: input.aiOptOut,
    needsManualRedaction: input.needsManualRedaction,
    redactedText: input.redactedText,
    aiSummary: input.ai?.summary ?? null,
    aiPriorityAreas: input.ai?.priorityAreas ?? null,
    summary: input.summary,
    summarySource: input.summarySource,
    receiptCodeHash: hashReceiptCode(receiptCode)!,
    receivedAt: input.receivedAt,
    retentionUntil: retention.toISOString().slice(0, 10),
    createdAt: input.receivedAt,
    updatedAt: input.receivedAt,
  }).returning();

  await tx.insert(casePrivate).values({
    caseId: row.id,
    orgId: input.orgId,
    rawTextEnc: encrypt(input.rawText),
    reporterEmailEnc: input.reporterEmail ? encrypt(input.reporterEmail) : null,
    reporterContactEnc: input.reporterContact ? encrypt(input.reporterContact) : null,
  });

  const t = input.receivedAt.getTime();
  const staff = input.loggedByMemberId ?? null;
  await appendCaseEvent(tx, {
    orgId: input.orgId, caseId: row.id, type: "submitted",
    actorKind: staff ? "staff" : "reporter", actorId: staff, createdAt: new Date(t),
    payload: { channel: input.intakeChannel, locationKind: input.locationKind, isAnonymous: input.isAnonymous,
      wantsRetest: input.wantsRetest, aiOptOut: input.aiOptOut, summarySource: input.summarySource,
      hasEmail: !!input.reporterEmail, codeRelayedByStaff: !!input.codeRelayedByStaff },
  });
  await appendCaseEvent(tx, {
    orgId: input.orgId, caseId: row.id, type: "redaction_proposed", actorKind: "system", actorId: null,
    createdAt: new Date(t + 1),
    payload: { spans: input.spans.map(({ start, end, type, source }) => ({ start, end, type, source })),
      needsManualRedaction: input.needsManualRedaction },
  });
  if (input.ai) {
    await appendCaseEvent(tx, {
      orgId: input.orgId, caseId: row.id, type: "ai_structured", actorKind: "system", actorId: null,
      createdAt: new Date(t + 2),
      payload: { backend: input.ai.backend, model: input.ai.model, cliVersion: input.ai.cliVersion,
        promptSha: input.ai.promptSha, latencyMs: input.ai.latencyMs,
        aiValue: { summary: input.ai.summary, priorityAreas: input.ai.priorityAreas, uncertain: input.ai.uncertain },
        confirmedValue: { summary: input.summary, summarySource: input.summarySource } },
    });
  }
  // ACR s.9(4): web intake is acknowledged on screen (the receipt page), in the same means.
  if (input.intakeChannel === "web") {
    await appendCaseEvent(tx, {
      orgId: input.orgId, caseId: row.id, type: "ack_recorded", actorKind: "system", actorId: null,
      createdAt: new Date(t + 3), payload: { channel: "web_screen", anonymous: input.isAnonymous },
    });
    await tx.update(cases).set({ ackAt: new Date(t + 3) }).where(eq(cases.id, row.id));
  }

  return { case: row, receiptCode }; // receiptCode is shown once to the reporter and never stored
}
