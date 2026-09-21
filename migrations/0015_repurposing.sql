ALTER TABLE "opportunities" ADD COLUMN "repurpose_key" varchar(200);--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_repurpose_key_uq" ON "opportunities" USING btree ("repurpose_key");