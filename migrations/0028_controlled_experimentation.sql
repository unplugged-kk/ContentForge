CREATE TABLE "experiments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"source_proposal_id" integer,
	"name" varchar(255) NOT NULL,
	"hypothesis" text NOT NULL,
	"objective" text NOT NULL,
	"target_scope" varchar(100) NOT NULL,
	"experiment_type" varchar(50) NOT NULL,
	"primary_metric" varchar(60) NOT NULL,
	"guardrail_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eligibility_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allocation_method" varchar(50) DEFAULT 'deterministic_hash' NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"decision" varchar(30) DEFAULT 'pending' NOT NULL,
	"decision_notes" text,
	"decided_at" timestamp,
	"decided_by" integer,
	"min_sample_size" integer DEFAULT 3 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE TABLE "experiment_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"experiment_id" integer NOT NULL,
	"variant_key" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"is_control" boolean DEFAULT false NOT NULL,
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generation_policy_id" integer,
	"traffic_weight" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE TABLE "experiment_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"experiment_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"opportunity_id" integer NOT NULL,
	"artifact_id" integer,
	"publication_id" integer,
	"assigned_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"idempotency_key" varchar(300) NOT NULL
);--> statement-breakpoint
CREATE TABLE "experiment_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"experiment_id" integer NOT NULL,
	"evaluation_window" varchar(50) DEFAULT 'interim' NOT NULL,
	"primary_metric" varchar(60) NOT NULL,
	"control_metrics" jsonb DEFAULT '{"sampleCount":0,"measuredCount":0,"mean":null,"availability":"insufficient_data"}'::jsonb NOT NULL,
	"variant_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guardrail_results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_quality" varchar(30) NOT NULL,
	"recommended_decision" varchar(30) NOT NULL,
	"summary" text NOT NULL,
	"evaluated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"identity_key" varchar(300) NOT NULL
);--> statement-breakpoint
CREATE TABLE "policy_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"experiment_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"evaluation_id" integer,
	"title" varchar(255) NOT NULL,
	"rationale" text NOT NULL,
	"target_scope" varchar(100) NOT NULL,
	"proposed_configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'candidate' NOT NULL,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_source_proposal_id_learning_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."learning_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_variants" ADD CONSTRAINT "experiment_variants_generation_policy_id_generation_policies_id_fk" FOREIGN KEY ("generation_policy_id") REFERENCES "public"."generation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_variant_id_experiment_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."experiment_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_assignments" ADD CONSTRAINT "experiment_assignments_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_evaluations" ADD CONSTRAINT "experiment_evaluations_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_candidates" ADD CONSTRAINT "policy_candidates_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_candidates" ADD CONSTRAINT "policy_candidates_variant_id_experiment_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."experiment_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_candidates" ADD CONSTRAINT "policy_candidates_evaluation_id_experiment_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."experiment_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_identity_uq" ON "experiments" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "experiments_user_idx" ON "experiments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiments_status_idx" ON "experiments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "experiments_type_idx" ON "experiments" USING btree ("experiment_type");--> statement-breakpoint
CREATE INDEX "experiments_proposal_idx" ON "experiments" USING btree ("source_proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_variants_exp_key_uq" ON "experiment_variants" USING btree ("experiment_id","variant_key");--> statement-breakpoint
CREATE INDEX "experiment_variants_user_idx" ON "experiment_variants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiment_variants_exp_idx" ON "experiment_variants" USING btree ("experiment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_idempotency_uq" ON "experiment_assignments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_assignments_opp_uq" ON "experiment_assignments" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_exp_idx" ON "experiment_assignments" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_variant_idx" ON "experiment_assignments" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_user_idx" ON "experiment_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_artifact_idx" ON "experiment_assignments" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "experiment_assignments_pub_idx" ON "experiment_assignments" USING btree ("publication_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_evaluations_identity_uq" ON "experiment_evaluations" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "experiment_evaluations_exp_idx" ON "experiment_evaluations" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "experiment_evaluations_user_idx" ON "experiment_evaluations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_candidates_identity_uq" ON "policy_candidates" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "policy_candidates_user_idx" ON "policy_candidates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "policy_candidates_exp_idx" ON "policy_candidates" USING btree ("experiment_id");--> statement-breakpoint
CREATE INDEX "policy_candidates_status_idx" ON "policy_candidates" USING btree ("status");
