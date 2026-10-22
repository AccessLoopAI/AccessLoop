// Slice C's pure parts: staff-typed dates (display time zone), the "Log feedback" validation and its pipeline (fake
// AI), the org settings validation, the new case-page steps (acknowledge, remind), the acknowledgement step and
// line, the History wording of emails, and the lead's navigation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAFF_ROLES, staffNav, type StaffRole } from "@/lib/auth/staff";
import { SIGNED_OUT, actionFailureMessage } from "@/lib/auth/signed-out";
import { staffNavCurrent } from "@/components/layout/staff-nav-current";
import { canRun, type CaseAccessFacts, type CaseViewer } from "@/lib/cases/access";
import { describeEvent } from "@/lib/cases/history";
import { acknowledgementStep, messagesSent, reminderSentAt, reporterGaveEmail } from "@/lib/cases/messages";
import { acknowledgementLine } from "@/lib/cases/summary";
import { checkPastDate, instantForDate, isIsoDate, yearsBefore, zonedDate, zonedNoon } from "@/lib/dates";
import { formatDateLong } from "@/lib/format";
import { STAFF_INTAKE_ERRORS, parseStaffIntake, prepareStaffCase, type StaffIntake } from "@/lib/intake/staff";
import { SETTINGS_ERRORS, parseOrgSettings, telHref } from "@/lib/org-settings";
import { CASE_STATUSES } from "@/lib/status";

vi.mock("@/lib/auth/local-session", () => ({ LOCAL_SESSION_COOKIE: "x", localAuthAllowed: () => false, verifyLocalSession: () => null }));
vi.mock("@/db/client", () => ({ db: {} }));

const NOW = new Date("2026-10-19T15:30:00.000Z"); // 11:30 a.m. in Toronto (EDT)

describe("dates typed by staff (America/Toronto)", () => {
  it("reads today's date in the display time zone, not UTC", () => {
    expect(zonedDate(NOW)).toBe("2026-10-19");
    expect(zonedDate(new Date("2026-10-20T02:00:00.000Z"))).toBe("2026-10-19"); // 10 p.m. the day before in Toronto
  });

  it("noon in Toronto follows daylight saving time", () => {
    expect(zonedNoon("2026-10-15").toISOString()).toBe("2026-10-15T16:00:00.000Z"); // EDT
    expect(zonedNoon("2026-12-15").toISOString()).toBe("2026-12-15T17:00:00.000Z"); // EST
    expect(formatDateLong(zonedNoon("2026-03-08"))).toBe("March 8, 2026"); // the day DST starts
  });

  it("today is now; an earlier day is its noon", () => {
    expect(instantForDate("2026-10-19", NOW)).toBe(NOW);
    expect(instantForDate("2026-10-14", NOW).toISOString()).toBe("2026-10-14T16:00:00.000Z");
  });

  it("accepts real past dates only, within 7 years and not before a minimum", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(checkPastDate("", NOW)).toBe("missing");
    expect(checkPastDate("19/10/2026", NOW)).toBe("invalid");
    expect(checkPastDate("2026-10-20", NOW)).toBe("future");
    expect(checkPastDate("2026-10-19", NOW)).toBeNull();
    expect(checkPastDate(yearsBefore("2026-10-19", 7), NOW)).toBeNull();
    expect(checkPastDate("2019-10-18", NOW)).toBe("too_old");
    expect(checkPastDate("2026-10-10", NOW, "2026-10-12")).toBe("before_min");
    expect(yearsBefore("2028-02-29", 1)).toBe("2027-02-28");
  });
});

describe("Log feedback: validation", () => {
  const valid = {
    channel: "phone",
    receivedDate: "2026-10-16",
    text: "The phone menu has no option to reach a person.",
    locationKind: "phone_or_service",
    locationDetail: "",
    anonymous: "no",
    email: "",
    contact: "416-555-0199",
    wantsRetest: "yes",
  };

  it("accepts a complete phone intake", () => {
    const r = parseStaffIntake(valid, NOW);
    expect(r).toEqual({
      ok: true,
      value: {
        channel: "phone", receivedDate: "2026-10-16", text: valid.text, locationKind: "phone_or_service", locationDetail: "",
        anonymous: false, email: null, contact: "416-555-0199", wantsRetest: true, aiOptOut: false,
      },
    });
    expect(parseStaffIntake({ ...valid, aiOptOut: "on" }, NOW)).toMatchObject({ ok: true, value: { aiOptOut: true } });
  });

  it("says what to do for every missing answer", () => {
    const r = parseStaffIntake({}, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      channel: STAFF_INTAKE_ERRORS.channel,
      receivedDate: STAFF_INTAKE_ERRORS.dateMissing,
      text: STAFF_INTAKE_ERRORS.text,
      locationKind: STAFF_INTAKE_ERRORS.locationKind,
      anonymous: STAFF_INTAKE_ERRORS.anonymous,
      wantsRetest: STAFF_INTAKE_ERRORS.wantsRetest,
    });
  });

  it("refuses a future date, a bad email and an unknown channel", () => {
    const r = parseStaffIntake({ ...valid, receivedDate: "2026-10-20", email: "not-an-email", channel: "web" }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({ receivedDate: STAFF_INTAKE_ERRORS.dateFuture, email: STAFF_INTAKE_ERRORS.email, channel: STAFF_INTAKE_ERRORS.channel });
  });

  it("names the field in every too-long message, so two ErrorSummary links never read the same (WCAG 2.4.4)", () => {
    const r = parseStaffIntake({ ...valid, anonymous: "no", locationDetail: "x".repeat(301), contact: "y".repeat(301) }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({ locationDetail: STAFF_INTAKE_ERRORS.detailTooLong, contact: STAFF_INTAKE_ERRORS.contactTooLong });
    const messages = [STAFF_INTAKE_ERRORS.textTooLong, STAFF_INTAKE_ERRORS.detailTooLong, STAFF_INTAKE_ERRORS.contactTooLong];
    expect(new Set(messages).size).toBe(3);
    for (const m of messages) expect(m).not.toMatch(/^Keep it /);
  });

  it("drops contact details when the person stays anonymous (a hidden field may still hold them)", () => {
    const r = parseStaffIntake({ ...valid, anonymous: "yes", email: "someone@example.com", contact: "416-555-0199" }, NOW);
    expect(r).toMatchObject({ ok: true, value: { anonymous: true, email: null, contact: null } });
  });
});

describe("Log feedback: the same pipeline as the web form", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.FAKE_LLM = "1";
    process.env.AI_BACKEND = "fake";
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  const TEXT =
    "Hi, my name is Daniel Okafor. The automatic door button at the King Street branch has been broken " +
    "for three weeks, so I can't get in with my wheelchair. Call me at four one six five five five zero one four two.";
  const intake: StaffIntake = {
    channel: "phone", receivedDate: "2026-10-16", text: TEXT, locationKind: "place", locationDetail: "",
    anonymous: false, email: null, contact: "416-555-0199", wantsRetest: true, aiOptOut: false,
  };
  const ORG = "11111111-1111-4111-8111-111111111111";
  const MEMBER = "22222222-2222-4222-8222-222222222222";

  it("redacts, summarizes the redacted text, and marks the code as relayed by staff when there is no email", async () => {
    const input = await prepareStaffCase(ORG, intake, MEMBER, NOW);
    expect(input).toMatchObject({
      orgId: ORG, intakeChannel: "phone", isAnonymous: false, wantsRetest: true, aiOptOut: false, rawText: TEXT,
      reporterEmail: null, reporterContact: "416-555-0199", summarySource: "staff", loggedByMemberId: MEMBER,
      codeRelayedByStaff: true, needsManualRedaction: false,
    });
    expect(input.receivedAt.toISOString()).toBe("2026-10-16T16:00:00.000Z");
    expect(input.redactedText).toContain("[PERSON]");
    expect(input.redactedText).not.toContain("Daniel");
    expect(input.ai?.backend).toBe("fake");
    expect(input.summary).toBe(input.ai?.summary);
    expect(input.summary ?? "").not.toContain("Daniel");
  });

  it("an email means the system sends the code (not relayed by staff); declining AI skips it and flags a manual check", async () => {
    const emailed = await prepareStaffCase(ORG, { ...intake, channel: "email", email: "person@example.com" }, MEMBER, NOW);
    expect(emailed.codeRelayedByStaff).toBe(false);
    expect(emailed.reporterEmail).toBe("person@example.com");
    const noAi = await prepareStaffCase(ORG, { ...intake, aiOptOut: true, receivedDate: "2026-10-19" }, MEMBER, NOW);
    expect(noAi).toMatchObject({ ai: null, summary: null, summarySource: "staff", needsManualRedaction: true, aiOptOut: true });
    expect(noAi.receivedAt).toBe(NOW);
  });
});

describe("org settings: validation", () => {
  const raw = {
    feedbackDesignateTitle: "Accessibility Lead",
    contactMailingAddress: "1 Test Road, Ottawa, ON K1A 0A0",
    contactPhone: "1-800-555-0101",
    contactEmail: "access@example.org",
    retestOfferText: "",
    entityClass: "private_large",
  };

  it("accepts the ACR s.9(1) and s.14(2) details, keeps areas in ACA order, and stores an empty offer as null", () => {
    expect(parseOrgSettings(raw, ["programs_services", "ict"])).toEqual({
      ok: true,
      value: { ...raw, retestOfferText: null, planAreas: ["ict", "programs_services"], entityClass: "private_large" },
    });
    expect(parseOrgSettings({ ...raw, contactPhone: "(416) 555-0100 ext. 22" }, ["ict"]).ok).toBe(true);
  });

  it("requires every contact detail, a real email and phone, one area and a known type", () => {
    const r = parseOrgSettings(
      { feedbackDesignateTitle: " ", contactMailingAddress: "", contactPhone: "call us", contactEmail: "nope", entityClass: "big" },
      ["not_an_area"],
    );
    expect(r).toEqual({
      ok: false,
      errors: {
        feedbackDesignateTitle: SETTINGS_ERRORS.title,
        contactMailingAddress: SETTINGS_ERRORS.address,
        contactPhone: SETTINGS_ERRORS.phone,
        contactEmail: SETTINGS_ERRORS.email,
        planAreas: SETTINGS_ERRORS.planAreas,
        entityClass: SETTINGS_ERRORS.entityClass,
      },
    });
    expect(parseOrgSettings({ ...raw, retestOfferText: "x".repeat(201) }, ["ict"])).toMatchObject({ ok: false, errors: { retestOfferText: SETTINGS_ERRORS.offerTooLong } });
  });
});

describe("the org phone number as a tel: link (ACR s.9(3))", () => {
  it("keeps the digits and turns an extension into ;ext=", () => {
    expect(telHref("613-555-0100 ext. 22")).toBe("tel:6135550100;ext=22");
    expect(telHref("613-555-0100 x22")).toBe("tel:6135550100;ext=22");
    expect(telHref("1-800-555-0100")).toBe("tel:18005550100");
    expect(telHref("+1 (613) 555-0100 x7")).toBe("tel:+16135550100;ext=7");
    expect(telHref("(416) 555-0100 EXT 5")).toBe("tel:4165550100;ext=5");
  });
});

describe("case page steps: acknowledge and remind", () => {
  const LEAD = "11111111-1111-4111-8111-111111111111";
  const OWNER = "22222222-2222-4222-8222-222222222222";
  const lead: CaseViewer = { role: "lead", memberId: LEAD };
  const owner: CaseViewer = { role: "owner", memberId: OWNER };
  const auditor: CaseViewer = { role: "auditor", memberId: "33333333-3333-4333-8333-333333333333" };
  const facts = (status: CaseAccessFacts["status"]): CaseAccessFacts => ({ status, assignedTo: OWNER, redactionApproved: true });

  it("only a lead acknowledges (in any status) and reminds (only while the reporter has the question)", () => {
    for (const status of CASE_STATUSES) {
      expect(canRun("acknowledge", lead, facts(status))).toBe(true);
      expect(canRun("remind", lead, facts(status))).toBe(status === "retest_open");
      for (const v of [owner, auditor]) {
        expect(canRun("acknowledge", v, facts(status))).toBe(false);
        expect(canRun("remind", v, facts(status))).toBe(false);
      }
    }
  });

  it("acknowledgement in the same means (ACR s.9(4))", () => {
    const c = (intakeChannel: "web" | "email" | "phone" | "mail" | "in_person" | "other", isAnonymous = false, ackAt: Date | null = null) =>
      ({ intakeChannel, isAnonymous, ackAt });
    expect(acknowledgementStep(c("web"), true)).toBeNull();
    expect(acknowledgementStep(c("email", true), true)).toBeNull();
    expect(acknowledgementStep(c("email", false, NOW), true)).toBeNull();
    expect(acknowledgementStep(c("email"), true)).toEqual({ kind: "email" });
    expect(acknowledgementStep(c("email"), false)).toEqual({ kind: "manual", channel: "email", words: "by email" });
    expect(acknowledgementStep(c("phone"), true)).toEqual({ kind: "manual", channel: "phone", words: "by phone" });
    expect(acknowledgementStep(c("mail"), false)).toEqual({ kind: "manual", channel: "mail", words: "by mail" });
    expect(acknowledgementStep(c("in_person"), false)).toEqual({ kind: "manual", channel: "in_person", words: "in person" });
    expect(acknowledgementStep(c("other"), false)).toEqual({ kind: "manual", channel: "other", words: "another way" });
  });

  it("the acknowledgement line shows the day the lead gave it, not the day they recorded it", () => {
    const line = acknowledgementLine({ intakeChannel: "phone", isAnonymous: false }, [
      { payload: { channel: "phone", manual: true, on: "2026-10-15" }, createdAt: NOW },
    ]);
    expect(line).toEqual({ kind: "manual", channelWords: "by phone", at: zonedNoon("2026-10-15"), recordedAt: NOW, givenOn: "2026-10-15" });
    const emailed = acknowledgementLine({ intakeChannel: "email", isAnonymous: false }, [{ payload: { channel: "email", messageId: "m1" }, createdAt: NOW }]);
    expect(emailed).toEqual({ kind: "manual", channelWords: "by email", at: NOW, recordedAt: NOW, givenOn: null });
  });

  it("one reminder per round: failed sends don't count; the submitted event says if there is an email", () => {
    const ev = (payload: Record<string, unknown>, at = NOW) => ({ type: "message_sent", payload, createdAt: at });
    const events = [
      { type: "submitted", payload: { hasEmail: true }, createdAt: NOW },
      ev({ template: "retest_request", status: "skipped_fake", round: 1 }),
      ev({ template: "retest_reminder", status: "failed", round: 1 }),
    ];
    expect(reporterGaveEmail(events)).toBe(true);
    expect(reporterGaveEmail([{ type: "submitted", payload: { hasEmail: false }, createdAt: NOW }])).toBe(false);
    expect(reminderSentAt(events, 1)).toBeNull();
    const later = new Date(NOW.getTime() + 60_000);
    expect(reminderSentAt([...events, ev({ template: "retest_reminder", status: "sent", round: 1 }, later)], 1)).toBe(later);
    expect(reminderSentAt([...events, ev({ template: "retest_reminder", status: "skipped_fake", round: 1 })], 2)).toBeNull();
    expect(messagesSent(events, "retest_request", 1)).toHaveLength(1);
  });
});

describe("History wording of emails", () => {
  const memberName = (id: string | null | undefined) => (id === "lead" ? "Alex Rivera" : null);
  const line = (payload: Record<string, unknown>, actorKind: "system" | "staff" = "system") =>
    describeEvent({ seq: 1, type: "message_sent", actorKind, actorId: actorKind === "staff" ? "lead" : null, payload }, { isLead: false, memberName });

  it("says whether the email was sent, simulated or failed, and never more than the template", () => {
    expect(line({ template: "ack", status: "sent" }).title).toBe("Email sent: acknowledgement email");
    expect(line({ template: "receipt_code", status: "skipped_fake" }).title).toBe("Email logged, not sent (simulated): receipt code email");
    expect(line({ template: "retest_request", status: "failed", round: 1 })).toMatchObject({
      title: "Email failed: re-test request email", body: "Re-test round 1.", tone: "danger", actor: "AccessLoop",
    });
    expect(line({ template: "retest_reminder", status: "skipped_fake", round: 2 }, "staff")).toMatchObject({ actor: "Alex Rivera", body: "Re-test round 2." });
    expect(describeEvent({ seq: 2, type: "ack_recorded", actorKind: "staff", actorId: "lead", payload: { channel: "email", messageId: "m" } }, { isLead: true, memberName }).title)
      .toBe("Acknowledgement recorded (by email)");
  });

  it("a recorded acknowledgement says the day it was given, which may be before the day it was recorded", () => {
    const ack = (payload: Record<string, unknown>, isLead: boolean) =>
      describeEvent({ seq: 3, type: "ack_recorded", actorKind: "staff", actorId: "lead", payload }, { isLead, memberName });
    const expected = `Given to the person on ${formatDateLong(zonedNoon("2026-10-15"))}.`;
    expect(expected).toBe("Given to the person on October 15, 2026.");
    for (const isLead of [true, false]) {
      expect(ack({ channel: "phone", manual: true, on: "2026-10-15" }, isLead)).toMatchObject({
        title: "Acknowledgement recorded (by phone)", actor: "Alex Rivera", body: expected,
      });
    }
    // An emailed acknowledgement (no `on`) and a malformed day say only what happened, never "Invalid Date".
    expect(ack({ channel: "email", messageId: "m" }, true).body).toBeUndefined();
    expect(ack({ channel: "mail", manual: true, on: "2026-02-30" }, true).body).toBeUndefined();
    expect(ack({ channel: "mail", manual: true, on: 20261015 }, true).body).toBeUndefined();
  });
});

describe("staff navigation", () => {
  it("leads get the dashboard, intake, Reports, Outbox, Eval and Settings; auditors the dashboard, inbox and Reports; owners their work; never 'New report'", () => {
    expect(staffNav("lead").map((i) => i.label)).toEqual(["Dashboard", "Inbox", "Log feedback", "My work", "Reports", "Outbox", "Eval", "Settings"]);
    expect(staffNav("lead").map((i) => i.href)).toEqual(["/app/dashboard", "/app/inbox", "/app/cases/new", "/app/my-work", "/app/reports", "/app/outbox", "/app/eval", "/app/settings"]);
    expect(staffNav("auditor").map((i) => i.label)).toEqual(["Dashboard", "Inbox", "Reports"]);
    expect(staffNav("owner").map((i) => i.label)).toEqual(["My work"]);
    for (const role of STAFF_ROLES) for (const item of staffNav(role)) expect(item.label.toLowerCase()).not.toContain("new report");
  });

  it("marks a tab's own page as the page, and a case page as part of the section its back link returns to", () => {
    const at = (role: StaffRole, path: string) => {
      const items = staffNav(role);
      const current = staffNavCurrent(items, path);
      return current ? [items[current.index].label, current.kind] : null;
    };
    expect(at("lead", "/app/inbox")).toEqual(["Inbox", "page"]);
    expect(at("lead", "/app/dashboard")).toEqual(["Dashboard", "page"]);
    expect(at("auditor", "/app/dashboard")).toEqual(["Dashboard", "page"]);
    expect(at("lead", "/app/cases/new")).toEqual(["Log feedback", "page"]); // its own page wins over the Inbox's section
    expect(at("lead", "/app/cases/BAR-0001")).toEqual(["Inbox", "true"]);
    expect(at("auditor", "/app/cases/BAR-0001")).toEqual(["Inbox", "true"]);
    expect(at("owner", "/app/cases/BAR-0001")).toEqual(["My work", "true"]);
    expect(at("owner", "/app/my-work")).toEqual(["My work", "page"]);
    expect(at("lead", "/app/reports/new")).toEqual(["Reports", "page"]);
    expect(at("auditor", "/app/reports/00000000-0000-4000-8000-000000000000")).toEqual(["Reports", "page"]);
    // A report's evidence check is part of Reports (its back link returns to the report).
    expect(at("lead", "/verify/00000000-0000-4000-8000-000000000000")).toEqual(["Reports", "true"]);
    expect(at("auditor", "/verify/00000000-0000-4000-8000-000000000000")).toEqual(["Reports", "true"]);
    expect(at("lead", "/app/design")).toBeNull();
  });
});

describe("signed-out answers (WCAG 2.2.1)", () => {
  it("turns proxy.ts's signed-out text into the sentence, and anything else into the page's own failure sentence", () => {
    expect(actionFailureMessage(new Error(SIGNED_OUT), "fallback")).toBe(SIGNED_OUT);
    expect(actionFailureMessage(new Error("An unexpected response was received from the server."), "fallback")).toBe("fallback");
    expect(actionFailureMessage("nope", "fallback")).toBe("fallback");
  });
});
