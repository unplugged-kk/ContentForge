CREATE TABLE "artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"generation_job_id" integer,
	"opportunity_id" integer NOT NULL,
	"format" varchar(50) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"readiness" varchar(20) DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"supersedes_id" integer,
	"provenance" varchar(20) DEFAULT 'generated' NOT NULL,
	"attribution" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attribution_reason" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"opportunity_id" integer NOT NULL,
	"format" varchar(50) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" varchar(120),
	"provider" varchar(60),
	"cost" numeric(12, 6),
	"prior_artifact_id" integer,
	"rejection_reason" text,
	"correlation_id" varchar(100) NOT NULL,
	"error_class" varchar(30),
	"error_message" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "generation_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"story_id" integer NOT NULL,
	"concept" text NOT NULL,
	"objective" text NOT NULL,
	"audience" text,
	"angle" text,
	"format" varchar(50) NOT NULL,
	"channel" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"score" numeric(6, 3),
	"score_breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proposer" varchar(20) DEFAULT 'human' NOT NULL,
	"kill_reason" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"schedule_id" integer NOT NULL,
	"occurrence_id" integer NOT NULL,
	"artifact_id" integer NOT NULL,
	"channel" varchar(50) NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"state" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_owner" varchar(120),
	"lease_expires_at" timestamp,
	"provider_called" boolean DEFAULT false NOT NULL,
	"external_id" varchar(200),
	"last_error" text,
	"correlation_id" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "publications_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "results" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"publication_id" integer NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"external_id" varchar(200),
	"external_url" text,
	"published_at" timestamp,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" varchar(60),
	"error_class" varchar(30),
	"error_message" text,
	"correlation_id" varchar(100),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "results_publication_id_unique" UNIQUE("publication_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"schedule_id" integer NOT NULL,
	"occurrence_time" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"artifact_id" integer NOT NULL,
	"channel" varchar(50) NOT NULL,
	"recurrence" varchar(200),
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"start_at" timestamp NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_supersedes_id_artifacts_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_occurrence_id_schedule_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."schedule_occurrences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_occurrences" ADD CONSTRAINT "schedule_occurrences_schedule_id_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_opportunity_idx" ON "artifacts" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "artifacts_generation_job_idx" ON "artifacts" USING btree ("generation_job_id");--> statement-breakpoint
CREATE INDEX "artifacts_readiness_idx" ON "artifacts" USING btree ("readiness");--> statement-breakpoint
CREATE UNIQUE INDEX "artifacts_supersedes_uq" ON "artifacts" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_opportunity_idx" ON "generation_jobs" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "opportunities_story_idx" ON "opportunities" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "opportunities_status_idx" ON "opportunities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "publications_schedule_idx" ON "publications" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "publications_artifact_idx" ON "publications" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "publications_state_idx" ON "publications" USING btree ("state");--> statement-breakpoint
CREATE INDEX "results_outcome_idx" ON "results" USING btree ("outcome");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_occurrences_schedule_time_uq" ON "schedule_occurrences" USING btree ("schedule_id","occurrence_time");--> statement-breakpoint
CREATE INDEX "schedule_occurrences_status_idx" ON "schedule_occurrences" USING btree ("status");--> statement-breakpoint
CREATE INDEX "schedules_artifact_idx" ON "schedules" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "schedules_status_idx" ON "schedules" USING btree ("status");--> statement-breakpoint
CREATE OR REPLACE FUNCTION contentforge_prevent_artifact_content_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW.payload IS DISTINCT FROM OLD.payload
     OR NEW.format IS DISTINCT FROM OLD.format
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
     OR NEW.generation_job_id IS DISTINCT FROM OLD.generation_job_id
     OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
  THEN
    RAISE EXCEPTION 'Artifact % content is immutable; create a new revision (supersedes_id) instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER artifacts_no_content_mutation
BEFORE UPDATE ON "artifacts"
FOR EACH ROW EXECUTE FUNCTION contentforge_prevent_artifact_content_mutation();