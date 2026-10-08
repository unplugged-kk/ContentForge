ALTER TABLE "users" ADD COLUMN "auth0_subject" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth0_subject_unique" UNIQUE("auth0_subject");
