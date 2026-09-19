CREATE TYPE "public"."membership_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('official', 'test', 'supplementary');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('verified', 'unverified');--> statement-breakpoint
CREATE TABLE "capacity_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"total" integer,
	"available" integer,
	"observed_at" timestamp with time zone NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capacity_snapshot_source_id_external_id_unique" UNIQUE("source_id","external_id"),
	CONSTRAINT "capacity_snapshot_source_id_class_id_observed_at_unique" UNIQUE("source_id","class_id","observed_at"),
	CONSTRAINT "capacity_nonnegative" CHECK (("capacity_snapshot"."total" IS NULL OR "capacity_snapshot"."total" >= 0) AND ("capacity_snapshot"."available" IS NULL OR "capacity_snapshot"."available" >= 0)),
	CONSTRAINT "capacity_verified_official_only" CHECK ("capacity_snapshot"."verification_status" <> 'verified' OR "capacity_snapshot"."source_kind" = 'official')
);
--> statement-breakpoint
CREATE TABLE "class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"course_id" uuid NOT NULL,
	"term" text NOT NULL,
	"class_code" text NOT NULL,
	"type" text NOT NULL,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	CONSTRAINT "class_source_id_external_id_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "course" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "course_source_id_external_id_unique" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
CREATE TABLE "data_source" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "data_source_id_kind_unique" UNIQUE("id","kind")
);
--> statement-breakpoint
CREATE TABLE "identity_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"identity_provider" text NOT NULL,
	"external_subject" text NOT NULL,
	CONSTRAINT "identity_link_identity_provider_external_subject_unique" UNIQUE("identity_provider","external_subject")
);
--> statement-breakpoint
CREATE TABLE "student_class" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"class_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_class_source_id_external_id_unique" UNIQUE("source_id","external_id"),
	CONSTRAINT "student_class_user_id_class_id_unique" UNIQUE("user_id","class_id")
);
--> statement-breakpoint
CREATE TABLE "sync_scope" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"term" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"digest" text,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "sync_scope_source_id_term_unique" UNIQUE("source_id","term"),
	CONSTRAINT "sync_version_nonnegative" CHECK ("sync_scope"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "timetable_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"external_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"location" text,
	"status" "record_status" DEFAULT 'active' NOT NULL,
	"verification_status" "verification_status" DEFAULT 'unverified' NOT NULL,
	"source_updated_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_entry_source_id_external_id_unique" UNIQUE("source_id","external_id"),
	CONSTRAINT "entry_time_order" CHECK ("timetable_entry"."end_at" > "timetable_entry"."start_at"),
	CONSTRAINT "entry_verified_official_only" CHECK ("timetable_entry"."verification_status" <> 'verified' OR "timetable_entry"."source_kind" = 'official')
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "user_role" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"scope_type" text NOT NULL,
	"course_id" uuid,
	CONSTRAINT "role_scope" CHECK (("user_role"."role" = 'student' AND "user_role"."scope_type" = 'global' AND "user_role"."course_id" IS NULL) OR ("user_role"."role" = 'staff' AND "user_role"."scope_type" = 'course' AND "user_role"."course_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "capacity_snapshot" ADD CONSTRAINT "capacity_snapshot_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capacity_snapshot" ADD CONSTRAINT "capacity_snapshot_source_id_source_kind_data_source_id_kind_fk" FOREIGN KEY ("source_id","source_kind") REFERENCES "public"."data_source"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_source_id_data_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class" ADD CONSTRAINT "class_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_source_id_data_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link" ADD CONSTRAINT "identity_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class" ADD CONSTRAINT "student_class_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class" ADD CONSTRAINT "student_class_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_class" ADD CONSTRAINT "student_class_source_id_data_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_scope" ADD CONSTRAINT "sync_scope_source_id_data_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_source"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entry" ADD CONSTRAINT "timetable_entry_source_id_source_kind_data_source_id_kind_fk" FOREIGN KEY ("source_id","source_kind") REFERENCES "public"."data_source"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_source_term_idx" ON "class" USING btree ("source_id","term");--> statement-breakpoint
CREATE INDEX "student_class_user_idx" ON "student_class" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "entry_class_time_idx" ON "timetable_entry" USING btree ("class_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_course_unique" ON "user_role" USING btree ("user_id","role","course_id") WHERE "user_role"."course_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_global_unique" ON "user_role" USING btree ("user_id","role") WHERE "user_role"."course_id" IS NULL;