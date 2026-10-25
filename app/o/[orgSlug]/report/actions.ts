"use server";

// Server actions of the public reporter flow (docs/domain.md §4). The org is resolved here from the route's
// slug through the `orgs` table; nothing the browser sends is trusted (zod, then redaction runs again).
// Never log request bodies, report text, emails or receipt codes.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { aiRequestContext } from "@/lib/ai/context";
import { buildPreview } from "@/lib/intake/pipeline";
import { PREVIEW_TOKEN_MAX } from "@/lib/intake/preview-token";
import { RECEIPT_COOKIE, RECEIPT_COOKIE_MAX_AGE_S, receiptPath } from "@/lib/intake/receipt-cookie";
import { saveWebReport } from "@/lib/intake/submit";
import {
  DETAIL_MAX,
  EDITED_SUMMARY_MAX,
  EMAIL_MAX,
  LOCATION_KINDS,
  SUMMARY_CHOICES,
  TEXT_MAX,
  type PreviewResponse,
  type SubmitState,
} from "@/lib/intake/types";
import { getPublicOrg } from "@/lib/orgs";
import {
  limitRequest,
  logRateLimitFailure,
  orgFullMessage,
  RATE_LIMITED_MESSAGE,
  reserveAiForPreview,
} from "@/lib/rate-limit";

const ReportFields = {
  text: z.string().trim().min(1).max(TEXT_MAX),
  locationKind: z.enum(LOCATION_KINDS),
  locationDetail: z.string().trim().max(DETAIL_MAX),
  aiOptOut: z.boolean(),
};

const PreviewSchema = z.object(ReportFields);

const SubmitSchema = z.object({
  ...ReportFields,
  wantsRetest: z.boolean(),
  emailChoice: z.enum(["anonymous", "email"]),
  email: z.string().trim().max(EMAIL_MAX),
  choice: z.enum(SUMMARY_CHOICES).nullable(),
  editedSummary: z.string().max(EDITED_SUMMARY_MAX),
  token: z.string().max(PREVIEW_TOKEN_MAX).nullable(),
});

/** Step 3 "Next": redaction + AI summary of the redacted text. Returns the summary and a sealed token. */
export async function previewReport(orgSlug: string, input: unknown): Promise<PreviewResponse> {
  try {
    if (!(await limitRequest("intake_preview")).ok) return { ok: false, rateLimited: true };
  } catch (err) {
    // The review then shows the person's own words; sending still works (and says so if it can't).
    logRateLimitFailure("could not check the preview limit", err);
    return { ok: false };
  }
  const org = await getPublicOrg(String(orgSlug));
  const parsed = PreviewSchema.safeParse(input);
  if (!org || !parsed.success) return { ok: false };
  // The hour's AI budget (lib/rate-limit.ts, AI_GLOBAL_HOURLY_LIMIT): past it, or if it can't be checked, this report
  // takes the manual path: no AI call and no token, so "Send report" keeps layer 1 and flags the case for a person
  // to redact and triage (domain §5's fail-closed result). The reporter's own AI choice is not changed.
  if (!parsed.data.aiOptOut) {
    let budget = false;
    try {
      budget = (await reserveAiForPreview(parsed.data.locationDetail !== "")).ok;
    } catch (err) {
      logRateLimitFailure("could not check the AI budget", err);
    }
    if (!budget) return { ok: true, summary: null, token: null, aiPaused: true };
  }
  // The Host tells the claude-cli backend whether this is a local request (domain §6.1); fake and api ignore it.
  const preview = await buildPreview(org.id, parsed.data, aiRequestContext(await headers()));
  return { ok: true, summary: preview.summary, token: preview.token };
}

function failed(error: string): SubmitState {
  return { ok: false, error, at: Date.now() };
}

/** "Send report": create the case, then show the receipt. On success it redirects and never returns. */
export async function submitReport(_prev: SubmitState, input: unknown): Promise<SubmitState> {
  try {
    if (!(await limitRequest("intake_submit")).ok) return failed(RATE_LIMITED_MESSAGE);
  } catch (err) {
    logRateLimitFailure("could not check the submit limit", err);
    return failed("We could not send your report just now. Your answers are still here. Please try again.");
  }
  const slug = typeof input === "object" && input !== null ? (input as { orgSlug?: unknown }).orgSlug : undefined;
  const org = await getPublicOrg(String(slug ?? ""));
  if (!org) return failed("We could not find this organization's form. Reload the page and try again.");

  const parsed = SubmitSchema.safeParse(input);
  if (!parsed.success) return failed("Part of your report could not be read. Go back and check your answers.");
  const req = parsed.data;

  // lib/intake/submit.ts: the email check, the org's daily cap (counted last), the case, then the email after commit.
  const saved = await saveWebReport(org.id, req);
  if (!saved.ok) {
    if (saved.problem === "email") {
      return failed("Check your email address. It should look like name@example.com. You can go back to change it.");
    }
    if (saved.problem === "org_full") return failed(orgFullMessage(org));
    return failed("We could not send your report just now. Your answers are still here. Please try again.");
  }
  const receiptCode = saved.receiptCode;

  const h = await headers();
  const https = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https";
  (await cookies()).set(RECEIPT_COOKIE, receiptCode, {
    httpOnly: true,
    sameSite: "lax",
    path: receiptPath(org.slug),
    maxAge: RECEIPT_COOKIE_MAX_AGE_S,
    secure: https,
  });
  redirect(receiptPath(org.slug));
}
