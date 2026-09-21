ALTER TABLE "visual_generations" ADD COLUMN IF NOT EXISTS "variation_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "visual_generations" ADD COLUMN IF NOT EXISTS "source_visual_asset_id" integer;--> statement-breakpoint
ALTER TABLE "visual_generations" ADD COLUMN IF NOT EXISTS "spec_id" varchar(60);--> statement-breakpoint
ALTER TABLE "visual_assets" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "visual_generations" ADD CONSTRAINT "visual_generations_source_visual_asset_id_visual_assets_id_fk" FOREIGN KEY ("source_visual_asset_id") REFERENCES "public"."visual_assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visual_assets_generation_position_uq" ON "visual_assets" USING btree ("visual_generation_id","position") WHERE "supersedes_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visual_asset_refs_artifact_position_uq" ON "visual_asset_refs" USING btree ("artifact_id","position");
