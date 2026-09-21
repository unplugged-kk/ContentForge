CREATE TABLE "video_repurposing_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"source_visual_asset_id" integer NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"provider_id" varchar(80) NOT NULL,
	"provider_version" varchar(50),
	"provider_job_id" varchar(200),
	"clip_count" integer DEFAULT 3 NOT NULL,
	"request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_class" varchar(30),
	"error_message" text,
	"correlation_id" varchar(100) NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE TABLE "video_repurposing_outputs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"user_id" integer,
	"position" integer NOT NULL,
	"visual_asset_id" integer,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"start_ms" integer,
	"end_ms" integer,
	"duration_ms" integer,
	"title" varchar(200),
	"caption" text,
	"aspect_ratio" varchar(16),
	"provider_clip_id" varchar(200),
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "video_repurposing_jobs" ADD CONSTRAINT "video_repurposing_jobs_source_visual_asset_id_visual_assets_id_fk" FOREIGN KEY ("source_visual_asset_id") REFERENCES "public"."visual_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_repurposing_outputs" ADD CONSTRAINT "video_repurposing_outputs_job_id_video_repurposing_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_repurposing_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_repurposing_outputs" ADD CONSTRAINT "video_repurposing_outputs_visual_asset_id_visual_assets_id_fk" FOREIGN KEY ("visual_asset_id") REFERENCES "public"."visual_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_repurposing_jobs_idempotency_uq" ON "video_repurposing_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "video_repurposing_jobs_owner_idx" ON "video_repurposing_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "video_repurposing_jobs_source_idx" ON "video_repurposing_jobs" USING btree ("source_visual_asset_id");--> statement-breakpoint
CREATE INDEX "video_repurposing_jobs_status_idx" ON "video_repurposing_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "video_repurposing_outputs_job_position_uq" ON "video_repurposing_outputs" USING btree ("job_id","position");--> statement-breakpoint
CREATE INDEX "video_repurposing_outputs_job_idx" ON "video_repurposing_outputs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "video_repurposing_outputs_asset_idx" ON "video_repurposing_outputs" USING btree ("visual_asset_id");
