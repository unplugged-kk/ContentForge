ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_platform" varchar(20) DEFAULT 'x';
--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_tone" varchar(20) DEFAULT 'educational';
--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_post_type" varchar(20) DEFAULT 'thread';
--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_pillar_id" integer;
--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN IF NOT EXISTS "messaging_pillars" text[] DEFAULT '{}'::text[];
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canned_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(50) DEFAULT 'general',
	"tags" text[] DEFAULT '{}'::text[],
	"usage_count" integer DEFAULT 0,
	"is_favorite" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "youtube_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_id" varchar(50) NOT NULL UNIQUE,
	"channel_name" varchar(200),
	"channel_url" text,
	"is_active" boolean DEFAULT true,
	"last_checked_at" timestamp,
	"last_video_id" varchar(30),
	"autopost_platform" varchar(20) DEFAULT 'x',
	"autopost_tone" varchar(20) DEFAULT 'educational',
	"autopost_post_type" varchar(20) DEFAULT 'thread',
	"autopost_pillar_id" integer,
	"require_approval" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
