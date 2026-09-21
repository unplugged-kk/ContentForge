CREATE TABLE "content_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(200) NOT NULL,
	"description" text,
	"supported_formats" text[] DEFAULT '{}'::text[],
	"supported_channels" text[] DEFAULT '{}'::text[],
	"structure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"instructions" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"policy_key" varchar(200) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" varchar(200),
	"format" varchar(50) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"voice_id" integer,
	"template_id" integer,
	"objective" text,
	"audience" text,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spec_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(200) NOT NULL,
	"description" text,
	"tone" varchar(200),
	"vocabulary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sentence_style" varchar(200),
	"formatting" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"do_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dont_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "policy_id" integer;--> statement-breakpoint
ALTER TABLE "generation_policies" ADD CONSTRAINT "generation_policies_voice_id_voices_id_fk" FOREIGN KEY ("voice_id") REFERENCES "public"."voices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_policies" ADD CONSTRAINT "generation_policies_template_id_content_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."content_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_templates_status_idx" ON "content_templates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_policies_key_version_uq" ON "generation_policies" USING btree ("policy_key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_policies_spec_hash_uq" ON "generation_policies" USING btree ("spec_hash");--> statement-breakpoint
CREATE INDEX "generation_policies_format_channel_idx" ON "generation_policies" USING btree ("format","channel");--> statement-breakpoint
CREATE INDEX "voices_status_idx" ON "voices" USING btree ("status");--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_policy_id_generation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."generation_policies"("id") ON DELETE no action ON UPDATE no action;