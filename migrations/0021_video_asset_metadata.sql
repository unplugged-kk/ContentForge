ALTER TABLE "visual_assets" ADD COLUMN IF NOT EXISTS "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD COLUMN IF NOT EXISTS "container" varchar(32);--> statement-breakpoint
ALTER TABLE "visual_assets" ADD COLUMN IF NOT EXISTS "codec" varchar(64);--> statement-breakpoint
ALTER TABLE "visual_assets" ADD COLUMN IF NOT EXISTS "frame_rate" integer;
