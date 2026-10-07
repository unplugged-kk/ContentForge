CREATE TABLE "ai_providers" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(80) DEFAULT 'openai-compatible' NOT NULL,
	"base_url" text NOT NULL,
	"secret_ciphertext" text,
	"organization" varchar(120),
	"project" varchar(120),
	"extra_headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"transport" varchar(40) DEFAULT 'auto' NOT NULL,
	"detected_transport" varchar(40),
	"default_model" varchar(200) NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_health_at" timestamp,
	"last_health_ok" boolean,
	"last_health_error" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_providers_user_idx" ON "ai_providers" USING btree ("user_id");
--> statement-breakpoint
CREATE TABLE "ai_model_routes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"purpose" varchar(80) NOT NULL,
	"provider_id" integer NOT NULL,
	"model" varchar(200),
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"allow_fallback" boolean DEFAULT false NOT NULL,
	"fallback_provider_id" integer,
	"fallback_model" varchar(200),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_model_routes" ADD CONSTRAINT "ai_model_routes_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ai_model_routes_user_idx" ON "ai_model_routes" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "ai_model_routes_purpose_idx" ON "ai_model_routes" USING btree ("user_id","purpose");
