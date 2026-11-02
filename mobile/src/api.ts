// The reporter JSON API the app talks to (docs/archive/phase7-prompt.md, T4 item 6; docs/domain.md §4.1). THE one place that
// knows URLs, headers and request/response shapes. The screens use the app's own shapes below; the request
// functions turn them into the server's bodies (serverReportBody, serverRetestBody) and the parse* functions read
// the server's answers, so the screens never see the wire format.
//
//   GET  /api/v1/orgs/{slug}[?loc=]    the org's public profile, and a location poster's starting answers
//   POST /api/v1/orgs/{slug}/preview   redaction + AI summary of the redacted text; returns a sealed token
//   POST /api/v1/orgs/{slug}/reports   creates the case; returns the receipt code exactly once
//   GET  /api/v1/status                the reporter's view of their case (code in the Authorization header)
//   POST /api/v1/retest                one of the five re-test answers (code in the Authorization header)
//
// Aligned with the server on 2026-10-20 (Phase 7 integration, docs/decisions.md): the `Receipt` scheme; bodies
// are strict on the server, so only its own keys are sent (`followUp`, `summaryChoice`, `previewToken`; never
// `locationId` or `source`); answers are `{ organization, place }`, `{ summary, previewToken }`, `{ receiptCode,
// reference }`, `{ reference, organization, retest }`; errors are `{ error: { code, message } }`.
//
// Rules this file keeps (CLAUDE.md "Security rules"):
// - The receipt code only ever travels in the Authorization header: never in a URL, a query string or a body.
// - Nothing here logs. No console.* of bodies, report text, emails or codes.
// - Bodies mirror the web flow's server actions (lib/intake/types.ts PreviewRequest/SubmitRequest), which T4's
//   zod schemas reuse. The server never trusts any of it: it re-runs redaction and re-checks everything.
//
// Local only for now: EXPO_PUBLIC_API_URL defaults to the Next app on this machine (npm run local, port 3000).
// Expo web (http://localhost:8081) is another origin: the API answers CORS for exactly that origin, only in
// AUTH_MODE=local on a request for this computer, never on Vercel (proxy.ts, lib/api/v1/cors.ts). A phone app
// needs no CORS.

/* ------------------------------------------------------------------ where the API is */

const DEFAULT_API_URL = "http://localhost:3000";

/** Base URL without a trailing slash. EXPO_PUBLIC_* values are inlined when the bundle is built. */
export const API_URL: string = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).trim().replace(/\/+$/, "");

export const API_PATHS = {
  org: (slug: string) => `/api/v1/orgs/${encodeURIComponent(slug)}`,
  preview: (slug: string) => `/api/v1/orgs/${encodeURIComponent(slug)}/preview`,
  reports: (slug: string) => `/api/v1/orgs/${encodeURIComponent(slug)}/reports`,
  status: "/api/v1/status",
  retest: "/api/v1/retest",
} as const;

/** `Authorization: Receipt XXXX-XXXX-XXXX-XXXX`, the server's scheme (lib/api/v1/http.ts RECEIPT_AUTH_SCHEME). */
export const RECEIPT_AUTH_SCHEME = "Receipt";

/** A real model can take up to 60 s per call (domain §6.1, claude-cli), so the preview waits longer. */
const PREVIEW_TIMEOUT_MS = 75_000;
const DEFAULT_TIMEOUT_MS = 20_000;

/* ------------------------------------------------------------------ shared values (same as the web) */

/** Step 2 answers (domain §4), mapped to `location_kind`. */
export type LocationKind = "digital" | "place" | "phone_or_service" | "document" | "other";
export const LOCATION_KINDS: readonly LocationKind[] = ["digital", "place", "phone_or_service", "document", "other"];

/** How the reporter answered "Is this right?" (stored in cases.summarySource). */
export type SummaryChoice = "ai_confirmed" | "ai_edited" | "reporter_words";

export type CaseStatus = "new" | "triaged" | "assigned" | "retest_open" | "verified" | "fixed_unverified" | "closed";
export const CASE_STATUSES: readonly CaseStatus[] = [
  "new",
  "triaged",
  "assigned",
  "retest_open",
  "verified",
  "fixed_unverified",
  "closed",
];

/** The five re-test answers, in domain §3 order. */
export type RetestAnswer = "fixed" | "partly" | "not_fixed" | "cant_check" | "opt_out";

/** Limits from lib/intake/types.ts and lib/retest.ts (the server enforces them again). */
export const LIMITS = {
  text: 6000,
  detail: 300,
  email: 254,
  editedSummary: 600,
  retestComment: 1000,
} as const;

/** Same rule as the web form: a plain, single address with a dot in the domain. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Slugs look like "maple-harbour" (lib/orgs.ts ORG_SLUG). */
export const ORG_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/* ------------------------------------------------------------------ request and response shapes */

/** GET /api/v1/orgs/{slug}[?loc={locationId}]. Public facts only. */
export interface OrgInfo {
  slug: string;
  name: string;
  /**
   * The QR poster's place (D8 org_locations), when `loc` matched one of this org's active locations. `name` is
   * the step 2 detail the web form fills in for that poster (the location's name, then its detail), so the app
   * shows and pre-fills the same words; the server never echoes the id, so it is the `loc` the app asked about.
   */
  location: { id: string; name: string; kind: LocationKind | null } | null;
  /** Other ways to give feedback (ACR s.9(3)); public by law. Empty strings when not set. */
  contact: { designateTitle: string; phone: string; email: string; mailingAddress: string } | null;
}

/** POST /api/v1/orgs/{slug}/preview: the same body as the web's previewReport action. */
export interface PreviewRequest {
  text: string;
  locationKind: LocationKind;
  locationDetail: string;
  aiOptOut: boolean;
}

/** The summary to show (null = no summary this time) and the sealed token to send back with the report. */
export interface PreviewResult {
  summary: string | null;
  token: string | null;
}

/**
 * "Send report" in the app's words: the same fields as the web's submitReport action (minus orgSlug).
 * serverReportBody turns it into the server's body for POST /api/v1/orgs/{slug}/reports.
 */
export interface SubmitRequest {
  text: string;
  locationKind: LocationKind;
  locationDetail: string;
  wantsRetest: boolean;
  emailChoice: "anonymous" | "email";
  email: string;
  aiOptOut: boolean;
  choice: SummaryChoice | null;
  editedSummary: string;
  token: string | null;
  /**
   * The QR poster's location id, when the report started from one. Not sent: the server takes the place from the
   * step 2 answers, as the web form does (the case copies the kind and detail; there is no case-to-location link).
   */
  locationId?: string;
}

/** Returned exactly once. The app keeps the code only in expo-secure-store (src/reports-store.ts). */
export interface SubmitResult {
  receiptCode: string;
  ref: string;
}

/** GET /api/v1/status: what lib/reporter-case.ts loadReporterCase gives the /r/[code] page, public-safe. */
export interface ReporterStatus {
  ref: string;
  orgName: string;
  orgSlug: string;
  status: CaseStatus;
  closedReason: string | null;
  /** ISO 8601. */
  receivedAt: string;
  wantsRetest: boolean;
  /** Shown only while a re-test is open (e.g. "We offer a $25 gift card ..."). */
  retestOfferText: string | null;
  /** The latest fix description, already layer-1 redacted. */
  fixDescription: string | null;
}

/**
 * POST /api/v1/retest. `source` tells the re-test question apart from "Stop contact about this report" inside the
 * app only; the server takes `{ answer, comment }` (opt_out works at any time) and is never sent `source`.
 */
export interface RetestRequest {
  answer: RetestAnswer;
  comment: string;
  source: "question" | "stop_contact";
}

export interface RetestResult {
  answer: RetestAnswer;
  /** The case's status after the answer, when the server sends it. */
  status: CaseStatus | null;
}

/**
 * Why a call didn't work, in the app's own words (src/copy.ts turns each one into a sentence):
 * not_found = unknown org, or a code that is unknown or no longer works (never says which; the server's 401
 * missing_code too); rate_limited = 429 rate_limited; invalid = 400/422; already_answered = 409 (the re-test
 * question is closed); offline = no connection or a timeout; unavailable = this server has no such endpoint (a
 * 404/405/501 that isn't JSON); failed = anything else, including 429 org_full (the org's form is full for today,
 * so waiting a few minutes would not help). `message` is the server's own plain sentence, if any.
 */
export type ApiProblem =
  | "not_found"
  | "rate_limited"
  | "invalid"
  | "already_answered"
  | "offline"
  | "unavailable"
  | "failed";
export type ApiResult<T> = { ok: true; data: T } | { ok: false; problem: ApiProblem; message?: string };

/* ------------------------------------------------------------------ the calls */

export function lookupOrg(slug: string, locationId?: string): Promise<ApiResult<OrgInfo>> {
  const query = locationId ? `?loc=${encodeURIComponent(locationId)}` : "";
  return call(`${API_PATHS.org(slug)}${query}`, { method: "GET" }, (body) => parseOrg(body, slug, locationId));
}

export function previewReport(slug: string, body: PreviewRequest): Promise<ApiResult<PreviewResult>> {
  return call(API_PATHS.preview(slug), { method: "POST", body, timeoutMs: PREVIEW_TIMEOUT_MS }, parsePreview);
}

export function submitReport(slug: string, body: SubmitRequest): Promise<ApiResult<SubmitResult>> {
  return call(API_PATHS.reports(slug), { method: "POST", body: serverReportBody(body) }, parseSubmit);
}

export function getStatus(code: string): Promise<ApiResult<ReporterStatus>> {
  return call(API_PATHS.status, { method: "GET", code }, parseStatus);
}

export function answerRetest(code: string, body: RetestRequest): Promise<ApiResult<RetestResult>> {
  return call(API_PATHS.retest, { method: "POST", code, body: serverRetestBody(body) }, (b) => parseRetest(b, body.answer));
}

/* ------------------------------------------------------------------ the server's request bodies */

/** Step 3's one question, as the server takes it (lib/intake/types.ts FOLLOW_UP_OPTIONS). */
type FollowUpValue = "none" | "code" | "email";

/** POST /api/v1/orgs/{slug}/reports. The server's body is strict: only these keys, or the whole request is refused. */
export function serverReportBody(b: SubmitRequest) {
  const followUp: FollowUpValue = b.emailChoice === "email" ? "email" : b.wantsRetest ? "code" : "none";
  return {
    text: b.text,
    locationKind: b.locationKind,
    locationDetail: b.locationDetail,
    followUp,
    email: followUp === "email" ? b.email : "",
    aiOptOut: b.aiOptOut,
    summaryChoice: b.choice,
    editedSummary: b.editedSummary,
    previewToken: b.token,
  };
}

/** POST /api/v1/retest: `{ answer, comment }` (strict on the server). */
export function serverRetestBody(b: RetestRequest) {
  return { answer: b.answer, comment: b.comment };
}

/* ------------------------------------------------------------------ transport */

interface CallOptions {
  method: "GET" | "POST";
  body?: unknown;
  /** The receipt code: sent ONLY as the Authorization header. */
  code?: string;
  timeoutMs?: number;
}

async function call<T>(path: string, opts: CallOptions, parse: (body: unknown) => T | null): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.code) headers.Authorization = `${RECEIPT_AUTH_SCHEME} ${opts.code}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
      // No cookies: the API is cookie-free, and the code never rides along in one.
      credentials: "omit",
    });
  } catch {
    clearTimeout(timer);
    return { ok: false, problem: "offline" };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  } finally {
    clearTimeout(timer);
  }
  if (body === null && [404, 405, 501].includes(res.status)) return { ok: false, problem: "unavailable" };
  const message = serverMessage(body);
  const code = errorCode(body);
  if (code === "org_full") return { ok: false, problem: "failed", message };
  if (res.status === 429 || flag(body, "rateLimited")) return { ok: false, problem: "rate_limited", message };
  if (res.status === 404 || code === "missing_code") return { ok: false, problem: "not_found", message };
  if (res.status === 409) return { ok: false, problem: "already_answered", message };
  if (res.status === 400 || res.status === 422) return { ok: false, problem: "invalid", message };
  if (!res.ok || (isRecord(body) && body.ok === false)) {
    const problem = isRecord(body) ? problemFrom(body.problem ?? body.error) : null;
    return { ok: false, problem: problem ?? "failed", message };
  }
  const data = parse(body);
  return data === null ? { ok: false, problem: "failed" } : { ok: true, data };
}

/* ------------------------------------------------------------------ parsing (tolerant, never throws) */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The payload, whether the server sends it flat or under `data` / `report` / `org`. */
function payload(body: unknown, ...keys: string[]): Record<string, unknown> | null {
  if (!isRecord(body)) return null;
  for (const k of keys) if (isRecord(body[k])) return body[k] as Record<string, unknown>;
  return body;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strOrEmpty = (v: unknown): string => (typeof v === "string" ? v : "");
const flag = (body: unknown, key: string) => isRecord(body) && body[key] === true;

/** The server's error code (`{ error: { code } }`, lib/api/v1/http.ts apiError), or null. */
function errorCode(body: unknown): string | null {
  return isRecord(body) && isRecord(body.error) ? str(body.error.code) : null;
}

function serverMessage(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  const m =
    (isRecord(body.error) ? str(body.error.message) : null) ??
    str(body.message) ??
    (typeof body.error === "string" && body.error.includes(" ") ? body.error : null);
  return m && m.length <= 300 ? m : undefined;
}

function problemFrom(v: unknown): ApiProblem | null {
  const known: ApiProblem[] = ["not_found", "rate_limited", "invalid", "already_answered", "offline", "unavailable", "failed"];
  return typeof v === "string" && (known as string[]).includes(v) ? (v as ApiProblem) : null;
}

function asStatus(v: unknown): CaseStatus | null {
  return typeof v === "string" && (CASE_STATUSES as readonly string[]).includes(v) ? (v as CaseStatus) : null;
}

function asKind(v: unknown): LocationKind | null {
  return typeof v === "string" && (LOCATION_KINDS as readonly string[]).includes(v) ? (v as LocationKind) : null;
}

/** `{ organization: { slug, name, contact }, place: { name, locationKind, locationDetail } | null, form }`. */
function parseOrg(body: unknown, slug: string, locationId?: string): OrgInfo | null {
  const p = payload(body, "organization", "org", "data");
  const name = p ? str(p.name) : null;
  if (!p || !name) return null;
  const place = isRecord(body) && isRecord(body.place) ? body.place : null;
  const placeWords = place ? str(place.locationDetail)?.trim() || str(place.name)?.trim() || null : null;
  const contact = isRecord(p.contact) ? p.contact : null;
  return {
    slug: str(p.slug) ?? slug,
    name,
    location:
      place && locationId && placeWords ? { id: locationId, name: placeWords, kind: asKind(place.locationKind) } : null,
    contact: contact
      ? {
          designateTitle: strOrEmpty(contact.designatedTitle ?? contact.designateTitle ?? contact.feedbackDesignateTitle),
          phone: strOrEmpty(contact.phone ?? contact.contactPhone),
          email: strOrEmpty(contact.email ?? contact.contactEmail),
          mailingAddress: strOrEmpty(contact.mailingAddress ?? contact.contactMailingAddress),
        }
      : null,
  };
}

/** `{ summary, previewToken }` (both null when the AI is paused: `aiPaused: true`, the web form's manual path). */
function parsePreview(body: unknown): PreviewResult | null {
  const p = payload(body, "data", "preview");
  if (!p) return null;
  const summary = str(p.summary);
  return { summary: summary && summary.trim() ? summary : null, token: str(p.previewToken) ?? str(p.token) };
}

/** 201 `{ receiptCode, receiptCodeSpelledOut, reference, receivedAt, status, statusLabel, organization, notice }`. */
function parseSubmit(body: unknown): SubmitResult | null {
  const p = payload(body, "data", "receipt");
  const receiptCode = p ? (str(p.receiptCode) ?? str(p.code)) : null;
  const ref = p ? (str(p.reference) ?? str(p.ref)) : null;
  return p && receiptCode && ref ? { receiptCode, ref } : null;
}

/**
 * `{ reference, receivedAt, status, statusLabel, closedReason, organization: { slug, name }, fixDescription,
 * wantsRetest, canStopContact, retest: { question, offerText, answers, commentMax } | null }` (also the
 * `report` of POST /retest's answer).
 */
function parseStatus(body: unknown): ReporterStatus | null {
  const p = payload(body, "report", "data");
  if (!p) return null;
  const status = asStatus(p.status);
  const ref = str(p.reference) ?? str(p.ref);
  if (!status || !ref) return null;
  const org = isRecord(p.organization) ? p.organization : null;
  const retest = isRecord(p.retest) ? p.retest : null;
  return {
    ref,
    orgName: strOrEmpty(org?.name ?? p.orgName),
    orgSlug: strOrEmpty(org?.slug ?? p.orgSlug),
    status,
    closedReason: str(p.closedReason),
    receivedAt: strOrEmpty(p.receivedAt),
    wantsRetest: p.wantsRetest === true,
    retestOfferText: str(retest?.offerText ?? p.retestOfferText)?.trim() || null,
    fixDescription: str(p.fixDescription)?.trim() || null,
  };
}

function parseRetest(body: unknown, answer: RetestAnswer): RetestResult {
  const p = payload(body, "data", "report");
  return { answer, status: p ? asStatus(p.status) : null };
}
