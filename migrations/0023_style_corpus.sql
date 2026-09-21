ALTER TABLE "references" ADD COLUMN "is_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "references" ADD COLUMN "provenance" varchar(200);--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "is_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "kind" varchar(20) DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "channel" varchar(40);--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "sample_count" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "sample_channels" text[];--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "analysis_version" varchar(40);--> statement-breakpoint
ALTER TABLE "style_profiles" ADD COLUMN "channel_overlays" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE TABLE "style_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"analysis_id" integer NOT NULL,
	"style_profile_id" integer,
	"reference_id" integer,
	"category" varchar(60) NOT NULL,
	"observation_key" varchar(80) NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" varchar(20) NOT NULL,
	"evidence_reference_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"analysis_version" varchar(40) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "style_observations" ADD CONSTRAINT "style_observations_analysis_id_style_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."style_analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_observations" ADD CONSTRAINT "style_observations_style_profile_id_style_profiles_id_fk" FOREIGN KEY ("style_profile_id") REFERENCES "public"."style_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_observations" ADD CONSTRAINT "style_observations_reference_id_references_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "style_observations_analysis_idx" ON "style_observations" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "style_observations_profile_idx" ON "style_observations" USING btree ("style_profile_id");--> statement-breakpoint
CREATE INDEX "style_profiles_user_active_idx" ON "style_profiles" USING btree ("user_id", "is_active");
