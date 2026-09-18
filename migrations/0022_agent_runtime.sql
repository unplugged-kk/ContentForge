CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"backend_id" varchar(80) NOT NULL,
	"provider_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"objective" text NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"correlation_id" varchar(100) NOT NULL,
	"error_class" varchar(30),
	"error_message" text,
	"cancellation_requested" boolean DEFAULT false NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_tool_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_run_id" integer NOT NULL,
	"tool_name" varchar(80) NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'requested' NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resource_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_class" varchar(30),
	"error_message" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_idempotency_key_unique" ON "agent_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_runs_user_idx" ON "agent_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tool_calls_idempotency_uq" ON "agent_tool_calls" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_run_idx" ON "agent_tool_calls" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "agent_tool_calls_user_idx" ON "agent_tool_calls" USING btree ("user_id");
