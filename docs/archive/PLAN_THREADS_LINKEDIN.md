# ContentForge — Threads & LinkedIn Feature Plan

> **When to use this doc:** After X features are 100% complete (see `PLAN_X_FEATURES.md`).
> Everything in this file mirrors what was built for X — adapted for each platform's
> API, character limits, and content format. Work Threads first, then LinkedIn.
>
> **Principle:** X is the reference implementation. For each feature, find the X version,
> clone the pattern, swap the API client and limits.
>
> **Platform limits (reference):**
> | Platform | Single post | Thread/carousel |
> |----------|-------------|-----------------|
> | X        | 280 chars   | unlimited tweets in chain |
> | Threads  | 500 chars   | up to 10 posts in a thread |
> | LinkedIn | 3000 chars  | no native thread; documents/PDFs for carousels |

---

# PART A — THREADS

## A1 — Threads Publishing (Core)

### Current state
- `targetPlatform` field in `posts` table already has `"threads"` as a value
- `publishPostToX()` in `server/social/x.ts` throws early if platform is "threads"
- No Threads API client exists

### What to build

#### A1a. Threads API client — `server/social/threads.ts`

Threads uses Meta's Graph API. Auth flow:
1. User connects via Facebook Login (OAuth 2.0)
2. App receives a short-lived user access token
3. Exchange for long-lived token (60-day expiry)
4. Use `/{threads-user-id}/threads` and `/{threads-user-id}/threads_publish` endpoints

Required scopes: `threads_basic`, `threads_content_publish`

```typescript
// server/social/threads.ts

import type { Post, Tweet } from "@shared/schema";
import { storage } from "../storage";

export type ThreadsPublishResult = {
  postIds: string[];
  urls: string[];
  username: string | null;
};

async function getClient(): Promise<{ token: string; userId: string } | null> {
  const account = await storage.getConnectedAccount("threads");
  if (!account?.accessToken) return null;
  // threads userId stored in profileData.threadsUserId
  const userId = (account.profileData as any)?.threadsUserId;
  if (!userId) return null;
  return { token: account.accessToken, userId };
}

// Create a single Threads post (container)
async function createContainer(userId: string, token: string, text: string): Promise<string> {
  const url = `https://graph.threads.net/v1.0/${userId}/threads`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "TEXT", text, access_token: token }),
  });
  const data = await res.json() as any;
  if (!res.ok || !data.id) throw new Error(data.error?.message || "Failed to create Threads container");
  return data.id;
}

// Publish a container
async function publishContainer(userId: string, token: string, containerId: string): Promise<string> {
  const url = `https://graph.threads.net/v1.0/${userId}/threads_publish`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  const data = await res.json() as any;
  if (!res.ok || !data.id) throw new Error(data.error?.message || "Failed to publish to Threads");
  return data.id;
}

// For a thread (multiple posts), each reply is a separate container with reply_to_id
export async function postContentToThreads(texts: string[]): Promise<ThreadsPublishResult> {
  const client = await getClient();
  if (!client) throw new Error("Threads account not connected. Connect in Settings.");

  const { token, userId } = client;
  const trimmed = texts.map(t => t.trim()).filter(Boolean);
  if (!trimmed.length) throw new Error("No text to post.");

  const postIds: string[] = [];
  let lastPublishedId: string | undefined;

  for (const text of trimmed) {
    const safeText = text.slice(0, 500); // Threads 500 char limit
    
    // For replies in a thread, use reply_to_id
    const body: any = { media_type: "TEXT", text: safeText, access_token: token };
    if (lastPublishedId) body.reply_to_id = lastPublishedId;
    
    const containerId = await createContainer(userId, token, safeText);
    // Small delay between container creation and publish (Meta recommends this)
    await new Promise(r => setTimeout(r, 500));
    const publishedId = await publishContainer(userId, token, containerId);
    postIds.push(publishedId);
    lastPublishedId = publishedId;
  }

  const username = (await storage.getConnectedAccount("threads") as any)?.username || null;
  const urls = postIds.map(id => `https://www.threads.net/@${username || "me"}/post/${id}`);
  return { postIds, urls, username };
}

export async function tryPublishPostToThreads(postId: number): Promise<ThreadsPublishResult> {
  const post = await storage.getPost(postId);
  if (!post) throw new Error("Post not found");

  try {
    const result = await postContentToThreads(
      (post as any).tweets.sort((a: any, b: any) => a.position - b.position).map((t: any) => t.content)
    );
    await storage.updatePost(postId, {
      status: "posted",
      postedAt: new Date(),
      externalIds: { ...(post.externalIds ?? {}), threads: result.postIds },
      externalUrls: { ...(post.externalUrls ?? {}), threads: result.urls },
      errorMessage: null,
    });
    return result;
  } catch (e: any) {
    await storage.updatePost(postId, { status: "failed", errorMessage: e.message });
    throw e;
  }
}
```

#### A1b. Threads OAuth flow in `server/routes.ts`

Add routes:
```
GET  /api/auth/threads        → redirect to Meta OAuth
GET  /api/auth/threads/callback → exchange code for token, save to connected_accounts
```

Meta OAuth URL:
`https://threads.net/oauth/authorize?client_id={APP_ID}&redirect_uri={REDIRECT_URI}&scope=threads_basic,threads_content_publish&response_type=code`

Token exchange:
`POST https://graph.threads.net/oauth/access_token` with `grant_type=authorization_code`

Long-lived token exchange:
`GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret={SECRET}&access_token={SHORT_LIVED}`

Store in `connected_accounts`:
```json
{
  "platform": "threads",
  "username": "@handle",
  "accessToken": "long_lived_token",
  "tokenExpiresAt": "60 days from now",
  "profileData": { "threadsUserId": "123456789" }
}
```

Required env vars: `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_REDIRECT_URI`

#### A1c. Wire into publish flow in `server/routes.ts`

Find `POST /api/posts/:id/publish` (around line 199). Currently calls `tryPublishPostById`.
Update to handle platform routing:
```typescript
app.post("/api/posts/:id/publish", async (req, res) => {
  const post = await storage.getPost(id);
  const platform = post.targetPlatform;
  
  if (platform === "threads") {
    const result = await tryPublishPostToThreads(id);
    return res.json({ success: true, ...result });
  }
  if (platform === "x" || platform === "both") {
    const result = await tryPublishPostById(id, { invokedBy: "user" });
    // if "both", also post to threads after X succeeds
    if (platform === "both") {
      await tryPublishPostToThreads(id).catch(e => console.error("[threads publish]", e));
    }
    return res.json({ success: true, ...result });
  }
});
```

#### A1d. Threads connect button in Settings page
In `client/src/pages/settings.tsx`, the LinkedIn/Threads connect button already exists
in the UI. Wire the Threads connect button to `/api/auth/threads` OAuth flow
(same pattern as X OAuth connect button).

#### A1e. Autopilot support for Threads
In `server/autopilot.ts`, when generating posts, if `targetPlatform` is "threads" or "both",
tweets must be ≤500 chars (not 280). The `getTweetCountForType` function and content
generation prompts should be updated with a `platform` parameter:
- If threads: max 500 chars per post, max 10 posts in a thread
- Format tweets using `\n\n` paragraph style rather than punchy one-liners

---

## A2 — Threads-Specific Content Formatting

### What changes vs X
- 500 char limit vs 280
- Threads readers expect slightly longer, more conversational posts
- No hashtag SEO value on Threads (different algorithm)
- More personal/casual tone performs better on Threads

### What to build

#### A2a. Platform-aware system prompt
In `getBrandSystemPrompt()` (built in X Feature 2), add platform parameter:
```typescript
async function getBrandSystemPrompt(platform: "x" | "threads" | "linkedin" = "x"): Promise<string>
```

Append platform-specific instructions:
```typescript
const platformInstructions = {
  x: "Posts for X: max 280 chars per tweet, punchy, hook-driven, use 🧵 for threads.",
  threads: "Posts for Threads: max 500 chars per post, conversational but insightful, no hashtag spam, personal voice, paragraph format preferred over bullet points.",
  linkedin: "Posts for LinkedIn: professional but human, up to 3000 chars, use line breaks generously, start with a strong hook line, end with a question to drive comments.",
};
```

#### A2b. Generate page — platform selection
`client/src/pages/generate.tsx` already has a platform selector (x/threads/both).
Wire the char limit display to show 500 for Threads, 280 for X.
The `CHAR_LIMITS` constant in `client/src/lib/constants.ts` already has this —
just make sure it's used in the generate flow.

#### A2c. Threads post preview — `<ThreadsPostPreview>` component
Similar to `<XPostPreview>` (X Feature 3), but with Threads visual style:
- White/grey background card
- Threads font (similar to Instagram)
- No retweet — show "Reply" and "Repost" icons
- Thread connected with a vertical line between posts

---

## A3 — Threads Analytics

### What to build
Threads provides analytics via Graph API: impressions, likes, replies, reposts, quotes, views.

```
GET /{threads-media-id}/insights?metric=likes,replies,reposts,quotes,views,impressions
```

#### A3a. `syncPostAnalyticsFromThreads(postId)` in `server/social/threads.ts`
Mirror of `syncPostAnalyticsFromX()` in `server/social/x.ts`.
Fetch metrics from Threads Graph API for each post in the thread.
Aggregate and upsert into `analytics` table with `platform: "threads"`.

#### A3b. Wire into scheduler
Add to daily analytics refresh in `server/scheduler.ts`:
```typescript
await refreshThreadsAnalytics(30).catch(e => console.error("[threads analytics]", e));
```

#### A3c. Analytics page
`client/src/pages/analytics.tsx` already shows X analytics.
Add a platform tab/filter: "X" | "Threads" | "All".
Threads analytics use same table, filter by `platform: "threads"`.

---

## A4 — Threads-Specific Features

### A4a. Thread Finisher for Threads
Same as X Feature (already in `server/social/x.ts`).
In `server/social/threads.ts`, add equivalent `THREADS_THREAD_FINISHER` env var support.
Threads CTA format: "Follow @{handle} on Threads for daily DevOps & AI posts 🧵"

### A4b. Thread Numbering for Threads
Same bug as X (see X Known Bugs section in `PLAN_X_FEATURES.md`).
Apply the same fix to Threads thread generation.
Threads limit: 10 posts max per thread.

### A4c. RSS Autoposting → Threads
After Feature 4 (RSS Autoposting) is built for X, extend `rss_sources.autopost_platform`
to support "threads" and "both". The `generateAndSaveAutopostDraft` function becomes
platform-aware using the platform-specific system prompt.

---

# PART B — LINKEDIN

> LinkedIn is the most complex platform to add. Implement Threads fully first.

## B1 — LinkedIn Publishing (Core)

### The LinkedIn API landscape (2024-2026)
- LinkedIn uses OAuth 2.0 with OpenID Connect
- Publishing endpoint: `POST /v2/ugcPosts` (User Generated Content Posts)
- Required OAuth scope: `w_member_social`
- Access tokens expire in 60 days; refresh tokens valid for 1 year
- LinkedIn now uses the "Community Management API" for newer apps
- Post types: text, article (with URL), image, video, document (PDF = carousel)

### B1a. LinkedIn OAuth flow
```
GET /api/auth/linkedin → redirect to LinkedIn authorization
GET /api/auth/linkedin/callback → exchange code → store token
```

LinkedIn OAuth URL:
`https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id={ID}&redirect_uri={REDIRECT}&scope=openid,profile,w_member_social`

Token URL: `POST https://www.linkedin.com/oauth/v2/accessToken`

After auth, fetch user's LinkedIn URN:
`GET https://api.linkedin.com/v2/me` → returns `id` field → URN is `urn:li:person:{id}`

Store in `connected_accounts`:
```json
{
  "platform": "linkedin",
  "username": "linkedin-handle",
  "accessToken": "token",
  "tokenExpiresAt": "60 days out",
  "profileData": { "linkedinUrn": "urn:li:person:XXXXX", "linkedinId": "XXXXX" }
}
```

Required env vars: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI`

### B1b. LinkedIn API client — `server/social/linkedin.ts`
```typescript
// server/social/linkedin.ts

export type LinkedInPublishResult = {
  postId: string;
  url: string;
  username: string | null;
};

async function getClient(): Promise<{ token: string; urn: string } | null> {
  const account = await storage.getConnectedAccount("linkedin");
  if (!account?.accessToken) return null;
  const urn = (account.profileData as any)?.linkedinUrn;
  if (!urn) return null;
  return { token: account.accessToken, urn };
}

export async function postTextToLinkedIn(text: string): Promise<LinkedInPublishResult> {
  const client = await getClient();
  if (!client) throw new Error("LinkedIn not connected. Connect in Settings.");
  
  const { token, urn } = client;
  const body = {
    author: urn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text: text.slice(0, 3000) },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };
  
  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const err = await res.json() as any;
    throw new Error(err.message || "LinkedIn post failed");
  }
  
  const data = await res.json() as any;
  const postId = data.id;
  const username = (await storage.getConnectedAccount("linkedin") as any)?.username;
  return {
    postId,
    url: `https://www.linkedin.com/feed/update/${postId}/`,
    username: username || null,
  };
}

export async function tryPublishPostToLinkedIn(postId: number): Promise<LinkedInPublishResult> {
  const post = await storage.getPost(postId);
  if (!post) throw new Error("Post not found");
  
  // LinkedIn is a single long post — join all tweets with double newlines
  const tweets = (post as any).tweets
    .sort((a: any, b: any) => a.position - b.position)
    .map((t: any) => t.content);
  const fullText = tweets.join("\n\n");
  
  try {
    const result = await postTextToLinkedIn(fullText);
    await storage.updatePost(postId, {
      status: "posted",
      postedAt: new Date(),
      externalIds: { ...(post.externalIds ?? {}), linkedin: [result.postId] },
      externalUrls: { ...(post.externalUrls ?? {}), linkedin: [result.url] },
      errorMessage: null,
    });
    return result;
  } catch (e: any) {
    await storage.updatePost(postId, { status: "failed", errorMessage: e.message });
    throw e;
  }
}
```

**NOTE:** LinkedIn "threads" are NOT native like X or Threads. LinkedIn content is:
- Single long post (up to 3000 chars) — most common
- Article/newsletter post — separate API
- Document post (PDF carousel) — for carousels

When targeting LinkedIn, the `tweets` array becomes sections of a single long post.
The publish function joins them with `\n\n`.

### B1c. Wire into publish router (same pattern as Threads A1c)
Add LinkedIn case to `POST /api/posts/:id/publish`.

### B1d. Platform-aware content generation for LinkedIn
LinkedIn posts need different structure:
- First line is the hook (shows in feed before "...see more")
- 3000 char limit for the full post
- Line breaks are important — LinkedIn renders them
- Bullet points with • work well
- No hashtag stuffing (2-3 max, at end)
- Emojis used strategically, not every line

Update `getBrandSystemPrompt("linkedin")` with LinkedIn-specific instructions.

When `targetPlatform === "linkedin"`, the generate flow should produce:
- Fewer, longer "tweets" (sections)
- Or one single long post in the `tweets[0].content`
- Char limit display: 3000 per section, not 280

---

## B2 — LinkedIn-Specific Content Features

### B2a. LinkedIn-formatted content generation
Add `"linkedin"` as a platform option throughout:
- `client/src/pages/generate.tsx` — add LinkedIn to platform selector
- `client/src/lib/constants.ts` — `CHAR_LIMITS.linkedin = 3000`
- AI prompts — use `getBrandSystemPrompt("linkedin")`

### B2b. LinkedIn Post Preview — `<LinkedInPostPreview>` component
LinkedIn card visual style:
- White card, LinkedIn blue accents
- Profile photo, name, headline, connection degree (static: 1st)
- Post text with "...see more" truncation after 3 lines
- Reaction icons: Like (👍), Celebrate, Support, Love, Insightful, Funny
- Comment/Repost/Send buttons (decorative)

### B2c. LinkedIn Carousel (Document Post)
LinkedIn carousels are uploaded as PDFs.
The existing `carousels` table stores slide data.
To publish to LinkedIn:
1. Render carousel slides to canvas/PDF on server
2. Upload PDF via LinkedIn Assets API (`POST /v2/assets?action=registerUpload`)
3. Create document ugcPost referencing the asset ID

This requires a PDF generation library: `puppeteer` or `pdf-lib`.
**This is the most complex LinkedIn feature — implement last.**

### B2d. LinkedIn Article Publishing
LinkedIn articles use a different API endpoint.
The existing `articles` table in ContentForge can map to LinkedIn articles.
`POST /v2/articles` with article content.
Add "Publish to LinkedIn" button on the Articles page.

---

## B3 — LinkedIn Analytics

LinkedIn provides basic analytics via `GET /v2/organizationalEntityShareStatistics`
(for company pages) or `GET /v2/socialActions/{ugcPostUrn}` for personal stats.

Personal post analytics (likes, comments, shares, impressions) require
`r_1st_connections_size` scope — limited availability on Basic API tier.

**Practical approach:** Use LinkedIn's native analytics page for now.
Add a "View on LinkedIn" link from each posted post in ContentForge.
Full analytics sync requires LinkedIn Marketing Developer Program (higher tier).

---

## B4 — LinkedIn Features Checklist

- [ ] B1: LinkedIn OAuth connect flow
- [ ] B1: `server/social/linkedin.ts` — text post publishing
- [ ] B1: Wire into publish router
- [ ] B2a: LinkedIn platform option in generate page + system prompt
- [ ] B2b: `<LinkedInPostPreview>` component
- [ ] B2c: Carousel → PDF → LinkedIn document post (advanced, last)
- [ ] B2d: Article → LinkedIn article publishing (advanced)
- [ ] B3: Basic analytics (link to LinkedIn, sync when API allows)

---

# PART C — FUTURE PLATFORMS

## C1 — Instagram (Low Priority)
- Requires Instagram Graph API (via Facebook Business)
- Only supports image and video posts — not text-only
- ContentForge would need AI image generation to auto-create visuals
- Reels (video) out of scope
- **Trigger:** Add when AI image generation + carousel are production-solid

## C2 — Bluesky (Medium Priority)
- Open protocol (AT Protocol) — easiest API of any platform
- `@atproto/api` npm package makes this trivial
- No approval process needed
- 300 char limit (close to X's 280)
- Authentication: app password (no OAuth2 complexity)
- **Trigger:** Add after Threads is done; ~4 hours of work given X as reference

## C3 — Mastodon (Low Priority)
- ActivityPub standard, each instance is separate
- User needs to provide their instance URL + access token
- 500 char limit
- Similar API pattern to Threads

---

# Migration Guide: X → New Platform

When adding any new platform, follow this checklist:

1. **Backend auth:** OAuth flow → save to `connected_accounts` with `platform: "newplatform"`
2. **API client:** `server/social/newplatform.ts` — `postContent()`, `tryPublishPost()`, analytics sync
3. **Publish router:** Add platform case in `POST /api/posts/:id/publish`
4. **Content generation:** Add platform case in `getBrandSystemPrompt(platform)`
5. **Char limit:** Add to `CHAR_LIMITS` in `client/src/lib/constants.ts`
6. **Platform selector:** Add to generate page + queue + calendar platform filters
7. **Preview component:** `<NewPlatformPostPreview>` with platform's visual style
8. **Settings:** Connect/disconnect button in settings page
9. **Autopilot:** Update autopilot to handle new platform's scheduling
10. **Analytics:** Add `syncPostAnalyticsFrom{Platform}()` and wire to scheduler
11. **RSS Autoposting:** Extend `autopost_platform` enum to include new platform

---

# Environment Variables Needed Per Platform

```bash
# Threads
THREADS_APP_ID=
THREADS_APP_SECRET=
THREADS_REDIRECT_URI=http://localhost:5000/api/auth/threads/callback
THREADS_THREAD_FINISHER="Follow me on Threads for daily DevOps & AI posts 🧵"

# LinkedIn
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=http://localhost:5000/api/auth/linkedin/callback

# Bluesky (when added)
# No global env vars — user provides instance + app password in Settings

# Instagram (when added)
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=http://localhost:5000/api/auth/instagram/callback
```
