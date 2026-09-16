CREATE TABLE "automation_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"name" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"spec_hash" varchar(64) NOT NULL,
	"trigger_type" varchar(30) NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"research_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generation_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"approval_mode" varchar(30) DEFAULT 'approval_required' NOT NULL,
	"publication_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"policy_id" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"policy_spec_hash" varchar(64) NOT NULL,
	"policy_snapshot" jsonb NOT NULL,
	"trigger_type" varchar(30) NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"research_job_id" integer,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_class" varchar(30),
	"error_message" text,
	"advance_lease_expires_at" timestamp,
	"attempt" integer DEFAULT 0 NOT NULL,
	"correlation_id" varchar(100) NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "automation_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "automation_run_id" integer;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_policy_id_automation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."automation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_research_job_id_research_jobs_id_fk" FOREIGN KEY ("research_job_id") REFERENCES "public"."research_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_policies_user_idx" ON "automation_policies" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "automation_policies_status_idx" ON "automation_policies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_policies_trigger_idx" ON "automation_policies" USING btree ("trigger_type","status");--> statement-breakpoint
CREATE INDEX "automation_runs_policy_idx" ON "automation_runs" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "automation_runs_user_idx" ON "automation_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "automation_runs_research_idx" ON "automation_runs" USING btree ("research_job_id");--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_automation_run_id_automation_runs_id_fk" FOREIGN KEY ("automation_run_id") REFERENCES "public"."automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stories_automation_run_uq" ON "stories" USING btree ("automation_run_id");