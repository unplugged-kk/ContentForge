CREATE TABLE "repurposing_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"story_id" integer NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"status" varchar(30) DEFAULT 'planning' NOT NULL,
	"request_key" varchar(200) NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_class" varchar(30),
	"error_message" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);--> statement-breakpoint
ALTER TABLE "repurposing_plans" ADD CONSTRAINT "repurposing_plans_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repurposing_plans_story_request_uq" ON "repurposing_plans" USING btree ("story_id","request_key");--> statement-breakpoint
CREATE INDEX "repurposing_plans_owner_idx" ON "repurposing_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repurposing_plans_story_idx" ON "repurposing_plans" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "repurposing_plans_status_idx" ON "repurposing_plans" USING btree ("status");
