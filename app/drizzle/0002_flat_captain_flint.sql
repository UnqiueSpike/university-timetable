CREATE TABLE "announcement_target" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"course_id" uuid,
	"class_id" uuid,
	"group_id" uuid,
	CONSTRAINT "announcement_target_announcement_id_course_id_unique" UNIQUE("announcement_id","course_id"),
	CONSTRAINT "announcement_target_announcement_id_class_id_unique" UNIQUE("announcement_id","class_id"),
	CONSTRAINT "announcement_target_announcement_id_group_id_unique" UNIQUE("announcement_id","group_id"),
	CONSTRAINT "announcement_target_one" CHECK (num_nonnulls("announcement_target"."course_id", "announcement_target"."class_id", "announcement_target"."group_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "announcement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "announcement_revision" CHECK ("announcement"."revision" > 0),
	CONSTRAINT "announcement_content" CHECK (length(trim("announcement"."title")) BETWEEN 1 AND 200 AND length(trim("announcement"."body")) BETWEEN 1 AND 5000),
	CONSTRAINT "announcement_state" CHECK (("announcement"."status" = 'draft' AND "announcement"."published_at" IS NULL AND "announcement"."withdrawn_at" IS NULL) OR ("announcement"."status" = 'published' AND "announcement"."published_at" IS NOT NULL AND "announcement"."withdrawn_at" IS NULL) OR ("announcement"."status" = 'withdrawn' AND "announcement"."published_at" IS NOT NULL AND "announcement"."withdrawn_at" >= "announcement"."published_at"))
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text NOT NULL,
	"course_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"group_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "group_member_group_id_user_id_unique" UNIQUE("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "staff_permission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"permission" text NOT NULL,
	"course_id" uuid,
	"group_id" uuid,
	CONSTRAINT "staff_permission_user_id_permission_course_id_unique" UNIQUE("user_id","permission","course_id"),
	CONSTRAINT "staff_permission_user_id_permission_group_id_unique" UNIQUE("user_id","permission","group_id"),
	CONSTRAINT "permission_scope" CHECK (("staff_permission"."course_id" IS NOT NULL) <> ("staff_permission"."group_id" IS NOT NULL)),
	CONSTRAINT "permission_name" CHECK ("staff_permission"."permission" IN ('supplement.write', 'announcement.manage', 'audit.read') AND ("staff_permission"."permission" <> 'supplement.write' OR "staff_permission"."course_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "supplement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"content" text NOT NULL,
	"author_id" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supplement_revision" CHECK ("supplement"."revision" > 0),
	CONSTRAINT "supplement_content" CHECK (length(trim("supplement"."content")) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE TABLE "user_group" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement_target" ADD CONSTRAINT "announcement_target_announcement_id_announcement_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_target" ADD CONSTRAINT "announcement_target_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_target" ADD CONSTRAINT "announcement_target_class_id_class_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."class"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_target" ADD CONSTRAINT "announcement_target_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_member" ADD CONSTRAINT "group_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission" ADD CONSTRAINT "staff_permission_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission" ADD CONSTRAINT "staff_permission_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_permission" ADD CONSTRAINT "staff_permission_group_id_user_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_group"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement" ADD CONSTRAINT "supplement_entry_id_timetable_entry_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."timetable_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement" ADD CONSTRAINT "supplement_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplement" ADD CONSTRAINT "supplement_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_visible_idx" ON "announcement" USING btree ("status","published_at","id");--> statement-breakpoint
CREATE INDEX "audit_time_idx" ON "audit_event" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "supplement_entry_idx" ON "supplement" USING btree ("entry_id");--> statement-breakpoint
CREATE FUNCTION prevent_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit records are append-only'; END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_event FOR EACH ROW EXECUTE FUNCTION prevent_audit_change();
