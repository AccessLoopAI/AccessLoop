// Pure helpers behind the staff case page: the History wording (lib/cases/history.ts), who may do what
// (lib/cases/access.ts), the AI pre-selection, the evidence link check and the close reasons
// (lib/cases/triage.ts), the acknowledgement line (lib/cases/summary.ts) and the verified moment's "once".
import { describe, expect, it } from "vitest";
import { canOpenCase, canRun, type CaseAccessFacts, type CaseCommand, type CaseViewer } from "@/lib/cases/access";
import { ackRecordedAfterDays, describeEvent, duplicateOfPayload, spanTypeWords, type HistoryEventInput } from "@/lib/cases/history";
import { NOTE_KIND_LABELS, scrubNote, staffNotes } from "@/lib/cases/notes";
import { NO_CONTACT_ON_FILE, retestAskOf, retestAskSentence, type EventLike } from "@/lib/cases/messages";
import { closeReasonsFor, reopenTarget } from "@/lib/state-machine";
import { playVerifiedMoment, seenKey } from "@/lib/cases/seen-verified";
import { acknowledgementLine, caseSummaryCell } from "@/lib/cases/summary";
import {
  AREA_OPTIONS,
  CLOSE_REASON_OPTIONS,
  EVIDENCE_URL_ERRORS,
  HIGH_CONFIDENCE,
  UNCERTAIN_LABELS,
  UNCERTAIN_OTHER,
  aiSuggestion,
  checkEvidenceUrl,
  confidenceWord,
  topAiArea,
} from "@/lib/cases/triage";
import { ABSTAIN_THRESHOLD } from "@/eval/score";
import { CASE_STATUSES, type CaseStatus } from "@/lib/status";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_OWNER_ID = "33333333-3333-4333-8333-333333333333";
const NAMES: Record<string, string> = { [LEAD_ID]: "Alex Rivera", [OWNER_ID]: "Facilities team" };
const memberName = (id: string | null | undefined) => (id ? (NAMES[id] ?? null) : null);
const lead = { isLead: true, memberName };
const auditor = { isLead: false, memberName };

const ev = (type: string, payload: Record<string, unknown> = {}, actorKind: HistoryEventInput["actorKind"] = "system", actorId: string | null = null): HistoryEventInput =>
  ({ seq: 1, type, actorKind, actorId, payload });

describe("History wording", () => {
  it("words the opening events of a web report", () => {
    expect(describeEvent(ev("submitted", { channel: "web" }, "reporter"), lead).title).toBe("Report received on the web form");
    expect(describeEvent(ev("ack_recorded", { channel: "web_screen", anonymous: true }), lead).title).toBe("Acknowledgement shown on screen");
    expect(describeEvent(ev("ai_structured", { backend: "fake", confirmedValue: { summarySource: "ai_confirmed" } }), lead))
      .toMatchObject({ title: "Summary made by the simulated AI", body: "The reporter confirmed it." });
    expect(describeEvent(ev("redaction_proposed", { spans: [{ type: "PERSON" }, { type: "PHONE" }], needsManualRedaction: false }), lead).title)
      .toBe("2 details hidden automatically (person, phone)");
  });

  it("never says 'Acknowledged on screen' (the case page shows that line exactly once)", () => {
    const all = ["submitted", "ack_recorded", "ai_structured", "redaction_proposed", "redaction_approved", "private_revealed",
      "triaged", "assigned", "fix_logged", "retest_requested", "retest_verdict", "opted_out", "note_added", "reopened",
      "closed", "retest_expired", "message_sent"];
    for (const type of all) {
      const line = describeEvent(ev(type, { channel: "web_screen" }), lead);
      expect(`${line.title} ${line.body ?? ""}`.toLowerCase()).not.toContain("acknowledged on screen");
      expect(`${line.title} ${line.body ?? ""}`.toLowerCase()).not.toContain("checked by reporter");
    }
  });

  it("names staff and staff-logged channels", () => {
    expect(describeEvent(ev("submitted", { channel: "phone", codeRelayedByStaff: true }, "staff", LEAD_ID), lead))
      .toMatchObject({ title: "Feedback received by phone", actor: "Logged by Alex Rivera", body: "Staff gave the receipt code to the person." });
    expect(describeEvent(ev("ack_recorded", { channel: "phone", manual: true }, "staff", LEAD_ID), lead).title)
      .toBe("Acknowledgement recorded (by phone)");
    expect(describeEvent(ev("redaction_approved", { spans: [{ type: "PERSON" }], kept: 1, removed: 1, added: 0 }, "staff", LEAD_ID), lead))
      .toMatchObject({ title: "Redaction approved by Alex Rivera", body: "1 detail hidden (person). Kept 1 found automatically, removed 1, added 0 by hand.", tone: "success" });
    expect(describeEvent(ev("private_revealed", { shown: ["text"] }, "staff", LEAD_ID), lead))
      .toMatchObject({ title: "Original viewed by Alex Rivera", tone: "warning" });
    expect(describeEvent(ev("private_revealed", {}, "staff", "unknown-id"), lead).title).toBe("Original viewed by A staff member");
  });

  it("words the loop steps with status changes", () => {
    const triaged = describeEvent(ev("triaged", { priorityArea: "built_environment", publicSummary: "A door was broken.", from: "new", to: "triaged" }, "staff", LEAD_ID), auditor);
    expect(triaged).toMatchObject({ title: "Triaged: The built environment", bodyLabel: "Public summary", body: "A door was broken.",
      statusChange: { from: "New", to: "Triaged" } });
    expect(describeEvent(ev("assigned", { memberId: OWNER_ID, from: "triaged", to: "assigned" }, "staff", LEAD_ID), auditor).title).toBe("Assigned to Facilities team");
    const fix = describeEvent(ev("fix_logged", { description: "Replaced the motor.", evidenceUrl: "https://example.com/p.jpg", from: "assigned", to: "retest_open" }, "staff", OWNER_ID), auditor);
    expect(fix).toMatchObject({ title: "Fix logged by Facilities team", body: "Replaced the motor.", link: "https://example.com/p.jpg",
      statusChange: { from: "Assigned", to: "Waiting for the reporter to check" } });
    expect(describeEvent(ev("fix_logged", { description: "x", evidenceUrl: "javascript:alert(1)" }, "staff", OWNER_ID), auditor).link).toBeUndefined();
    expect(describeEvent(ev("retest_requested", { round: 1 }), auditor).title).toBe("Re-test requested (round 1)");
    expect(describeEvent(ev("opted_out", {}, "reporter"), auditor).title).toBe("Reporter asked not to be contacted");
    expect(describeEvent(ev("reopened", { reason: "It broke again.", from: "fixed_unverified", to: "assigned" }, "staff", LEAD_ID), auditor))
      .toMatchObject({ title: "Reopened by Alex Rivera", body: "It broke again." });
    expect(describeEvent(ev("closed", { reason: "duplicate", from: "new", to: "closed" }, "staff", LEAD_ID), auditor).title).toBe("Closed: duplicate of another case");
    expect(describeEvent(ev("retest_expired", { afterDays: 60 }), auditor).title).toBe("Re-test closed with no answer after 60 days");
  });

  it("words the Phase 7 steps: a corrected triage (D2), stopping the wait (D3), reopening a verified or closed case (D4)", () => {
    const retriage = (changed: string[]) =>
      describeEvent(ev("triaged", { priorityArea: "ict", publicSummary: "The booking page timed out.", retriage: true, changed,
        reason: "Wrong area.", from: "assigned", to: "assigned" }, "staff", LEAD_ID), auditor);
    expect(retriage(["priorityArea"])).toMatchObject({ title: "Area corrected: Information and communication technologies", actor: "Alex Rivera",
      bodyLabel: "Public summary", body: "The booking page timed out.", note: { label: "Why", text: "Wrong area." } });
    expect(retriage(["priorityArea"]).statusChange).toBeUndefined();
    expect(retriage(["publicSummary"]).title).toBe("Public summary corrected");
    expect(retriage(["priorityArea", "publicSummary"]).title).toBe("Area and public summary corrected: Information and communication technologies");

    const stopped = describeEvent(ev("retest_expired", { reason: "reporter_unreachable", afterDays: 18, round: 1,
      from: "retest_open", to: "fixed_unverified" }, "staff", LEAD_ID), auditor);
    expect(stopped).toMatchObject({ title: "Stopped waiting for the reporter after 18 days: reporter unreachable", actor: "Alex Rivera",
      body: "The fix counts as not verified by the reporter.", statusChange: { from: "Waiting for the reporter to check", to: "Fixed, not verified by reporter" } });

    expect(describeEvent(ev("reopened", { reason: "It broke again.", from: "verified", to: "assigned" }, "staff", LEAD_ID), auditor))
      .toMatchObject({ title: "Reopened by Alex Rivera", statusChange: { from: "Verified by reporter", to: "Assigned" } });
    expect(describeEvent(ev("reopened", { reason: "Closed by mistake.", from: "closed", to: "triaged" }, "staff", LEAD_ID), auditor).statusChange)
      .toEqual({ from: "Closed", to: "Triaged" });
  });

  it("shows a reporter's own words (comments, notes) to the lead only", () => {
    const verdict = ev("retest_verdict", { verdict: "partly", round: 1, via: "receipt_code", comment: "The button sticks." }, "reporter");
    expect(describeEvent(verdict, lead)).toMatchObject({ title: "The reporter answered: Partly (round 1)", bodyLabel: "Their comment", body: "The button sticks.", tone: "warning" });
    const forAuditor = describeEvent(verdict, auditor);
    expect(forAuditor.body).not.toContain("sticks");
    expect(forAuditor.body).toContain("Only the lead can read it");
    const fixed = describeEvent(ev("retest_verdict", { verdict: "fixed", round: 2 }, "reporter"), auditor);
    expect(fixed).toMatchObject({ title: "The reporter answered: Yes, it works now (round 2)", tone: "success" });
    expect(fixed.body).toBeUndefined();

    const note = ev("note_added", { via: "receipt_code", note: "Please call me at [PHONE]." }, "reporter");
    expect(describeEvent(note, lead)).toMatchObject({ title: "The reporter added a note", body: "Please call me at [PHONE]." });
    expect(describeEvent(note, auditor).body).not.toContain("call me");
  });

  it("T2 item 4: words staff notes by kind; an interim accommodation has its own label; a note from before Phase 7 stays a note", () => {
    const internal = describeEvent(ev("note_added", { kind: "internal", note: "Called facilities, a part is on order." }, "staff", OWNER_ID), auditor);
    expect(internal).toMatchObject({ title: "Internal note added by Facilities team", bodyLabel: "Note", body: "Called facilities, a part is on order.", tone: "default" });
    const interim = describeEvent(ev("note_added", { kind: "interim_accommodation", note: "Staff open the side door on request." }, "staff", LEAD_ID), auditor);
    expect(interim).toMatchObject({ title: "Interim accommodation added by Alex Rivera", bodyLabel: "Offered meanwhile", body: "Staff open the side door on request.", tone: "info" });
    expect(describeEvent(ev("note_added", { note: "Checked." }, "staff", LEAD_ID), auditor))
      .toMatchObject({ title: "Note added by Alex Rivera", bodyLabel: "Note", body: "Checked." });
  });

  it("T2 item 8: a duplicate's close names and links its original for the lead and the auditor, never for an owner", () => {
    const closed = ev("closed", { reason: "duplicate", duplicateOf: { caseId: OTHER_OWNER_ID, ref: "BAR-0003" }, from: "triaged", to: "closed" }, "staff", LEAD_ID);
    for (const viewer of [{ ...lead, seesOtherCases: true }, { ...auditor, seesOtherCases: true }]) {
      expect(describeEvent(closed, viewer)).toMatchObject({ title: "Closed: duplicate of BAR-0003", caseLink: { label: "Original case", ref: "BAR-0003" } });
    }
    const ownerLine = describeEvent(closed, { isLead: false, memberName, seesOtherCases: false });
    expect(ownerLine.title).toBe("Closed: duplicate of another case");
    expect(JSON.stringify(ownerLine)).not.toContain("BAR-0003");
    // A duplicate closed before Phase 7 named no original; a bad payload is ignored.
    expect(describeEvent(ev("closed", { reason: "duplicate" }, "staff", LEAD_ID), { ...lead, seesOtherCases: true }).caseLink).toBeUndefined();
    expect(duplicateOfPayload({ duplicateOf: { caseId: "x", ref: "<script>" } })).toBeNull();
    expect(duplicateOfPayload({ duplicateOf: { caseId: "x", ref: "BAR-0003" } })).toEqual({ caseId: "x", ref: "BAR-0003" });
    expect(duplicateOfPayload({})).toBeNull();
  });

  it("T2 item 9: a recorded acknowledgement says how long after the day it gives it was written", () => {
    const recorded = (on: string, at: string) =>
      describeEvent({ ...ev("ack_recorded", { channel: "phone", manual: true, on }, "staff", LEAD_ID), createdAt: new Date(at) }, lead).body;
    expect(recorded("2026-10-03", "2026-10-03T18:00:00Z")).toBe("Given to the person on October 3, 2026.");
    expect(recorded("2026-10-03", "2026-10-04T18:00:00Z")).toBe("Given to the person on October 3, 2026. Recorded 1 day later.");
    expect(recorded("2026-10-03", "2026-10-20T15:00:00Z")).toBe("Given to the person on October 3, 2026. Recorded 17 days later.");
    // Days are calendar days in the display time zone (Toronto): 01:00 UTC on Oct 4 is still Oct 3 there.
    expect(ackRecordedAfterDays("2026-10-03", new Date("2026-10-04T01:00:00Z"))).toBe(0);
    expect(ackRecordedAfterDays("2026-10-03", new Date("2026-10-11T16:00:00Z"))).toBe(8);
  });

  it("never shows a summary from the ai_structured payload", () => {
    const line = describeEvent(ev("ai_structured", { backend: "api", aiValue: { summary: "Daniel can't get in." },
      confirmedValue: { summary: "Daniel can't get in.", summarySource: "ai_edited" } }), lead);
    expect(JSON.stringify(line)).not.toContain("Daniel");
    expect(line.title).toBe("Summary made by AI");
  });

  it("lists span types once each, in order", () => {
    expect(spanTypeWords([{ type: "PHONE" }, { type: "PERSON" }, { type: "PHONE" }, { type: "BOGUS" }])).toEqual({ count: 4, words: "phone, person" });
    expect(spanTypeWords(undefined)).toEqual({ count: 0, words: "" });
    expect(describeEvent(ev("redaction_proposed", { spans: [] }), lead).title).toBe("No personal details found automatically");
  });
});

describe("who may open a case and run each step", () => {
  const leadV: CaseViewer = { role: "lead", memberId: LEAD_ID };
  const owner: CaseViewer = { role: "owner", memberId: OWNER_ID };
  const auditorV: CaseViewer = { role: "auditor", memberId: "44444444-4444-4444-8444-444444444444" };
  const facts = (status: CaseStatus, over: Partial<CaseAccessFacts> = {}): CaseAccessFacts =>
    ({ status, assignedTo: OWNER_ID, redactionApproved: status !== "new", ...over });

  it("an owner opens only a case assigned to them", () => {
    expect(canOpenCase(owner, { assignedTo: OWNER_ID })).toBe(true);
    expect(canOpenCase(owner, { assignedTo: OTHER_OWNER_ID })).toBe(false);
    expect(canOpenCase(owner, { assignedTo: null })).toBe(false);
    expect(canOpenCase(leadV, { assignedTo: null })).toBe(true);
    expect(canOpenCase(auditorV, { assignedTo: null })).toBe(true);
  });

  it("an auditor runs nothing, in any status", () => {
    const cmds: CaseCommand[] = ["review", "reveal", "triage", "retriage", "assign", "log_fix", "close", "reopen", "stop_waiting"];
    for (const status of CASE_STATUSES) {
      for (const cmd of cmds) {
        expect(canRun(cmd, auditorV, facts(status, { redactionApproved: false })), `${cmd} ${status}`).toBe(false);
        expect(canRun(cmd, auditorV, facts(status)), `${cmd} ${status}`).toBe(false);
      }
    }
  });

  it("an owner only logs a fix on their own assigned case, and never reveals the original", () => {
    for (const status of CASE_STATUSES) {
      expect(canRun("log_fix", owner, facts(status))).toBe(status === "assigned");
      for (const cmd of ["review", "reveal", "triage", "retriage", "assign", "close", "reopen", "stop_waiting"] as const) {
        expect(canRun(cmd, owner, facts(status))).toBe(false);
      }
    }
    expect(canRun("log_fix", owner, facts("assigned", { assignedTo: OTHER_OWNER_ID }))).toBe(false);
  });

  it("a lead's steps follow the state machine", () => {
    expect(canRun("review", leadV, facts("new", { redactionApproved: false }))).toBe(true);
    expect(canRun("review", leadV, facts("new", { redactionApproved: true }))).toBe(false);
    expect(canRun("review", leadV, facts("closed", { redactionApproved: false }))).toBe(true);
    expect(canRun("triage", leadV, facts("new", { redactionApproved: false }))).toBe(false);
    expect(canRun("triage", leadV, facts("new", { redactionApproved: true }))).toBe(true);
    expect(canRun("triage", leadV, facts("triaged"))).toBe(false);
    for (const status of CASE_STATUSES) {
      expect(canRun("reveal", leadV, facts(status))).toBe(true);
      expect(canRun("assign", leadV, facts(status))).toBe(status === "triaged" || status === "assigned");
      expect(canRun("log_fix", leadV, facts(status, { assignedTo: OTHER_OWNER_ID }))).toBe(status === "assigned");
      expect(canRun("close", leadV, facts(status))).toBe(["new", "triaged", "assigned", "fixed_unverified"].includes(status));
      expect(canRun("reopen", leadV, facts(status))).toBe(["fixed_unverified", "verified", "closed"].includes(status)); // D4
      expect(canRun("retriage", leadV, facts(status))).toBe(status === "triaged" || status === "assigned"); // D2
      expect(canRun("stop_waiting", leadV, facts(status))).toBe(status === "retest_open"); // D3 (the 14 days: the page and plan())
    }
  });

  it("T2 item 4: the lead and the owner it is assigned to add notes in any status; an auditor and another owner never", () => {
    for (const status of CASE_STATUSES) {
      expect(canRun("note", leadV, facts(status, { redactionApproved: false })), status).toBe(true);
      expect(canRun("note", leadV, facts(status, { assignedTo: null })), status).toBe(true);
      expect(canRun("note", owner, facts(status)), status).toBe(true);
      expect(canRun("note", owner, facts(status, { assignedTo: OTHER_OWNER_ID })), status).toBe(false);
      expect(canRun("note", owner, facts(status, { assignedTo: null })), status).toBe(false);
      expect(canRun("note", auditorV, facts(status)), status).toBe(false);
    }
  });

  it("the page's rules agree with the frozen state machine (it is client-safe, so it can't import it)", () => {
    for (const status of CASE_STATUSES) {
      expect(canRun("close", leadV, facts(status)), status).toBe(closeReasonsFor(status).length > 0);
      expect(canRun("reopen", leadV, facts(status)), status).toBe(reopenTarget({ status, priorityArea: null, publicSummary: null }) !== null);
    }
  });
});

describe("triage helpers", () => {
  it("the AI's most confident valid area", () => {
    expect(topAiArea([{ area: "ict", confidence: 0.4 }, { area: "built_environment", confidence: 0.93 }])).toBe("built_environment");
    expect(topAiArea([{ area: "ict", confidence: 0.5 }, { area: "employment", confidence: 0.5 }])).toBe("ict");
    expect(topAiArea([{ area: "moon_base", confidence: 0.99 }, { area: "procurement", confidence: 0.2 }])).toBe("procurement");
    expect(topAiArea([{ area: "ict", confidence: "high" }])).toBeNull();
    expect(topAiArea([])).toBeNull();
    expect(topAiArea(null)).toBeNull();
  });

  it("confidence in plain words: high from 0.8, medium from the eval's abstain threshold (0.5), low below", () => {
    expect(ABSTAIN_THRESHOLD).toBe(0.5);
    expect(HIGH_CONFIDENCE).toBe(0.8);
    expect([0.99, 0.8, 0.79, 0.5, 0.49, 0.3, 0].map(confidenceWord)).toEqual(["high", "high", "medium", "medium", "low", "low", "low"]);
  });

  it("aiSuggestion: pre-selected only at confidence >= 0.5, with the area's heading name and its confidence word", () => {
    expect(aiSuggestion([{ area: "built_environment", confidence: 0.93 }], [])).toEqual({
      area: "built_environment",
      label: "The built environment",
      confidence: 0.93,
      word: "high",
      preselect: true,
      uncertain: [],
    });
    expect(aiSuggestion([{ area: "ict", confidence: 0.5 }], [])).toMatchObject({ word: "medium", preselect: true });
    // The fake's fallback (and a vague report from a real model): shown, never pre-selected.
    expect(aiSuggestion([{ area: "programs_services", confidence: 0.3 }], ["priorityArea"])).toEqual({
      area: "programs_services",
      label: "The design and delivery of programs and services",
      confidence: 0.3,
      word: "low",
      preselect: false,
      uncertain: [UNCERTAIN_LABELS.priorityArea],
    });
    expect(aiSuggestion([{ area: "ict", confidence: 0.49 }, { area: "employment", confidence: 0.2 }], null)?.preselect).toBe(false);
  });

  it("aiSuggestion: only the prompt's own words are shown from the uncertain list, each once", () => {
    const s = aiSuggestion([{ area: "ict", confidence: 0.7 }], ["location", "summary", "location", "Daniel Okafor at 12 King St", 42, " "]);
    expect(s?.uncertain).toEqual([UNCERTAIN_LABELS.location, UNCERTAIN_LABELS.summary, UNCERTAIN_OTHER]);
    expect(JSON.stringify(s)).not.toContain("Daniel");
    expect(aiSuggestion([{ area: "ict", confidence: 0.7 }], "location")?.uncertain).toEqual([]);
    expect(aiSuggestion([{ area: "ict", confidence: 0.7 }], ["__proto__", "constructor"])?.uncertain).toEqual([UNCERTAIN_OTHER]);
  });

  it("aiSuggestion: no valid area (no AI result, AI opt-out, unknown keys) means no suggestion", () => {
    expect(aiSuggestion(null, ["priorityArea"])).toBeNull();
    expect(aiSuggestion([], [])).toBeNull();
    expect(aiSuggestion([{ area: "moon_base", confidence: 0.99 }], [])).toBeNull();
    // A confidence outside 0..1 (never valid by the schema) is clamped, never shown as more than certain.
    expect(aiSuggestion([{ area: "ict", confidence: 7 }], [])?.confidence).toBe(1);
  });

  it("offers the 7 areas with their heading names, and the 4 close reasons", () => {
    expect(AREA_OPTIONS).toHaveLength(7);
    expect(AREA_OPTIONS.find((o) => o.value === "built_environment")?.label).toBe("The built environment");
    expect(CLOSE_REASON_OPTIONS.map((o) => o.value)).toEqual(["duplicate", "out_of_scope", "spam", "no_action_possible"]);
  });

  it("accepts only plain http(s) evidence links", () => {
    expect(checkEvidenceUrl("")).toEqual({ ok: true, url: undefined });
    expect(checkEvidenceUrl("  https://example.com/fix/photo.jpg ")).toEqual({ ok: true, url: "https://example.com/fix/photo.jpg" });
    expect(checkEvidenceUrl("http://intranet.example/tickets/FAC-120")).toEqual({ ok: true, url: "http://intranet.example/tickets/FAC-120" });
    for (const bad of ["javascript:alert(1)", "ftp://example.com/a", "example.com/photo", "not a link", "https://user:pw@example.com/"]) {
      expect(checkEvidenceUrl(bad), bad).toEqual({ ok: false, error: EVIDENCE_URL_ERRORS.format });
    }
    for (const personal of ["https://example.com/photo?email=sam@example.com", "https://example.com/case?id=1", "https://example.com/call/416-555-0142"]) {
      expect(checkEvidenceUrl(personal), personal).toEqual({ ok: false, error: EVIDENCE_URL_ERRORS.personal });
    }
    expect(checkEvidenceUrl(`https://example.com/${"a".repeat(2001)}`)).toEqual({ ok: false, error: EVIDENCE_URL_ERRORS.tooLong });
  });
});

describe("acknowledgement line (ACR s.9(4))", () => {
  const at = new Date("2026-10-03T15:00:00Z");
  it("says how and when the feedback was acknowledged", () => {
    expect(acknowledgementLine({ intakeChannel: "web", isAnonymous: true }, [{ payload: { channel: "web_screen" }, createdAt: at }]))
      .toEqual({ kind: "screen", at });
    expect(acknowledgementLine({ intakeChannel: "phone", isAnonymous: false }, [{ payload: { channel: "phone", manual: true }, createdAt: at }]))
      .toEqual({ kind: "manual", channelWords: "by phone", at, recordedAt: at, givenOn: null });
    expect(acknowledgementLine({ intakeChannel: "mail", isAnonymous: true }, [])).toEqual({ kind: "anonymous" });
    expect(acknowledgementLine({ intakeChannel: "email", isAnonymous: false }, [])).toEqual({ kind: "missing" });
    expect(acknowledgementLine({ intakeChannel: "web", isAnonymous: true }, [])).toEqual({ kind: "missing" });
  });
});

describe("the inbox and My work summary cell", () => {
  it("shows the reporter's own words when they kept them, never the rejected AI summary", () => {
    expect(caseSummaryCell({ summary: null, summarySource: "reporter_words", aiSummary: "AI words", redactedText: "My [PERSON] words" }))
      .toEqual({ text: "My [PERSON] words", source: "Reporter's own words" });
    expect(caseSummaryCell({ summary: "Confirmed", summarySource: "ai_confirmed", aiSummary: "Confirmed", redactedText: "x" }))
      .toEqual({ text: "Confirmed", source: "AI summary, confirmed" });
  });
});

describe("the verified moment plays once, only for a fresh verification", () => {
  const id = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
  const now = new Date("2026-10-19T12:00:00Z");
  const verified = { id, status: "verified", verifiedAt: new Date("2026-10-19T11:00:00Z") };
  it("plays for a case verified recently that this browser has not seen", () => {
    expect(seenKey(id)).toBe("a1b2c3d4e5f6");
    expect(playVerifiedMoment(verified, undefined, now)).toBe(true);
    expect(playVerifiedMoment(verified, "000000000000.a1b2c3d4e5f6", now)).toBe(false);
    expect(playVerifiedMoment({ ...verified, verifiedAt: new Date("2026-08-01T00:00:00Z") }, undefined, now)).toBe(false);
    expect(playVerifiedMoment({ ...verified, status: "fixed_unverified" }, undefined, now)).toBe(false);
  });
});

describe("was the reporter really asked to check the fix? (never \"the reporter is asked\" when nobody was)", () => {
  const at = new Date("2026-10-01T15:00:00Z");
  const sent = (status: string, round = 1): EventLike => ({ type: "message_sent", payload: { template: "retest_request", status, round }, createdAt: at });
  const submitted = (hasEmail: boolean): EventLike => ({ type: "submitted", payload: { channel: "web", hasEmail }, createdAt: at });

  it("reads this round's request email from the events", () => {
    expect(retestAskOf([submitted(true), sent("sent")], 1, "none")).toEqual({ kind: "emailed", at });
    expect(retestAskOf([submitted(true), sent("skipped_fake")], 1, "none")).toEqual({ kind: "logged", at });
    expect(retestAskOf([submitted(true), sent("failed")], 1, "none")).toEqual({ kind: "failed" });
    expect(retestAskOf([submitted(true), sent("failed"), sent("sent")], 1, "none").kind).toBe("emailed");
    expect(retestAskOf([submitted(true), sent("sent", 1)], 2, "none")).toEqual({ kind: "not_sent" }); // round 1's email is not round 2's
    expect(retestAskOf([submitted(false)], 1, "none")).toEqual({ kind: "no_email", contact: "none" });
    expect(retestAskOf([submitted(false)], 1, "other")).toEqual({ kind: "no_email", contact: "other" });
  });

  it("says what really happened", () => {
    expect(retestAskSentence({ kind: "emailed" })).toBe("The reporter was emailed and asked to check it.");
    expect(retestAskSentence({ kind: "logged" })).toContain("logged, not sent (email is simulated in this prototype; the Outbox shows it)");
    expect(retestAskSentence({ kind: "failed" })).toContain("could not be sent");
    expect(retestAskSentence({ kind: "no_email", contact: "none" })).toBe(
      "No contact on file: they'll see it only if they open their report page with their code.",
    );
    expect(NO_CONTACT_ON_FILE).toBe("No contact on file: they'll see it only if they open their report page with their code.");
    expect(retestAskSentence({ kind: "no_email", contact: "other" })).toMatch(/^No email on file: .* You can tell them another way/);
    expect(retestAskSentence({ kind: "no_email", contact: "unknown" })).toBe(
      "No email on file: they'll see it only if they open their report page with their code.",
    );
    for (const kind of ["failed", "not_sent"] as const) expect(retestAskSentence({ kind })).not.toMatch(/is asked|was emailed/);
  });
});

describe("staff notes (Phase 7 T2 item 4)", () => {
  const at = (d: string) => new Date(`2026-10-${d}T15:00:00Z`);
  const note = (seq: number, payload: Record<string, unknown>, actorKind = "staff", day = "10") =>
    ({ seq, type: "note_added", actorKind, actorId: LEAD_ID, payload, createdAt: at(day) });

  it("lists the staff notes newest first; a reporter's note and other events are not staff notes", () => {
    const notes = staffNotes([
      note(3, { kind: "internal", note: "Part ordered." }),
      note(5, { kind: "interim_accommodation", note: "Side door opened on request." }, "staff", "12"),
      note(6, { via: "receipt_code", note: "Please call me." }, "reporter"),
      note(7, { note: "Checked." }), // before Phase 7: no kind
      note(8, { kind: "internal", note: "   " }),
      { seq: 9, type: "closed", actorKind: "staff", actorId: LEAD_ID, payload: { note: "x" }, createdAt: at("13") },
    ]);
    expect(notes.map((n) => [n.seq, n.kind, n.text])).toEqual([
      [7, "internal", "Checked."],
      [5, "interim_accommodation", "Side door opened on request."],
      [3, "internal", "Part ordered."],
    ]);
    expect(NOTE_KIND_LABELS).toEqual({ internal: "Internal note", interim_accommodation: "Interim accommodation" });
  });

  it("layer-1 redacts a note before it enters the log", () => {
    expect(scrubNote("  Call them at 416-555-0142 or sam@example.com.  ")).toBe("Call them at [PHONE] or [EMAIL].");
  });
});

describe("correcting an approved redaction (Phase 7 T2 stretch)", () => {
  const leadV: CaseViewer = { role: "lead", memberId: LEAD_ID };
  const ownerV: CaseViewer = { role: "owner", memberId: OWNER_ID };
  const auditorV: CaseViewer = { role: "auditor", memberId: "44444444-4444-4444-8444-444444444444" };

  it("only the lead, and only after the approval (before it, the review itself does this)", () => {
    for (const status of CASE_STATUSES) {
      const approved: CaseAccessFacts = { status, assignedTo: OWNER_ID, redactionApproved: true };
      expect(canRun("revise_redaction", leadV, approved), status).toBe(true);
      expect(canRun("revise_redaction", leadV, { ...approved, redactionApproved: false }), status).toBe(false);
      expect(canRun("revise_redaction", ownerV, approved), status).toBe(false);
      expect(canRun("revise_redaction", auditorV, approved), status).toBe(false);
    }
  });

  it("words the correction as its own History line; the first approval keeps its wording", () => {
    const corrected = describeEvent(
      ev("redaction_approved", { spans: [{ type: "PERSON" }, { type: "PERSON" }], kept: 1, removed: 0, added: 1, revision: true }, "staff", LEAD_ID),
      auditor,
    );
    expect(corrected).toMatchObject({
      title: "Redaction corrected by Alex Rivera",
      body: "2 details hidden (person). 1 set of words added by hand; every detail hidden before stays hidden.",
      tone: "warning",
    });
    expect(describeEvent(ev("redaction_approved", { spans: [], kept: 0, removed: 0, added: 0 }, "staff", LEAD_ID), auditor).title)
      .toBe("Redaction approved by Alex Rivera");
  });
});
