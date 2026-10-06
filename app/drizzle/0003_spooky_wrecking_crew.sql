CREATE TABLE "share_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "share_recipient_owner_id_recipient_id_unique" UNIQUE("owner_id","recipient_id"),
	CONSTRAINT "share_recipient_distinct" CHECK ("share_recipient"."owner_id" <> "share_recipient"."recipient_id")
);
--> statement-breakpoint
CREATE TABLE "share" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone NOT NULL,
	"allowed_fields" text[] NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "share_distinct" CHECK ("share"."owner_id" <> "share"."recipient_id"),
	CONSTRAINT "share_time_range" CHECK ("share"."from_at" < "share"."to_at" AND "share"."to_at" <= "share"."from_at" + interval '62 days'),
	CONSTRAINT "share_expiration" CHECK ("share"."expires_at" > "share"."consented_at" AND "share"."expires_at" <= "share"."consented_at" + interval '30 days'),
	CONSTRAINT "share_fields" CHECK ("share"."allowed_fields" = ARRAY['startAt','endAt']::text[] OR "share"."allowed_fields" = ARRAY['course','classType','startAt','endAt','location']::text[])
);
--> statement-breakpoint
ALTER TABLE "share_recipient" ADD CONSTRAINT "share_recipient_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_recipient" ADD CONSTRAINT "share_recipient_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share" ADD CONSTRAINT "share_recipient_id_user_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_owner_id_id_index" ON "share" USING btree ("owner_id","id");--> statement-breakpoint
CREATE INDEX "share_recipient_id_id_index" ON "share" USING btree ("recipient_id","id");