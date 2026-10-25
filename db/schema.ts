// FROZEN. Do not edit outside a dedicated, human-approved "schema change" task.
// Source of truth for meaning: docs/domain.md. RLS/triggers: db/sql/0100_security.sql.
import {
  pgTable, pgEnum, uuid, text, boolean, integer, timestamp, date, jsonb, bigserial,
  uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core";

// ---------- enums ----------

// ACA s.5 (a)-(f) incl. (c.1). See docs/domain.md §1.2 for heading text.
export const priorityArea = pgEnum("priority_area", [
  "employment",
  "built_environment",
  "ict",
  "communication_other",
  "procurement",
  "programs_services",
  "transportation",
]);

export const regulator = pgEnum("regulator", [
  "accessibility_commissioner", // ACR SOR/2021-241
  "crtc",                       // SOR/2021-160
  "cta",                        // Accessible Transportation Planning and Reporting Regulations
]);

export const entityClass = pgEnum("entity_class", ["federal_public", "private_large", "private_small"]);

export const memberRole = pgEnum("member_role", ["lead", "owner", "auditor"]);

export const caseStatus = pgEnum("case_status", [
  "new", "triaged", "assigned", "retest_open", "verified", "fixed_unverified", "closed",
]);

// ACR s.9(3): mail, telephone, email + any other means used with the public.
export const intakeChannel = pgEnum("intake_channel", ["web", "email", "phone", "mail", "in_person", "other"]);

export const locationKind = pgEnum("location_kind", ["digital", "place", "phone_or_service", "document", "other"]);

export const summarySource = pgEnum("summary_source", ["ai_confirmed", "ai_edited", "reporter_words", "staff"]);

export const closedReason = pgEnum("closed_reason", ["duplicate", "out_of_scope", "spam", "no_action_possible"]);

export const eventType = pgEnum("event_type", [
  // status-changing (see lib/state-machine.ts)
  "triaged", "assigned", "fix_logged", "retest_verdict", "reopened", "closed", "retest_expired",
  // non-transition
  "submitted", "ack_recorded", "ai_structured", "redaction_proposed", "redaction_approved",
  "private_revealed", "note_added", "retest_requested", "message_sent", "opted_out",
]);

export const actorKind = pgEnum("actor_kind", ["reporter", "staff", "system"]);

export const reportStatus = pgEnum("report_status", ["draft", "signed_off"]);

// ---------- tables ----------

// NOT tenant-scoped (no RLS): public org profile resolved by slug on public routes.
export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  regulator: regulator("regulator").notNull().default("accessibility_commissioner"),
  entityClass: entityClass("entity_class").notNull().default("private_large"),
  // Areas in the org's accessibility plan; drives report headings (ACR s.14(1)(b)).
  planAreas: priorityArea("plan_areas").array().notNull(),
  // ACR s.9(1) / s.14(2)
  feedbackDesignateTitle: text("feedback_designate_title").notNull(),
  contactMailingAddress: text("contact_mailing_address").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactEmail: text("contact_email").notNull(),
  retestOfferText: text("retest_offer_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Cache of Clerk org memberships, upserted on each staff request.
export const orgMembers = pgTable("org_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  clerkUserId: text("clerk_user_id").notNull(),
  displayName: text("display_name").notNull(),
  role: memberRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("org_members_org_user").on(t.orgId, t.clerkUserId)]);

export const cases = pgTable("cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  seq: integer("seq").notNull(),                 // per-org counter
  ref: text("ref").notNull(),                    // "BAR-0042", non-secret, staff-facing
  status: caseStatus("status").notNull().default("new"),
  intakeChannel: intakeChannel("intake_channel").notNull(),
  locationKind: locationKind("location_kind").notNull(),
  locationDetail: text("location_detail"),       // redacted
  isAnonymous: boolean("is_anonymous").notNull().default(true),
  wantsRetest: boolean("wants_retest").notNull().default(false),
  aiOptOut: boolean("ai_opt_out").notNull().default(false),
  needsManualRedaction: boolean("needs_manual_redaction").notNull().default(false),
  redactedText: text("redacted_text").notNull(),
  aiSummary: text("ai_summary"),
  summary: text("summary"),                      // what the reporter confirmed (redacted)
  summarySource: summarySource("summary_source"),
  aiPriorityAreas: jsonb("ai_priority_areas").$type<{ area: string; confidence: number }[]>(),
  priorityArea: priorityArea("priority_area"),   // confirmed by lead at triage
  publicSummary: text("public_summary"),         // lead-approved; the ONLY case text used in reports
  assignedTo: uuid("assigned_to").references(() => orgMembers.id),
  dueAt: timestamptz("due_at"),                  // optional, set by the lead on assign (Phase 7 D8); null = no due date
  retestRound: integer("retest_round").notNull().default(0),
  closedReason: closedReason("closed_reason"),
  receiptCodeHash: text("receipt_code_hash").notNull().unique(), // HMAC, see lib/receipt-code.ts
  receivedAt: timestamptz("received_at").notNull(), // when the org received it (staff-logged intake may be in the past)
  ackAt: timestamptz("ack_at"),
  redactionApprovedAt: timestamptz("redaction_approved_at"),
  verifiedAt: timestamptz("verified_at"),
  retentionUntil: date("retention_until").notNull(), // receivedAt + 7y (ACR s.19)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("cases_org_seq").on(t.orgId, t.seq),
  uniqueIndex("cases_org_ref").on(t.orgId, t.ref),
  index("cases_org_status").on(t.orgId, t.status),
  index("cases_org_assignee").on(t.orgId, t.assignedTo),
]);

function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true });
}

// Lead-only (RLS checks app.role = 'lead'). Values are lib/crypto.ts ciphertexts.
export const casePrivate = pgTable("case_private", {
  caseId: uuid("case_id").primaryKey().references(() => cases.id),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  rawTextEnc: text("raw_text_enc").notNull(),
  reporterEmailEnc: text("reporter_email_enc"),
  reporterContactEnc: text("reporter_contact_enc"), // staff-logged phone/mail intake
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only, hash-chained per case. UPDATE/DELETE blocked by trigger. See lib/case-events.ts.
export const caseEvents = pgTable("case_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  seq: integer("seq").notNull(),
  type: eventType("type").notNull(),
  actorKind: actorKind("actor_kind").notNull(),
  actorId: text("actor_id"),                     // org_members.id for staff; null for reporter/system
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(), // redacted content only
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull(), // set by app (hashed)
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
}, (t) => [uniqueIndex("case_events_case_seq").on(t.caseId, t.seq), index("case_events_org").on(t.orgId)]);

// An org's named places, services, pages and documents (Phase 7 D8), managed by the lead and printed as QR
// posters that open the report form with the place filled in. Tenant table (RLS in db/sql/0100_security.sql).
// Retired with active = false, never deleted (the app role has no DELETE). Cases copy kind/detail; no FK to here.
export const orgLocations = pgTable("org_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),                   // poster heading, e.g. "Main Street branch"
  kind: locationKind("kind").notNull(),           // pre-fills the form's "Where did it happen?"
  detail: text("detail"),                         // pre-fills "Where exactly?"
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("org_locations_org").on(t.orgId)]);

// Fix evidence files (optional photo/screenshot). EXIF stripped before upload.
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  caseId: uuid("case_id").notNull().references(() => cases.id),
  eventSeq: integer("event_seq").notNull(),       // the case_events.seq it belongs to
  url: text("url").notNull(),
  sha256: text("sha256").notNull(),
  altText: text("alt_text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  title: text("title").notNull(),
  status: reportStatus("status").notNull().default("draft"),
  snapshot: jsonb("snapshot").notNull(),          // { cases:[...headHash], facts:[...] }
  manifestHash: text("manifest_hash").notNull(),
  content: jsonb("content").notNull(),            // { sections:[{heading, level, sentences:[{id,text,factIds,fallback}] , placeholder?}] }
  headingCheck: jsonb("heading_check").notNull(), // output of lib/report/headings.ts
  areaText: jsonb("area_text").$type<Record<string, string>>().notNull().default({}),
  consultationsText: text("consultations_text"),
  createdBy: uuid("created_by").notNull().references(() => orgMembers.id),
  signedOffBy: uuid("signed_off_by").references(() => orgMembers.id),
  signedOffAt: timestamptz("signed_off_at"),
  publishedAt: timestamptz("published_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Log of every outbound message (email ack, re-test request, reminder).
export const outboundMessages = pgTable("outbound_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id),
  caseId: uuid("case_id").references(() => cases.id),
  channel: text("channel").notNull(),             // "email"
  template: text("template").notNull(),           // "ack" | "retest_request" | "retest_reminder"
  status: text("status").notNull(),               // "sent" | "failed" | "skipped_fake"
  providerId: text("provider_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Postgres token bucket for public routes. key = HMAC(daily salt, ip) + route. Not tenant-scoped.
export const rateLimits = pgTable("rate_limits", {
  key: text("key").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.windowStart] })]);
