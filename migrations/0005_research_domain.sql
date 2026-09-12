CREATE TABLE "research_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"source_id" integer,
	"kind" varchar(30) DEFAULT 'excerpt' NOT NULL,
	"origin" varchar(20) DEFAULT 'sourced' NOT NULL,
	"excerpt" text NOT NULL,
	"excerpt_hash" varchar(64) NOT NULL,
	"retrieved_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"correlation_id" varchar(100) NOT NULL,
	"idempotency_key" varchar(300) NOT NULL,
	"kind" varchar(20) DEFAULT 'directed' NOT NULL,
	"query" text,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"initiation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diagnostics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_ids" text[] DEFAULT '{}'::text[],
	"error_class" varchar(30),
	"error_message" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "research_jobs_correlation_id_unique" UNIQUE("correlation_id"),
	CONSTRAINT "research_jobs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"backend" varchar(50),
	"kind" varchar(50) NOT NULL,
	"native_id" varchar(500) NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text,
	"author" jsonb,
	"published_at" timestamp,
	"retrieved_at" timestamp NOT NULL,
	"retrieval_method" varchar(30),
	"access_class" varchar(30),
	"provider_version" varchar(50),
	"integration_version" varchar(50),
	"content_hash" varchar(64) NOT NULL,
	"excerpt" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" text[] DEFAULT '{}'::text[],
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "research_evidence_identity_uq" ON "research_evidence" USING btree ("job_id","source_id","excerpt_hash");--> statement-breakpoint
CREATE INDEX "research_jobs_status_idx" ON "research_jobs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "research_sources_job_url_uq" ON "research_sources" USING btree ("job_id","canonical_url");