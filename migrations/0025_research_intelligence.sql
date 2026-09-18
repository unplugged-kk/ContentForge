CREATE TABLE "research_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"user_id" integer,
	"analysis_version" varchar(40) DEFAULT 'research-analysis-v1' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "research_analyses" ADD CONSTRAINT "research_analyses_job_id_research_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."research_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_analyses_job_version_uq" ON "research_analyses" USING btree ("job_id","analysis_version");--> statement-breakpoint
CREATE INDEX "research_analyses_job_idx" ON "research_analyses" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "research_analyses_owner_idx" ON "research_analyses" USING btree ("user_id");
