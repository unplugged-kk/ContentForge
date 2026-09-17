ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "intent_key" varchar(300);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schedules_intent_key_uq" ON "schedules" USING btree ("intent_key");
