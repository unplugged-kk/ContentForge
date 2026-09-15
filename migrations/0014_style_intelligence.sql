CREATE TABLE "style_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"reference_id" integer NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"analyzer_version" varchar(40) NOT NULL,
	"request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_class" varchar(30),
	"error_message" text,
	"correlation_id" varchar(100) NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "style_analyses_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "analysis_id" integer;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "structured_observation" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "confidence" varchar(20);--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "analyzer_version" varchar(40);--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "schema_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "source_content_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "supersedes_id" integer;--> statement-breakpoint
ALTER TABLE "style_analyses" ADD CONSTRAINT "style_analyses_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "style_analyses_status_idx" ON "style_analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "style_analyses_reference_idx" ON "style_analyses" USING btree ("reference_id");--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_supersedes_id_style_profiles_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."style_profiles"("id") ON DELETE no action ON UPDATE no action;