CREATE TABLE "video_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"video_id" varchar(40) NOT NULL,
	"url" text NOT NULL,
	"lang" varchar(20),
	"transcript_source" varchar(20) DEFAULT 'subs' NOT NULL,
	"transcript_hash" varchar(64) NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"cue_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "video_sources_transcript_hash_unique" UNIQUE("transcript_hash")
);--> statement-breakpoint
CREATE INDEX "video_sources_video_idx" ON "video_sources" USING btree ("video_id");--> statement-breakpoint
CREATE TABLE "video_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"idx" integer NOT NULL,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"end_ms" integer DEFAULT 0 NOT NULL,
	"text" text NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"hash" varchar(64) NOT NULL
);--> statement-breakpoint
ALTER TABLE "video_chunks" ADD CONSTRAINT "video_chunks_source_id_video_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."video_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_chunks_source_idx_uq" ON "video_chunks" USING btree ("source_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX "video_chunks_source_hash_uq" ON "video_chunks" USING btree ("source_id","hash");--> statement-breakpoint
CREATE TABLE "video_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"chunk_id" integer,
	"claim" text NOT NULL,
	"confidence" numeric(5, 4),
	"extraction_model" varchar(80),
	"source_url" text,
	"timestamp_ms" integer,
	"verification" varchar(20) DEFAULT 'unverified' NOT NULL,
	"conflicting" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk" varchar(20),
	"extracted_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "video_claims" ADD CONSTRAINT "video_claims_source_id_video_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."video_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_claims" ADD CONSTRAINT "video_claims_chunk_id_video_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."video_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_claims_source_idx" ON "video_claims" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "video_claims_chunk_idx" ON "video_claims" USING btree ("chunk_id");
