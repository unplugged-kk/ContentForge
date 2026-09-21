CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"method" varchar(10) NOT NULL,
	"path" varchar(512) NOT NULL,
	"action" varchar(50) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar(100),
	"ip" varchar(64),
	"user_agent" text,
	"body_hash" varchar(64),
	"status_code" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
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
	"channel_id" varchar(50) NOT NULL,
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
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "youtube_channels_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_platform" varchar(20) DEFAULT 'x';--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_tone" varchar(20) DEFAULT 'educational';--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_post_type" varchar(20) DEFAULT 'thread';--> statement-breakpoint
ALTER TABLE "rss_sources" ADD COLUMN IF NOT EXISTS "autopost_pillar_id" integer;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN IF NOT EXISTS "messaging_pillars" text[] DEFAULT '{}'::text[];