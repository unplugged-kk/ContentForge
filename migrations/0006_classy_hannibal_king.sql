CREATE TABLE "stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"research_job_id" integer,
	"provenance" varchar(20) DEFAULT 'researched' NOT NULL,
	"title" varchar(500) NOT NULL,
	"insight_body" text NOT NULL,
	"interpretation_marked" boolean DEFAULT true NOT NULL,
	"angles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_research_job_id_research_jobs_id_fk" FOREIGN KEY ("research_job_id") REFERENCES "public"."research_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stories_research_job_idx" ON "stories" USING btree ("research_job_id");--> statement-breakpoint
CREATE INDEX "stories_status_idx" ON "stories" USING btree ("status");