CREATE TABLE IF NOT EXISTS "ai_usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"model" varchar(100) NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"latency_ms" integer,
	"feature" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analytics" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer,
	"platform" varchar(20),
	"impressions" integer DEFAULT 0,
	"likes" integer DEFAULT 0,
	"retweets" integer DEFAULT 0,
	"replies" integer DEFAULT 0,
	"quotes" integer DEFAULT 0,
	"bookmarks" integer DEFAULT 0,
	"views" integer DEFAULT 0,
	"source" varchar(20) DEFAULT 'manual',
	"recorded_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer,
	"title" varchar(200) NOT NULL,
	"subtitle" varchar(300),
	"cover_image_url" text,
	"content_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_html" text,
	"content_markdown" text,
	"word_count" integer DEFAULT 0,
	"estimated_read_minutes" integer DEFAULT 0,
	"seo_description" varchar(200),
	"article_template" varchar(50),
	"status" varchar(20) DEFAULT 'draft',
	"pillar_id" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "carousels" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(300) NOT NULL,
	"pillar_id" integer,
	"slides" jsonb DEFAULT '[]'::jsonb,
	"status" varchar(50) DEFAULT 'draft',
	"platform" varchar(30) DEFAULT 'linkedin',
	"background_style" varchar(50) DEFAULT 'gradient-blue',
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connected_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(30) NOT NULL,
	"username" varchar(200),
	"display_name" varchar(300),
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"is_active" boolean DEFAULT true,
	"profile_data" jsonb,
	"connected_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "context_vault" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(300) NOT NULL,
	"content" text NOT NULL,
	"category" varchar(100),
	"tags" text[] DEFAULT '{}'::text[],
	"source_url" text,
	"source_type" varchar(50),
	"is_favorite" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovered_ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"rank" integer,
	"title" varchar(500) NOT NULL,
	"description" text,
	"summary" text,
	"source_inspiration" text,
	"source_url" text,
	"source_type" varchar(30) DEFAULT 'rss',
	"category" varchar(30),
	"content_type_suggestion" varchar(30),
	"content_angles" text[],
	"pillar_id" integer,
	"viral_score" numeric(3, 1),
	"viral_reasoning" text,
	"value_proposition" text,
	"unique_angle" text,
	"timeliness" varchar(30),
	"target_audience" text,
	"suggested_hook" text,
	"hashtag_suggestions" text[],
	"is_bookmarked" boolean DEFAULT false,
	"status" varchar(20) DEFAULT 'new',
	"batch_id" varchar(50),
	"discovered_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "discovery_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"auto_refresh_frequency" varchar(20) DEFAULT 'daily',
	"custom_keywords" text[] DEFAULT '{}'::text[],
	"monitored_x_accounts" text[] DEFAULT '{}'::text[],
	"enabled_sources" jsonb DEFAULT '{"hackernews":true,"reddit":true,"rss":true,"github":true}'::jsonb,
	"min_viral_score" numeric(3, 1) DEFAULT '5.0',
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "generated_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"revised_prompt" text,
	"image_url" text NOT NULL,
	"style" varchar(50),
	"aspect_ratio" varchar(20),
	"pillar_id" integer,
	"post_id" integer,
	"is_favorite" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(280) NOT NULL,
	"notes" text,
	"pillar_id" integer,
	"is_expanded" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "monitored_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(20) NOT NULL,
	"username" varchar(100) NOT NULL,
	"display_name" varchar(200),
	"category" varchar(50),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pillars" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"color" varchar(7)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"pillar_id" integer,
	"post_type" varchar(20) NOT NULL,
	"tone" varchar(20),
	"target_platform" varchar(20) DEFAULT 'both',
	"status" varchar(20) DEFAULT 'draft',
	"scheduled_at" timestamp,
	"posted_at" timestamp,
	"ai_model" varchar(100),
	"external_ids" jsonb,
	"external_urls" jsonb,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"last_retry_at" timestamp,
	"autopilot" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_content" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" integer,
	"post_id" integer,
	"article_id" integer,
	"creation_action" varchar(50),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_id" integer,
	"post_id" integer,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "references" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_url" text,
	"source_type" varchar(30),
	"source_platform" varchar(30),
	"source_author_username" varchar(200),
	"source_author_display_name" varchar(300),
	"source_author_follower_count" integer,
	"raw_content" text,
	"raw_content_html" text,
	"screenshot_urls" text[],
	"analysis_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style_analysis_json" jsonb,
	"title" varchar(500),
	"author" varchar(200),
	"source_engagement_metrics" jsonb,
	"word_count" integer,
	"tags" text[],
	"pillar_id" integer,
	"is_bookmarked" boolean DEFAULT false,
	"is_style_saved" boolean DEFAULT false,
	"notes" text,
	"batch_id" varchar(50),
	"batch_synthesis_json" jsonb,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rss_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"feed_url" text NOT NULL,
	"category" varchar(50),
	"is_active" boolean DEFAULT true,
	"last_fetched_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "style_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"source_reference_id" integer,
	"style_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"style_prompt_snippet" text NOT NULL,
	"usage_count" integer DEFAULT 0,
	"is_favorite" boolean DEFAULT false,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"pattern" text NOT NULL,
	"post_type" varchar(20),
	"pillar_id" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tweets" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"position" integer NOT NULL,
	"content" text NOT NULL,
	"char_count" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"brand_voice" text,
	"writing_style_notes" text,
	"audience_description" text,
	"content_goals" text,
	"niche" varchar(200),
	"target_platforms" text[] DEFAULT '{}'::text[],
	"posting_frequency" varchar(50),
	"memory_json" jsonb DEFAULT '{}'::jsonb,
	"branding_json" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255),
	"password_hash" text,
	"google_id" varchar(255),
	"name" varchar(200),
	"avatar" text,
	"bio" text,
	"title" varchar(200),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "viral_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer,
	"article_id" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"overall_score" numeric(3, 1),
	"dimension_scores" jsonb,
	"improvements" jsonb,
	"predicted_engagement" jsonb,
	"scored_by_model" varchar(100),
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
