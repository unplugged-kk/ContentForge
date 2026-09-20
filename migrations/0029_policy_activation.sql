CREATE TABLE "policy_activations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"action" varchar(20) NOT NULL,
	"policy_candidate_id" integer,
	"experiment_id" integer,
	"evaluation_id" integer,
	"activated_policy_id" integer NOT NULL,
	"previous_policy_id" integer,
	"policy_key" varchar(200) NOT NULL,
	"reason" text,
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "policy_activations" ADD CONSTRAINT "policy_activations_policy_candidate_id_policy_candidates_id_fk" FOREIGN KEY ("policy_candidate_id") REFERENCES "public"."policy_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_activations" ADD CONSTRAINT "policy_activations_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_activations" ADD CONSTRAINT "policy_activations_evaluation_id_experiment_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."experiment_evaluations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_activations" ADD CONSTRAINT "policy_activations_activated_policy_id_generation_policies_id_fk" FOREIGN KEY ("activated_policy_id") REFERENCES "public"."generation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_activations" ADD CONSTRAINT "policy_activations_previous_policy_id_generation_policies_id_fk" FOREIGN KEY ("previous_policy_id") REFERENCES "public"."generation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_activations_identity_uq" ON "policy_activations" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "policy_activations_user_idx" ON "policy_activations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "policy_activations_policy_key_idx" ON "policy_activations" USING btree ("policy_key");--> statement-breakpoint
CREATE INDEX "policy_activations_candidate_idx" ON "policy_activations" USING btree ("policy_candidate_id");--> statement-breakpoint
-- Backfill: prior to this phase every generation_policies row defaulted to
-- status='active' forever (no code path ever archived one). Before adding
-- the single-active-per-key invariant below, collapse each policyKey down to
-- its latest version as the sole active revision; older versions become
-- historical. This changes no policy content -- only the `status` label --
-- and every historical GenerationJob/Artifact keeps its original policy_id
-- reference untouched.
UPDATE "generation_policies" AS gp
SET "status" = 'archived'
WHERE gp."status" = 'active'
	AND gp."id" NOT IN (
		SELECT DISTINCT ON ("policy_key") "id"
		FROM "generation_policies"
		ORDER BY "policy_key", "version" DESC
	);--> statement-breakpoint
CREATE UNIQUE INDEX "generation_policies_one_active_per_key_uq" ON "generation_policies" USING btree ("policy_key") WHERE "generation_policies"."status" = 'active';
