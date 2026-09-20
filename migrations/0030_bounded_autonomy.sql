ALTER TABLE "policy_activations" ADD COLUMN "actor" varchar(30) NOT NULL DEFAULT 'human';--> statement-breakpoint
CREATE INDEX "policy_activations_actor_idx" ON "policy_activations" USING btree ("actor");--> statement-breakpoint
CREATE TABLE "autonomy_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"enabled" boolean NOT NULL DEFAULT false,
	"mode" varchar(30) NOT NULL DEFAULT 'disabled',
	"experiment_automation_enabled" boolean NOT NULL DEFAULT false,
	"activation_automation_enabled" boolean NOT NULL DEFAULT false,
	"rollback_enabled" boolean NOT NULL DEFAULT false,
	"minimum_evidence_quality" varchar(30) NOT NULL DEFAULT 'confirmed',
	"max_active_experiments" integer NOT NULL DEFAULT 1,
	"max_experiments_per_day" integer NOT NULL DEFAULT 1,
	"max_activations_per_day" integer NOT NULL DEFAULT 1,
	"max_activations_per_week" integer NOT NULL DEFAULT 2,
	"max_consecutive_activations" integer NOT NULL DEFAULT 2,
	"cooldown_minutes" integer NOT NULL DEFAULT 1440,
	"allowed_scopes" jsonb,
	"circuit_breaker_state" varchar(20) NOT NULL DEFAULT 'closed',
	"circuit_breaker_reason" text,
	"circuit_breaker_opened_at" timestamp,
	"paused_at" timestamp,
	"updated_by" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "autonomy_configs_user_uq" ON "autonomy_configs" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE "autonomy_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"decision_type" varchar(30) NOT NULL,
	"target_scope" varchar(100),
	"proposal_id" integer,
	"experiment_id" integer,
	"evaluation_id" integer,
	"candidate_id" integer,
	"previous_policy_id" integer,
	"new_policy_id" integer,
	"evidence_quality" varchar(30),
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" varchar(10) NOT NULL,
	"code" varchar(40) NOT NULL,
	"reason" text NOT NULL,
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "autonomy_decisions" ADD CONSTRAINT "autonomy_decisions_proposal_id_learning_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."learning_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_decisions" ADD CONSTRAINT "autonomy_decisions_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_decisions" ADD CONSTRAINT "autonomy_decisions_evaluation_id_experiment_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."experiment_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_decisions" ADD CONSTRAINT "autonomy_decisions_candidate_id_policy_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."policy_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_decisions" ADD CONSTRAINT "autonomy_decisions_previous_policy_id_generation_policies_id_fk" FOREIGN KEY ("previous_policy_id") REFERENCES "public"."generation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autonomy_decisions" ADD CONSTRAINT "autonomy_decisions_new_policy_id_generation_policies_id_fk" FOREIGN KEY ("new_policy_id") REFERENCES "public"."generation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autonomy_decisions_identity_uq" ON "autonomy_decisions" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "autonomy_decisions_user_idx" ON "autonomy_decisions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "autonomy_decisions_scope_idx" ON "autonomy_decisions" USING btree ("target_scope");--> statement-breakpoint
CREATE INDEX "autonomy_decisions_outcome_idx" ON "autonomy_decisions" USING btree ("outcome");
