#!/usr/bin/env node
// Check an AccessLoop evidence bundle OFFLINE, without trusting AccessLoop (docs/domain.md §8 "Signed at sign-off").
// Dependency-free: Node.js 20 or later and its built-in node:crypto only. It never opens a network connection and
// imports no AccessLoop code, so a regulator or auditor can read all of it before running it.
//
//   node verify-bundle.mjs <evidence bundle .json> --keys <accessloop-signing-keys.json> [--expect-root <fingerprint>] [--json]
//
//   <evidence bundle>   "Download evidence bundle" on a published progress report
//   --keys <file>       AccessLoop's published signing keys (/.well-known/accessloop-signing-keys.json), saved
//                       beforehand; or --public-key <SPKI DER, base64> for one key
//   --expect-root <hex> the signed fingerprint the organization gave the regulator (ACR s.16 notice); spaces allowed
//   --json              print the result as JSON
//
// What it checks:
//   1. Report fingerprint: sha256(canonicalJson(snapshot)) is the report's saved fingerprint (manifestHash).
//   2. Signed root: recomputed from the file (the report id, the sign-off time, the sorted head of every case history
//      of the organization, the fingerprint, the lead's own text and the sentences), it is the signed root; with
//      --expect-root, it is also the fingerprint you were given.
//   3. Signature: Ed25519 over the 64 ASCII characters of the root, valid for the key the file names (its key ID
//      recomputed from the key itself).
//   4. Case histories: in each cited case's history the records join up (each one names the fingerprint of the one
//      before it, from 64 zeros), the history holds the record the report froze and the record that was signed (one
//      of the signed heads), and replaying its statuses, area and dates up to the report's record gives what the
//      report says. (The file has no record contents, so each record's own fingerprint can't be recomputed here:
//      the links, both heads, the root and the signature are what tie the histories to the signed report.)
//   5. Report numbers: every number in a sentence is a value of a fact the sentence cites (or a year of the
//      period), and the totals, areas, outcomes, median time to a confirmed fix and the fixed cases recount from the
//      report's case list, which check 4 tied to the histories. Counts that need record details the file leaves out
//      (intake channels, anonymity, acknowledgements, re-test answers, and which submissions were closed as not
//      accessibility feedback) are listed as not recounted offline: the online evidence check recounts them from the
//      full records. The report's case list holds every submission received in the period; the ones its
//      "not accessibility feedback" fact cites must be closed cases, and every other count leaves them out, as the
//      report does (docs/domain.md §10, decision D6).
//
// canonicalJson = JSON with object keys sorted and no whitespace (undefined dropped), as in AccessLoop's
// lib/case-events.ts. Exit code: 0 every check passed; 1 a check failed; 2 the checks could not run or finish
// (usage, an unreadable file, not an evidence bundle, or no key to check the signature with).
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const BUNDLE_FORMAT = "accessloop-evidence-bundle";
export const ROOT_KIND = "accessloop.report-root";
const GENESIS = "0".repeat(64);
const HEX64 = /^[0-9a-f]{64}$/;
const OPEN_STATUSES = new Set(["new", "triaged", "assigned", "retest_open"]);
const DEFAULT_TIME_ZONE = "America/Toronto";

/**
 * @typedef {{ keyId: string, key: import("node:crypto").KeyObject, keyIdMatches: boolean }} VerifyKey
 * @typedef {{ id: string, label: string, status: "pass" | "fail" | "skipped", summary: string, details: string[] }} CheckResult
 * @typedef {{ id: unknown, title: unknown, org: unknown, signedOffAt: unknown, keyId: unknown, root: unknown }} ReportInfo
 * @typedef {{ ok: boolean, complete: boolean, unreadable?: string, report: ReportInfo | null, checks: CheckResult[], notRecounted: string[] }} VerifyResult
 * @typedef {{ write(text: string): unknown }} Writer
 */

/**
 * Deterministic JSON: object keys sorted, no whitespace, undefined dropped.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/** @param {string} text */
export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
/** @param {unknown} hex */
const short = (hex) => (typeof hex === "string" ? `${hex.slice(0, 16)}…` : String(hex));
/** "a", "a and b", "a, b and c". @param {string[]} items */
const listWords = (items) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// ---------- keys ----------

function keyIdOf(publicKey) {
  const x = publicKey.export({ format: "jwk" }).x;
  return `ed25519-${createHash("sha256").update(Buffer.from(x, "base64url")).digest("hex").slice(0, 16)}`;
}

/**
 * Public keys from the published key list ({ keys: [...] }), one entry, or an array of entries. Each entry gives
 * `publicKey` (SPKI DER, base64) or `jwk`. Returns [{ keyId, key, keyIdMatches }]; entries that are not Ed25519
 * public keys are skipped.
 * @param {unknown} json
 * @returns {VerifyKey[]}
 */
export function readKeys(json) {
  const list = Array.isArray(json) ? json : isObject(json) && Array.isArray(json.keys) ? json.keys : [json];
  const out = [];
  for (const entry of list) {
    if (!isObject(entry)) continue;
    let key = null;
    try {
      if (typeof entry.publicKey === "string") key = createPublicKey({ key: Buffer.from(entry.publicKey, "base64"), format: "der", type: "spki" });
      else if (isObject(entry.jwk)) key = createPublicKey({ key: entry.jwk, format: "jwk" });
    } catch {
      key = null;
    }
    if (!key || key.asymmetricKeyType !== "ed25519") continue;
    const actual = keyIdOf(key);
    const keyId = typeof entry.keyId === "string" ? entry.keyId : actual;
    out.push({ keyId, key, keyIdMatches: keyId === actual });
  }
  return out;
}

// ---------- the report's own logic, rewritten from the documented formulas ----------

function sentencesOf(content) {
  const out = [];
  for (const section of Array.isArray(content?.sections) ? content.sections : []) {
    for (const b of Array.isArray(section?.blocks) ? section.blocks : []) {
      if (b?.kind === "claim" && b.sentence) out.push(b.sentence);
      else if (b?.kind === "claimList" && Array.isArray(b.sentences)) out.push(...b.sentences);
    }
  }
  return out;
}

/** The cases the sentences cite: every case of every fact a sentence names (in snapshot order). */
function citedCaseIds(content, snapshot) {
  const cited = new Set();
  const facts = Array.isArray(snapshot?.facts) ? snapshot.facts : [];
  for (const s of sentencesOf(content)) {
    for (const f of facts) if (Array.isArray(s.factIds) && s.factIds.includes(f.id)) for (const id of f.caseIds ?? []) cited.add(id);
  }
  return (snapshot?.cases ?? []).filter((c) => cited.has(c.id)).map((c) => c.id);
}

const NUMBER_G = /\d+(?:[.,]\d+)*/g;
const THOUSANDS = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const CASE_REF_G = /\bBAR-\d{4,6}\b/gi;

function numbersIn(text) {
  const out = [];
  for (const m of text.matchAll(NUMBER_G)) {
    const raw = m[0];
    if (THOUSANDS.test(raw)) out.push(Number(raw.replace(/,/g, "")));
    else for (const part of raw.split(",")) out.push(Number(part));
  }
  return out.filter((n) => Number.isFinite(n));
}

function stripValues(text, values) {
  let out = text;
  for (const v of [...values].sort((a, b) => b.length - a.length)) if (v) out = out.split(v).join(" ");
  return out;
}

function periodYears(period) {
  const from = Number(String(period?.start ?? "").slice(0, 4));
  const to = Number(String(period?.end ?? "").slice(0, 4));
  const years = [];
  for (let y = from; Number.isFinite(y) && y <= to && years.length < 100; y++) years.push(y);
  return years;
}

function zonedDate(iso, timeZone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function daysBetween(fromDate, toDate) {
  const day = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return day(toDate) - day(fromDate);
}

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const sameSet = (a, b) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/**
 * Replay a history's public fields up to and including the record with `head`: status, area, received, verified.
 * As lib/metrics/replay.ts: the latest area wins (a correction of the triage is another "triaged" record), and a
 * case reopened from "verified" is not verified any more from that record on (decision D4).
 */
function replayToHead(events, head) {
  const at = events.findIndex((e) => e.hash === head);
  if (at < 0) return null;
  const s = { status: "new", priorityArea: null, receivedAt: null, verifiedAt: null };
  for (const e of events.slice(0, at + 1)) {
    if (e.type === "submitted" && s.receivedAt === null) s.receivedAt = e.at;
    if (typeof e.priorityArea === "string") s.priorityArea = e.priorityArea;
    if (typeof e.to === "string") {
      s.status = e.to;
      if (e.to === "verified" && e.type === "retest_verdict") s.verifiedAt = e.at;
      if (e.type === "reopened" && e.from === "verified") s.verifiedAt = null;
    }
  }
  if (s.receivedAt === null) s.receivedAt = events[0]?.at ?? null;
  return s;
}

// ---------- the checks ----------

function check(id, label) {
  return { id, label, status: "pass", summary: "", details: [] };
}
function fail(c, detail) {
  c.status = "fail";
  if (detail) c.details.push(detail);
}

/**
 * Verify a parsed evidence bundle. `keys`: from readKeys (empty: the signature is not checked, the result is
 * incomplete). `expectRoot`: the fingerprint from the regulator's notice (optional).
 * Returns { ok, complete, report, checks: [{ id, label, status: "pass"|"fail"|"skipped", summary, details }], notRecounted }.
 * @param {any} bundle
 * @param {{ keys?: VerifyKey[], expectRoot?: string }} [opts]
 * @returns {VerifyResult}
 */
export function verifyBundle(bundle, opts = {}) {
  const keys = opts.keys ?? [];
  const expectRoot = typeof opts.expectRoot === "string" ? opts.expectRoot.replace(/\s+/g, "").toLowerCase() : null;
  if (!isObject(bundle) || bundle.format !== BUNDLE_FORMAT || bundle.version !== 1 || !isObject(bundle.report)) {
    return { ok: false, complete: false, unreadable: "This file is not an AccessLoop evidence bundle (version 1).", report: null, checks: [], notRecounted: [] };
  }
  const report = bundle.report;
  const sig = isObject(bundle.signature) ? bundle.signature : null;
  const snapshot = isObject(report.snapshot) ? report.snapshot : {};
  const cases = Array.isArray(snapshot.cases) ? snapshot.cases : [];
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
  const chains = Array.isArray(bundle.chains) ? bundle.chains : [];
  const timeZone = typeof report.timeZone === "string" ? report.timeZone : DEFAULT_TIME_ZONE;
  const checks = [];

  // 1. Report fingerprint.
  const c1 = check("fingerprint", "Report fingerprint");
  const manifestNow = sha256(canonicalJson(report.snapshot ?? null));
  if (manifestNow === report.manifestHash) c1.summary = `the report's frozen records hash to its saved fingerprint ${report.manifestHash}.`;
  else {
    c1.summary = "the report's frozen records no longer hash to its saved fingerprint.";
    fail(c1, `saved ${short(report.manifestHash)}, computed ${short(manifestNow)}`);
  }
  checks.push(c1);

  // 2. Signed root.
  const c2 = check("root", "Signed root");
  let rootNow = null;
  if (!sig) {
    c2.summary = "the file carries no signature (the report was signed off before signing existed, or it was removed).";
    fail(c2);
  } else {
    const leadNow = sha256(canonicalJson({ areaText: report.areaText ?? {}, consultationsText: report.consultationsText ?? null }));
    const contentNow = sha256(canonicalJson(report.content ?? null));
    const heads = Array.isArray(sig.heads) ? [...sig.heads].sort() : [];
    rootNow = sha256(
      canonicalJson({
        kind: ROOT_KIND,
        version: 1,
        reportId: report.id,
        signedAt: sig.signedAt,
        heads,
        manifestHash: report.manifestHash,
        leadTextHash: leadNow,
        contentHash: contentNow,
      }),
    );
    if (sig.rootKind !== ROOT_KIND || sig.rootVersion !== 1) fail(c2, `unknown root kind or version (${sig.rootKind}, ${sig.rootVersion})`);
    if (sig.manifestHash !== report.manifestHash) fail(c2, "the report's fingerprint is not the one that was signed");
    if (sig.leadTextHash !== leadNow) fail(c2, "the lead's own text (the area sections or Consultations) is not the text that was signed");
    if (sig.contentHash !== contentNow) fail(c2, "the report's sentences or sections are not the ones that were signed");
    if (sig.signedAt !== report.signedOffAt) fail(c2, "the sign-off time is not the one that was signed");
    if (!heads.every((h) => HEX64.test(h))) fail(c2, "a signed head is not a 64-character fingerprint");
    if (rootNow !== sig.root) fail(c2, `recomputed ${short(rootNow)}, signed ${short(sig.root)}`);
    if (expectRoot !== null && sig.root !== expectRoot) fail(c2, `the signed root ${short(sig.root)} is not the fingerprint you gave (${short(expectRoot)})`);
    c2.summary =
      c2.status === "pass"
        ? `recomputed from this file, it is the signed root ${sig.root}${expectRoot !== null ? ", the fingerprint you gave" : ""} (${plural(heads.length, "case history", "case histories")} sealed).`
        : "recomputed from this file, it is not the root that was signed.";
  }
  checks.push(c2);

  // 3. Signature.
  const c3 = check("signature", "Signature");
  if (!sig) {
    c3.status = "skipped";
    c3.summary = "nothing to check: the file carries no signature.";
  } else if (keys.length === 0) {
    c3.status = "skipped";
    c3.summary = "not checked: give AccessLoop's published signing keys with --keys <file> (or --public-key).";
  } else {
    const entry = keys.find((k) => k.keyId === sig.keyId);
    let valid = false;
    if (entry) {
      try {
        valid = sig.alg === "Ed25519" && verifySignature(null, Buffer.from(String(sig.root), "ascii"), entry.key, Buffer.from(String(sig.signature), "base64"));
      } catch {
        valid = false;
      }
    }
    if (!entry) {
      c3.summary = `the file names key ${sig.keyId}, which is not among the keys you gave.`;
      fail(c3);
    } else if (!entry.keyIdMatches) {
      c3.summary = `the key listed as ${sig.keyId} does not have that key ID.`;
      fail(c3);
    } else if (!valid) {
      c3.summary = `the Ed25519 signature is not valid for key ${sig.keyId}.`;
      fail(c3);
    } else c3.summary = `Ed25519, valid for key ${sig.keyId}.`;
  }
  checks.push(c3);

  // 4. Case histories.
  const c4 = check("histories", "Case histories");
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const signedHeads = new Set(Array.isArray(sig?.heads) ? sig.heads : []);
  const chainIds = new Set();
  let records = 0;
  for (const ch of chains) {
    const ref = typeof ch?.ref === "string" ? ch.ref : "a case";
    const events = Array.isArray(ch?.events) ? ch.events : [];
    records += events.length;
    chainIds.add(ch?.caseId);
    const sc = caseById.get(ch?.caseId);
    if (!sc) {
      fail(c4, `${ref}: not one of the report's cases`);
      continue;
    }
    let prev = GENESIS;
    let linked = true;
    events.forEach((e, i) => {
      if (!linked) return;
      if (e?.seq !== i + 1 || e?.prevHash !== prev || !HEX64.test(String(e?.hash))) {
        fail(c4, `${ref}: record ${i + 1} does not join the record before it`);
        linked = false;
      }
      prev = e?.hash;
    });
    const hashes = new Set(events.map((e) => e?.hash));
    if (ch.reportHead !== sc.headHash) fail(c4, `${ref}: the file's report record is not the one the report froze`);
    if (!hashes.has(sc.headHash)) fail(c4, `${ref}: the history no longer holds the record the report froze`);
    if (sig) {
      if (!ch.signedHead) fail(c4, `${ref}: the signature sealed no record of this case`);
      else {
        if (!signedHeads.has(ch.signedHead)) fail(c4, `${ref}: its signed record is not one of the signed heads`);
        if (!hashes.has(ch.signedHead)) fail(c4, `${ref}: the history no longer holds the record that was signed`);
      }
    }
    if (ch.publicSummary !== sc.publicSummary) fail(c4, `${ref}: the public summary differs from the report's`);
    const replay = replayToHead(events, sc.headHash);
    if (replay) {
      const differs = [];
      if (replay.status !== sc.status) differs.push("status");
      if (replay.priorityArea !== sc.priorityArea) differs.push("area");
      if (replay.receivedAt !== sc.receivedAt) differs.push("date received");
      if (sc.status === "verified" && replay.verifiedAt !== sc.verifiedAt) differs.push("date confirmed");
      if (differs.length) fail(c4, `${ref}: replaying its records gives a different ${differs.join(", ")} than the report says`);
    }
  }
  const cited = citedCaseIds(report.content, snapshot);
  const missing = cited.filter((id) => !chainIds.has(id));
  if (missing.length) fail(c4, `${plural(missing.length, "cited case has", "cited cases have")} no history in the file (${missing.map((id) => caseById.get(id)?.ref ?? id).join(", ")})`);
  c4.summary =
    c4.status === "pass"
      ? `${plural(chains.length, "history", "histories")}, ${plural(records, "record", "records")}: every link joins, each holds the report's record${sig ? " and the signed record" : ""}, and replaying them gives the report's statuses, areas and dates.`
      : `${plural(chains.length, "history", "histories")}, ${plural(records, "record", "records")}: problems found.`;
  checks.push(c4);

  // 5. Report numbers.
  const c5 = check("numbers", "Report numbers");
  const factById = new Map(facts.map((f) => [f.id, f]));
  const years = periodYears(snapshot.period);
  const sentences = sentencesOf(report.content);
  for (const s of sentences) {
    const label = typeof s?.id === "string" ? s.id : "a sentence";
    const cites = (Array.isArray(s?.factIds) ? s.factIds : []).map((id) => factById.get(id));
    if (cites.length === 0 || cites.some((f) => !f)) {
      fail(c5, `${label}: cites a fact that is not in the report`);
      continue;
    }
    const texts = cites.flatMap((f) => Object.values(f.values ?? {}).filter((v) => typeof v === "string")).flatMap((v) => [v, v.trim()]);
    const scan = stripValues(String(s.text ?? "").normalize("NFKC"), texts.map((t) => t.normalize("NFKC"))).replace(CASE_REF_G, " ");
    const allowed = new Set(years);
    for (const f of cites) for (const v of Object.values(f.values ?? {})) if (typeof v === "number") allowed.add(v);
    const invented = numbersIn(scan).filter((n) => !allowed.has(n));
    if (invented.length) fail(c5, `${label}: the number ${invented.join(", ")} is not a value of the facts it cites`);
  }

  // Submissions closed as not accessibility feedback (decision D6): in the case list only so their fact can cite
  // them; every other fact leaves them out. Which ones they are needs the closing reason, which the file leaves out.
  const notFeedbackFact = facts.find((f) => f?.id === "F_NOT_FEEDBACK");
  const notFeedbackIds = new Set(Array.isArray(notFeedbackFact?.caseIds) ? notFeedbackFact.caseIds : []);
  const feedback = cases.filter((c) => !notFeedbackIds.has(c.id));
  const ids = feedback.map((c) => c.id);
  const count = (pred) => feedback.filter(pred).length;
  const idsWhere = (pred) => feedback.filter(pred).map((c) => c.id);
  const recounted = new Set();
  const notRecounted = [];
  const NOT_OFFLINE = {
    F_ANON: "anonymous feedback",
    F_ACK: "acknowledgements",
    F_RETEST: "re-test answers",
    F_NOT_FEEDBACK: "which submissions were closed as not accessibility feedback",
  };
  for (const c of cases) {
    const on = zonedDate(c.receivedAt, timeZone);
    if (!on || on < String(snapshot.period?.start) || on > String(snapshot.period?.end)) fail(c5, `${c.ref}: not received in the report's period`);
  }
  for (const f of facts) {
    const v = f.values ?? {};
    const kind = String(f.id ?? "").split(":")[0];
    const fIds = Array.isArray(f.caseIds) ? f.caseIds : [];
    if (fIds.some((id) => !caseById.has(id))) fail(c5, `${f.id}: counts a case that is not in the report`);
    const wrong = (what) => fail(c5, `${f.id}: ${what} does not recount from the report's cases`);
    switch (kind) {
      case "F_TOTAL": {
        if (v.total !== feedback.length || !sameSet(fIds, ids)) wrong("the total");
        const channels = Object.entries(v).filter(([k, n]) => k !== "total" && typeof n === "number");
        if (channels.reduce((n, [, x]) => n + x, 0) !== v.total) wrong("the channels' sum");
        recounted.add("total received");
        notRecounted.push("intake channels");
        break;
      }
      case "F_AREA": {
        const area = String(f.id).slice(7);
        const want = idsWhere((c) => c.priorityArea === area);
        if (v.count !== want.length || v.count !== fIds.length || !sameSet(fIds, want)) wrong("the count");
        recounted.add("areas");
        break;
      }
      case "F_OUTCOME": {
        const verified = count((c) => c.status === "verified");
        if (Number(v.verified) + Number(v.verifiedViaStaffCode ?? 0) !== verified) wrong("the confirmed fixes");
        if (v.unverified !== count((c) => c.status === "fixed_unverified")) wrong("the fixes not confirmed");
        if (v.open !== count((c) => OPEN_STATUSES.has(c.status))) wrong("the cases in progress");
        if (v.closed !== count((c) => c.status === "closed")) wrong("the closed cases");
        if (!sameSet(fIds, ids)) wrong("the case list");
        recounted.add("outcomes");
        break;
      }
      case "F_VERIFY_TIME": {
        const done = feedback.filter((c) => c.status === "verified" && c.verifiedAt);
        const days = median(done.map((c) => daysBetween(zonedDate(c.receivedAt, timeZone), zonedDate(c.verifiedAt, timeZone))));
        if (v.verified !== done.length || !sameSet(fIds, done.map((c) => c.id))) wrong("the confirmed fixes");
        if (v.medianDays !== days) wrong("the median days");
        recounted.add("median time to a confirmed fix");
        break;
      }
      case "F_CASE": {
        const ref = String(f.id).slice(7);
        const c = feedback.find((x) => x.ref === ref);
        if (!c || fIds.length !== 1 || fIds[0] !== c.id) wrong("the case");
        else {
          if (v.outcome !== c.status) wrong("the outcome");
          if (v.publicSummary !== undefined && v.publicSummary !== c.publicSummary) wrong("the public summary");
        }
        recounted.add("fixed cases");
        break;
      }
      case "F_ANON":
        if (v.total !== feedback.length || v.anonymous !== fIds.length) wrong("the total");
        notRecounted.push(NOT_OFFLINE[kind]);
        break;
      case "F_ACK":
        if (v.nonAnonymous !== fIds.length || !(Number(v.acked) <= Number(v.nonAnonymous))) wrong("the counts");
        notRecounted.push(NOT_OFFLINE[kind]);
        break;
      case "F_NOT_FEEDBACK":
        // Only ever written when at least one submission was closed this way; each one is a closed case.
        if (v.notFeedback !== fIds.length || fIds.length === 0 || fIds.some((id) => caseById.get(id)?.status !== "closed")) wrong("the count");
        notRecounted.push(NOT_OFFLINE[kind]);
        break;
      case "F_RETEST":
        if (!(Number(v.answered) <= Number(v.requested)) || !(Number(v.partlyOrNotFixed) <= Number(v.answered))) wrong("the counts");
        notRecounted.push(NOT_OFFLINE[kind]);
        break;
      default:
        notRecounted.push(`${f.id} (a kind this tool does not know)`);
    }
  }
  const fixedFacts = new Set(facts.filter((f) => String(f.id).startsWith("F_CASE:")).map((f) => String(f.id).slice(7)));
  const fixed = feedback.filter((c) => c.status === "verified" || c.status === "fixed_unverified").map((c) => c.ref);
  if (!sameSet(fixedFacts, fixed)) fail(c5, "the list of fixed cases does not recount from the report's cases");
  c5.summary =
    c5.status === "pass"
      ? `every number in the ${plural(sentences.length, "sentence", "sentences")} is a value of a fact it cites, and ${listWords([...recounted])} recount from the report's cases.`
      : "some numbers do not come from the records.";
  checks.push(c5);

  const failed = checks.some((c) => c.status === "fail");
  const complete = checks.every((c) => c.status !== "skipped");
  return {
    ok: !failed && complete,
    complete,
    report: {
      id: report.id,
      title: report.title,
      org: isObject(bundle.org) ? bundle.org.name : null,
      signedOffAt: report.signedOffAt ?? null,
      keyId: sig?.keyId ?? null,
      root: sig?.root ?? null,
    },
    checks,
    notRecounted: [...new Set(notRecounted)],
  };
}

/**
 * The result in plain words, one line per check.
 * @param {VerifyResult} r
 * @returns {string}
 */
export function formatResult(r) {
  if (r.unreadable) return `${r.unreadable}\n`;
  const lines = ["AccessLoop evidence check (offline)"];
  if (r.report?.title) lines.push(`Report: ${r.report.title}${r.report.org ? ` (${r.report.org})` : ""}`);
  if (r.report?.signedOffAt) lines.push(`Signed off: ${r.report.signedOffAt}${r.report.keyId ? `, key ${r.report.keyId}` : ""}`);
  lines.push("");
  const mark = { pass: "PASS", fail: "FAIL", skipped: "SKIP" };
  for (const c of r.checks) {
    lines.push(`${mark[c.status]}  ${c.label}: ${c.summary}`);
    for (const d of c.details.slice(0, 20)) lines.push(`      - ${d}`);
    if (c.details.length > 20) lines.push(`      - and ${c.details.length - 20} more`);
  }
  if (r.notRecounted.length) {
    lines.push("");
    lines.push(`Not recounted offline (the file leaves out the record details they need; the online evidence check recounts them): ${listWords(r.notRecounted)}.`);
  }
  lines.push("");
  const failed = r.checks.filter((c) => c.status === "fail").length;
  lines.push(r.ok ? "All checks passed." : failed ? `${plural(failed, "check", "checks")} failed.` : "Not every check could run.");
  return `${lines.join("\n")}\n`;
}

const USAGE =
  "Usage: node verify-bundle.mjs <evidence bundle .json> --keys <accessloop-signing-keys.json> [--expect-root <fingerprint>] [--json]\n" +
  "       (or --public-key <SPKI DER, base64> instead of --keys)\n";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, ""));
}

/**
 * The command line. Returns the exit code (0 passed, 1 a check failed, 2 could not run or finish).
 * @param {string[]} argv
 * @param {Writer} [out]
 * @param {Writer} [err]
 * @returns {number}
 */
export function main(argv, out = process.stdout, err = process.stderr) {
  let bundlePath = null;
  let json = false;
  let expectRoot;
  const keys = [];
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--help" || a === "-h") {
        out.write(USAGE);
        return 0;
      } else if (a === "--json") json = true;
      else if (a === "--keys") keys.push(...readKeys(readJson(argv[++i] ?? "")));
      else if (a === "--public-key") keys.push(...readKeys({ publicKey: argv[++i] ?? "" }));
      else if (a === "--expect-root") expectRoot = argv[++i] ?? "";
      else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
      else if (bundlePath === null) bundlePath = a;
      else throw new Error(`Unexpected argument ${a}`);
    }
    if (!bundlePath) throw new Error("No evidence bundle given");
  } catch (e) {
    err.write(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  let bundle;
  try {
    bundle = readJson(bundlePath);
  } catch {
    err.write(`Could not read ${bundlePath} as JSON.\n`);
    return 2;
  }
  const result = verifyBundle(bundle, { keys, expectRoot });
  out.write(json ? `${JSON.stringify(result, null, 2)}\n` : formatResult(result));
  if (result.unreadable) return 2;
  if (result.checks.some((c) => c.status === "fail")) return 1;
  return result.complete ? 0 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
