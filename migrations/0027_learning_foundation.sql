CREATE TABLE "learning_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"dimension" varchar(40) NOT NULL,
	"observation_type" varchar(60) NOT NULL,
	"target_scope" varchar(100) NOT NULL,
	"candidate_population" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comparison_population" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metric_name" varchar(60) NOT NULL,
	"candidate_value" numeric(12, 4),
	"comparison_value" numeric(12, 4),
	"difference_percentage" numeric(8, 2),
	"evidence_quality" varchar(30) NOT NULL,
	"evidence_entity_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measurement_window" varchar(80),
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
CREATE TABLE "learning_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"observation_id" integer,
	"proposal_type" varchar(60) NOT NULL,
	"target_scope" varchar(100) NOT NULL,
	"title" varchar(255) NOT NULL,
	"rationale" text NOT NULL,
	"expected_impact_hypothesis" text NOT NULL,
	"evidence_quality" varchar(30) NOT NULL,
	"evidence_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'proposed' NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" integer,
	"review_notes" text,
	"identity_key" varchar(300) NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "learning_proposals" ADD CONSTRAINT "learning_proposals_observation_id_learning_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."learning_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learning_observations_identity_uq" ON "learning_observations" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "learning_observations_user_idx" ON "learning_observations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "learning_observations_dimension_idx" ON "learning_observations" USING btree ("dimension");--> statement-breakpoint
CREATE INDEX "learning_observations_type_idx" ON "learning_observations" USING btree ("observation_type");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_proposals_identity_uq" ON "learning_proposals" USING btree ("identity_key");--> statement-breakpoint
CREATE INDEX "learning_proposals_user_idx" ON "learning_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "learning_proposals_status_idx" ON "learning_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "learning_proposals_type_idx" ON "learning_proposals" USING btree ("proposal_type");
