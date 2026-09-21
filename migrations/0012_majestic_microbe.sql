CREATE TABLE "visual_asset_refs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"artifact_id" integer NOT NULL,
	"visual_asset_id" integer NOT NULL,
	"role" varchar(60),
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visual_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"visual_generation_id" integer,
	"kind" varchar(30) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"mime" varchar(60) NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer,
	"content_hash" varchar(64),
	"alt_text" text,
	"caption" text,
	"role" varchar(60),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"supersedes_id" integer,
	"provenance" varchar(20) DEFAULT 'generated' NOT NULL,
	"status" varchar(20) DEFAULT 'ready' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visual_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"intent" jsonb NOT NULL,
	"kind" varchar(30) NOT NULL,
	"provider_id" varchar(80),
	"capability" varchar(40),
	"provider_version" varchar(50),
	"request_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"model" varchar(120),
	"cost" numeric(12, 6),
	"error_class" varchar(30),
	"error_message" text,
	"generation_job_id" integer,
	"opportunity_id" integer,
	"correlation_id" varchar(100) NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "visual_generations_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "visual_asset_refs" ADD CONSTRAINT "visual_asset_refs_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_asset_refs" ADD CONSTRAINT "visual_asset_refs_visual_asset_id_visual_assets_id_fk" FOREIGN KEY ("visual_asset_id") REFERENCES "public"."visual_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_visual_generation_id_visual_generations_id_fk" FOREIGN KEY ("visual_generation_id") REFERENCES "public"."visual_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_assets" ADD CONSTRAINT "visual_assets_supersedes_id_visual_assets_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."visual_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_generations" ADD CONSTRAINT "visual_generations_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visual_generations" ADD CONSTRAINT "visual_generations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visual_asset_refs_artifact_idx" ON "visual_asset_refs" USING btree ("artifact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visual_asset_refs_artifact_asset_uq" ON "visual_asset_refs" USING btree ("artifact_id","visual_asset_id");--> statement-breakpoint
CREATE INDEX "visual_assets_generation_idx" ON "visual_assets" USING btree ("visual_generation_id");--> statement-breakpoint
CREATE INDEX "visual_assets_status_idx" ON "visual_assets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "visual_assets_supersedes_uq" ON "visual_assets" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "visual_generations_status_idx" ON "visual_generations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "visual_generations_opportunity_idx" ON "visual_generations" USING btree ("opportunity_id");
--> statement-breakpoint
-- Asset content immutability: once a visual asset revision exists it may change
-- lifecycle state only (status), never identity or bytes. New content == new row
-- linked by supersedes_id. Mirrors the artifacts trigger (0007).
CREATE OR REPLACE FUNCTION contentforge_prevent_visual_asset_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.mime IS DISTINCT FROM OLD.mime
     OR NEW.width IS DISTINCT FROM OLD.width
     OR NEW.height IS DISTINCT FROM OLD.height
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.visual_generation_id IS DISTINCT FROM OLD.visual_generation_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
  THEN
    RAISE EXCEPTION 'Visual asset % is immutable; create a new revision (supersedes_id) instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER visual_assets_no_mutation
BEFORE UPDATE ON "visual_assets"
FOR EACH ROW EXECUTE FUNCTION contentforge_prevent_visual_asset_mutation();