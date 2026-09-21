CREATE TABLE "performance_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"publication_id" integer NOT NULL,
	"result_id" integer,
	"artifact_id" integer,
	"channel" varchar(50) NOT NULL,
	"provider" varchar(60) NOT NULL,
	"external_id" varchar(200),
	"metric" varchar(60) NOT NULL,
	"value" numeric(18, 6),
	"availability" varchar(20) NOT NULL,
	"observed_at" timestamp NOT NULL,
	"retrieved_at" timestamp NOT NULL,
	"measurement_window" varchar(80),
	"normalization_version" varchar(40) NOT NULL,
	"source_revision" varchar(80),
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"signal_type" varchar(40) NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_id" integer NOT NULL,
	"artifact_id" integer,
	"prior_artifact_id" integer,
	"publication_id" integer,
	"result_id" integer,
	"performance_signal_id" integer,
	"generation_job_id" integer,
	"generation_policy_id" integer,
	"opportunity_id" integer,
	"story_id" integer,
	"automation_run_id" integer,
	"channel" varchar(50),
	"format" varchar(50),
	"observed_at" timestamp NOT NULL,
	"schema_version" varchar(40) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" varchar(40),
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_signals" ADD CONSTRAINT "performance_signals_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_signals" ADD CONSTRAINT "performance_signals_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_signals" ADD CONSTRAINT "performance_signals_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_prior_artifact_id_artifacts_id_fk" FOREIGN KEY ("prior_artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_result_id_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_performance_signal_id_performance_signals_id_fk" FOREIGN KEY ("performance_signal_id") REFERENCES "public"."performance_signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_generation_policy_id_generation_policies_id_fk" FOREIGN KEY ("generation_policy_id") REFERENCES "public"."generation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_signals" ADD CONSTRAINT "learning_signals_automation_run_id_automation_runs_id_fk" FOREIGN KEY ("automation_run_id") REFERENCES "public"."automation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "performance_signals_identity_uq" ON "performance_signals" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "performance_signals_user_idx" ON "performance_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "performance_signals_publication_idx" ON "performance_signals" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "performance_signals_observed_idx" ON "performance_signals" USING btree ("publication_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_signals_identity_uq" ON "learning_signals" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "learning_signals_user_idx" ON "learning_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "learning_signals_type_idx" ON "learning_signals" USING btree ("signal_type");--> statement-breakpoint
CREATE INDEX "learning_signals_artifact_idx" ON "learning_signals" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "learning_signals_publication_idx" ON "learning_signals" USING btree ("publication_id");--> statement-breakpoint
CREATE INDEX "learning_signals_story_idx" ON "learning_signals" USING btree ("story_id");
