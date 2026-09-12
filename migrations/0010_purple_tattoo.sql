ALTER TABLE "opportunities" ADD COLUMN "chat_key" varchar(200);--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_chat_key_uq" ON "opportunities" USING btree ("chat_key");