CREATE TYPE "public"."actor_kind" AS ENUM('reporter', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('new', 'triaged', 'assigned', 'retest_open', 'verified', 'fixed_unverified', 'closed');--> statement-breakpoint
CREATE TYPE "public"."closed_reason" AS ENUM('duplicate', 'out_of_scope', 'spam', 'no_action_possible');--> statement-breakpoint
CREATE TYPE "public"."entity_class" AS ENUM('federal_public', 'private_large', 'private_small');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('triaged', 'assigned', 'fix_logged', 'retest_verdict', 'reopened', 'closed', 'retest_expired', 'submitted', 'ack_recorded', 'ai_structured', 'redaction_proposed', 'redaction_approved', 'private_revealed', 'note_added', 'retest_requested', 'message_sent', 'opted_out');--> statement-breakpoint
CREATE TYPE "public"."intake_channel" AS ENUM('web', 'email', 'phone', 'mail', 'in_person', 'other');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('digital', 'place', 'phone_or_service', 'document', 'other');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('lead', 'owner', 'auditor');--> statement-breakpoint
CREATE TYPE "public"."priority_area" AS ENUM('employment', 'built_environment', 'ict', 'communication_other', 'procurement', 'programs_services', 'transportation');--> statement-breakpoint
CREATE TYPE "public"."regulator" AS ENUM('accessibility_commissioner', 'crtc', 'cta');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'signed_off');--> statement-breakpoint
CREATE TYPE "public"."summary_source" AS ENUM('ai_confirmed', 'ai_edited', 'reporter_words', 'staff');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"event_seq" integer NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"alt_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" "event_type" NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_private" (
	"case_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"raw_text_enc" text NOT NULL,
	"reporter_email_enc" text,
	"reporter_contact_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"ref" text NOT NULL,
	"status" "case_status" DEFAULT 'new' NOT NULL,
	"intake_channel" "intake_channel" NOT NULL,
	"location_kind" "location_kind" NOT NULL,
	"location_detail" text,
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"wants_retest" boolean DEFAULT false NOT NULL,
	"ai_opt_out" boolean DEFAULT false NOT NULL,
	"needs_manual_redaction" boolean DEFAULT false NOT NULL,
	"redacted_text" text NOT NULL,
	"ai_summary" text,
	"summary" text,
	"summary_source" "summary_source",
	"ai_priority_areas" jsonb,
	"priority_area" "priority_area",
	"public_summary" text,
	"assigned_to" uuid,
	"retest_round" integer DEFAULT 0 NOT NULL,
	"closed_reason" "closed_reason",
	"receipt_code_hash" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"ack_at" timestamp with time zone,
	"redaction_approved_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"retention_until" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_receipt_code_hash_unique" UNIQUE("receipt_code_hash")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"clerk_user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_org_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"regulator" "regulator" DEFAULT 'accessibility_commissioner' NOT NULL,
	"entity_class" "entity_class" DEFAULT 'private_large' NOT NULL,
	"plan_areas" "priority_area"[] NOT NULL,
	"feedback_designate_title" text NOT NULL,
	"contact_mailing_address" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text NOT NULL,
	"retest_offer_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_clerk_org_id_unique" UNIQUE("clerk_org_id"),
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"case_id" uuid,
	"channel" text NOT NULL,
	"template" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"title" text NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"heading_check" jsonb NOT NULL,
	"area_text" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"consultations_text" text,
	"created_by" uuid NOT NULL,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_private" ADD CONSTRAINT "case_private_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_private" ADD CONSTRAINT "case_private_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_assigned_to_org_members_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_org_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_signed_off_by_org_members_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."org_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_events_case_seq" ON "case_events" USING btree ("case_id","seq");--> statement-breakpoint
CREATE INDEX "case_events_org" ON "case_events" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_org_seq" ON "cases" USING btree ("org_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_org_ref" ON "cases" USING btree ("org_id","ref");--> statement-breakpoint
CREATE INDEX "cases_org_status" ON "cases" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "cases_org_assignee" ON "cases" USING btree ("org_id","assigned_to");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user" ON "org_members" USING btree ("org_id","clerk_user_id");