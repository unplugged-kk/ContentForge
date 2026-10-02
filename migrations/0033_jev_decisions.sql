CREATE TABLE "jev_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"decision_id" varchar(60) NOT NULL,
	"user_id" integer,
	"decision_type" varchar(60) NOT NULL,
	"policy_id" varchar(80) NOT NULL,
	"policy_version" varchar(40) NOT NULL,
	"input_state_hash" varchar(64) NOT NULL,
	"decision" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" numeric(5, 4),
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fallback" boolean DEFAULT false NOT NULL,
	"latency_ms" integer,
	"model" varchar(80),
	"transport" varchar(20),
	"refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"predicted" jsonb,
	"actual" jsonb,
	"actual_at" timestamp,
	"correlation_id" varchar(80),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "jev_decisions_decision_id_uq" UNIQUE("decision_id")
);--> statement-breakpoint
CREATE INDEX "jev_decisions_type_created_idx" ON "jev_decisions" USING btree ("decision_type","created_at");--> statement-breakpoint
CREATE INDEX "jev_decisions_state_hash_idx" ON "jev_decisions" USING btree ("input_state_hash");--> statement-breakpoint
CREATE INDEX "jev_decisions_user_idx" ON "jev_decisions" USING btree ("user_id");
