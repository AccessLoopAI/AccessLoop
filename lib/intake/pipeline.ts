// Public web intake (docs/domain.md §4-§6), server-only. Two steps:
//   buildPreview  - step 3 "Next": redact, summarize the REDACTED text, return the summary + a sealed token.
//   prepareCase   - "Send report": re-run redaction on the submitted text (the client is never trusted), use
//                   the token's AI result only if it was made by this server for exactly this text, and
//                   produce the createCase() input. It never calls the AI: without a valid token for the text it
//                   keeps layer 1 and flags the case for a person to check (domain §5's fail-closed result), so
//                   sending is never blocked on AI (domain §6.1 limit 4).
// `aiCtx` (lib/ai/context.ts) says who is asking: the preview action passes the request's headers, so the claude-cli
// backend can refuse anything that is not a local request. The fake and api backends ignore it.
// runIntakeAi is the AI part of an intake (the preview here, and staff-logged feedback in lib/intake/staff.ts): the two
// flagPii calls run in parallel and the whole thing has ONE time budget (docs/decisions.md 2026-10-20 "Intake AI
// budget"), so the review step never waits longer than intakeAiBudgetMs (10 s on api).
import type { CreateCaseInput } from "@/lib/cases/create";
import { sha256Hex } from "@/lib/crypto";
import {
  effectiveBackend,
  intakeAiBudgetMs,
  structureOrFallback,
  type AiContext,
  type AiMeta,
  type AiResult,
  type LocationKind,
  type PiiItem,
  type StructureOutput,
} from "@/lib/ai";
import { applyRedaction, detectPatterns, spansFromValues } from "@/lib/redaction/patterns";
import { coverSpans, logAiFailure, redact, redactWithItems, type Redaction } from "./redact";
import { openPreview, PREVIEW_TOKEN_MAX, sealPreview, type PreviewPayload } from "./preview-token";
import type { PreviewRequest, SubmitRequest } from "./types";

export interface Preview {
  summary: string | null;
  token: string | null;
}

export interface IntakeAi {
  /** The report text after layers 1 and 2 (layer 1 only, needsManualRedaction, when layer 2 failed or ran late). */
  text: Redaction;
  /** "Where exactly?" redacted the same way; null when it was empty. */
  detail: Redaction | null;
  /** structure() on text.redactedText; null = the shared fallback (no summary, manual triage). */
  ai: AiResult<StructureOutput> | null;
}

export interface IntakeAiOptions {
  aiOptOut: boolean;
  ai?: AiContext;
  /** The whole budget in ms (default intakeAiBudgetMs of the effective backend). Tests shorten it. */
  budgetMs?: number;
}

/** The budget for this intake; an AI_BACKEND nobody knows still gets one (its calls then fail as AiConfigError). */
function defaultBudgetMs(): number {
  try {
    return intakeAiBudgetMs(effectiveBackend());
  } catch {
    return intakeAiBudgetMs("api");
  }
}

/**
 * The AI part of one intake. Layer 2 on the report and on "Where exactly?" run IN PARALLEL; structure() starts as
 * soon as the report's own layer 2 is done (it reads the layers 1 + 2 text, never more than that). Everything shares
 * one deadline: a call that is not done by then gets its shared fallback (layer 1 + needsManualRedaction for flagPii,
 * no summary for structure), so this never takes much longer than the budget, whatever the backend does. Never throws
 * for an AI failure. With aiOptOut there is no AI call at all.
 */
export async function runIntakeAi(
  text: string,
  detail: string | null,
  locationKind: LocationKind,
  opts: IntakeAiOptions,
): Promise<IntakeAi> {
  if (opts.aiOptOut) {
    return { text: redactWithItems(text, null), detail: detail ? redactWithItems(detail, null) : null, ai: null };
  }
  const deadline = Date.now() + (opts.budgetMs ?? defaultBudgetMs());
  const call = { aiOptOut: false, ai: opts.ai, deadline };
  const textP = redact(text, call);
  const detailP = detail ? redact(detail, call) : Promise.resolve(null);
  // The shared fallback: on any AI failure there is no summary (manual triage, the reporter keeps their own words).
  const aiP = textP.then((t) => structureOrFallback(t.redactedText, locationKind, opts.ai, logAiFailure, { deadline }));
  const [t, d, ai] = await Promise.all([textP, detailP, aiP]);
  return { text: t, detail: d, ai };
}

/** The fields of AiMeta that the preview token carries and createCase stores (no usage: that is for the eval). */
function storedMeta(m: AiMeta): AiMeta {
  const out: AiMeta = { backend: m.backend, model: m.model, promptSha: m.promptSha, latencyMs: m.latencyMs };
  if (m.cliVersion) out.cliVersion = m.cliVersion;
  return out;
}

/**
 * Step 3 -> step 4. With aiOptOut nothing runs (no AI call at all) and the review shows the words only.
 * The AI steps share one budget (runIntakeAi: 10 s end to end on api, 60 s on claude-cli): the review step shows
 * "Summarizing your report…" meanwhile, and "Send report" never waits for the AI (the sealed token carries this result).
 */
export async function buildPreview(
  orgId: string,
  req: PreviewRequest,
  aiCtx?: AiContext,
  opts: { budgetMs?: number } = {},
): Promise<Preview> {
  if (req.aiOptOut) return { summary: null, token: null };
  const run = await runIntakeAi(req.text, req.locationDetail || null, req.locationKind, {
    aiOptOut: false,
    ai: aiCtx,
    budgetMs: opts.budgetMs,
  });
  const { text, detail } = run;
  const ai: { value: StructureOutput; meta: AiMeta } | null = run.ai ? { value: run.ai.value, meta: storedMeta(run.ai.meta) } : null;

  let token: string;
  try {
    token = sealPreview({
      orgId,
      maskedSha256: sha256Hex(text.redactedText),
      pii: text.piiItems,
      detail: detail ? { sha: sha256Hex(detail.redactedText), pii: detail.piiItems } : null,
      ai,
    });
  } catch (err) {
    // A configuration problem (SESSION_SECRET or ENCRYPTION_KEY not set): say so on the server, never silently.
    // Without a token the summary can't be used at "Send report", so the review shows the reporter's words.
    logConfigFailure("preview token could not be sealed", err);
    return { summary: null, token: null };
  }
  if (token.length > PREVIEW_TOKEN_MAX) {
    // A real model's very long answer: "Send report" could not accept this token. Same fallback as a structure()
    // failure (no summary, the review shows the person's own words), never a report that can't be sent. The token
    // is sealed again without the summary, so sending keeps layer 2; if even that is too long, there is no token
    // and sending keeps layer 1 and flags the case for a person to check.
    console.error("[intake] the preview token is too long for Send report; the review shows the person's own words");
    const reseal = sealWithoutSummary(orgId, text, detail);
    return { summary: null, token: reseal && reseal.length <= PREVIEW_TOKEN_MAX ? reseal : null };
  }
  return { summary: ai?.value.summary ?? null, token };
}

function sealWithoutSummary(orgId: string, text: Redaction, detail: Redaction | null): string | null {
  try {
    return sealPreview({
      orgId,
      maskedSha256: sha256Hex(text.redactedText),
      pii: text.piiItems,
      detail: detail ? { sha: sha256Hex(detail.redactedText), pii: detail.piiItems } : null,
      ai: null,
    });
  } catch {
    return null; // it was sealed a moment ago with the same secrets; never a failed preview
  }
}

/** Only lib/crypto.ts's text-free configuration messages ("SESSION_SECRET is not set") are logged, never data. */
function logConfigFailure(what: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  const message = err instanceof Error && /^(SESSION_SECRET|ENCRYPTION_KEY) /.test(err.message) ? `: ${err.message}` : "";
  console.error(`[intake] ${what} (${name}${message})`);
}

/**
 * Redaction of one text at "Send report", reusing the token's layer-2 values when they reproduce the exact same
 * result. Never calls the AI (domain §6.1 limit 4): without a matching token it keeps layer 1 and sets
 * needsManualRedaction, the same result as a flagPii failure (domain §5), and the lead's review finds the names.
 */
function redactSubmitted(
  raw: string,
  aiOptOut: boolean,
  fromToken: { sha: string; pii: PiiItem[] | null } | null,
): { redaction: Redaction; matchedToken: boolean } {
  if (aiOptOut) return { redaction: redactWithItems(raw, null), matchedToken: false };
  if (fromToken) {
    const again = redactWithItems(raw, fromToken.pii);
    if (sha256Hex(again.redactedText) === fromToken.sha) return { redaction: again, matchedToken: true };
  }
  return { redaction: redactWithItems(raw, null), matchedToken: false };
}

/** Layer 1, plus the report's own layer-2 values (e.g. the reporter's name), on the reporter's edited summary. */
function redactEditedSummary(edited: string, piiItems: PiiItem[] | null): string {
  const spans = coverSpans([...detectPatterns(edited), ...(piiItems ? spansFromValues(edited, piiItems, "llm") : [])]);
  return applyRedaction(edited, spans);
}

export type PreparedCase = Omit<CreateCaseInput, "receivedAt">;

/**
 * Everything createCase() needs for a public web report. `req` is already validated (zod) and trimmed;
 * `email` is the validated address or null (anonymous). It makes no AI call (see redactSubmitted).
 */
export async function prepareCase(orgId: string, req: SubmitRequest, email: string | null): Promise<PreparedCase> {
  let payload: PreviewPayload | null = req.aiOptOut ? null : openPreview(req.token);
  if (payload && payload.orgId !== orgId) payload = null; // a token from another org's form is worthless here

  const text = redactSubmitted(req.text, req.aiOptOut, payload ? { sha: payload.maskedSha256, pii: payload.pii } : null);
  const detail = req.locationDetail ? redactSubmitted(req.locationDetail, req.aiOptOut, payload?.detail ?? null) : null;

  // The AI result counts only if it was computed on exactly the redacted text we are about to store.
  const ai = payload && text.matchedToken ? payload.ai : null;

  let summary: string | null;
  let summarySource: PreparedCase["summarySource"];
  const edited = req.editedSummary.trim();
  if (ai && req.choice === "ai_confirmed") {
    summary = ai.value.summary;
    summarySource = "ai_confirmed";
  } else if (ai && req.choice === "ai_edited" && edited) {
    summary = redactEditedSummary(edited, text.redaction.piiItems);
    // "Change it" without a change is a confirmation, not a correction (the correction-rate metric).
    summarySource = summary === ai.value.summary ? "ai_confirmed" : "ai_edited";
  } else {
    // "Keep my words only", AI opt-out or no valid AI result: no summary at all. The report itself
    // (redactedText) is what staff read. A copy here would also land in the append-only ai_structured
    // payload (createCase's confirmedValue), where the lead's layer-3 review could never correct it
    // (domain §8). summarySource alone records the choice for the correction rate (domain §6).
    summary = null;
    summarySource = "reporter_words";
  }

  return {
    orgId,
    intakeChannel: "web",
    locationKind: req.locationKind,
    locationDetail: detail ? detail.redaction.redactedText : null,
    rawText: req.text,
    redactedText: text.redaction.redactedText,
    spans: text.redaction.spans,
    // A person must check by hand whenever layer 2 did not cover some reporter text: the report or the
    // detail (AI opt-out, flagPii failed, no valid preview token for it), or a summary the reporter rewrote.
    // An edit only gets layer 1 plus the report's own layer-2 values: a new name in it is not found, and
    // calling flagPii at "Send report" would block the submit on the AI (domain §6.1 limit 4).
    needsManualRedaction:
      text.redaction.needsManualRedaction ||
      Boolean(detail?.redaction.needsManualRedaction) ||
      summarySource === "ai_edited",
    isAnonymous: email === null,
    wantsRetest: req.wantsRetest,
    aiOptOut: req.aiOptOut,
    reporterEmail: email,
    reporterContact: null,
    ai: ai
      ? {
          summary: ai.value.summary,
          priorityAreas: ai.value.priorityAreas,
          uncertain: ai.value.uncertain,
          backend: ai.meta.backend,
          model: ai.meta.model,
          promptSha: ai.meta.promptSha,
          latencyMs: ai.meta.latencyMs,
          cliVersion: ai.meta.cliVersion,
        }
      : null,
    summary,
    summarySource,
    loggedByMemberId: null,
    codeRelayedByStaff: false,
  };
}
