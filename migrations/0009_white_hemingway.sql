ALTER TABLE "content_templates" ADD COLUMN "template_key" varchar(200);--> statement-breakpoint
ALTER TABLE "content_templates" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "voices" ADD COLUMN "voice_key" varchar(200);--> statement-breakpoint
ALTER TABLE "voices" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "content_templates_key_version_uq" ON "content_templates" USING btree ("template_key","version");--> statement-breakpoint
CREATE INDEX "schedule_occurrences_due_idx" ON "schedule_occurrences" USING btree ("status","occurrence_time");--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("status","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "voices_key_version_uq" ON "voices" USING btree ("voice_key","version");--> statement-breakpoint
UPDATE "voices" SET "voice_key" = 'voice:' || "id" WHERE "voice_key" IS NULL;--> statement-breakpoint
UPDATE "content_templates" SET "template_key" = 'tpl:' || "id" WHERE "template_key" IS NULL;