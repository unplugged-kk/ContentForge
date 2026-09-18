# Channel onboarding (distribution)

ContentForge publishes through one boundary:

`Artifact → Publication → ChannelAdapter → provider API → Result`

Adding a channel is an adapter registration. It must not change Story,
Opportunity, GenerationJob, Artifact approval, Schedule, or Occurrence.

## Required change set

1. Add transport under `server/social/<channel>.ts`.
2. Add `create<Channel>ChannelAdapter()` in `server/content/adapters.ts`.
3. Register it in `registerBuiltinChannelAdapters()`.
4. Declare `supports(format)` honestly.
5. Store credentials via `connected_accounts` and/or server-only env vars.
6. Add `/api/social/<channel>/status` summary (no secrets).
7. Unit-test against a local HTTP double of the provider boundary.
8. Live-certify only with `CONTENTFORGE_REAL_PUBLISH_E2E=1` and a one-shot budget.

## Registered channels

| Channel | Formats | Live certified? |
| --- | --- | --- |
| `x` | text / thread / single image | prior phases |
| `linkedin` | text | prior phases |
| `threads` | text | adapter IMPLEMENTED; live often BLOCKED on credentials |
| `instagram` | image / carousel / video (Reels) | prior phases |
| `youtube` | video | Phase 28.1 adapter IMPLEMENTED; live BLOCKED until upload OAuth |

TikTok: not registered.

## YouTube (Phase 28.1)

| Field | Value |
| --- | --- |
| channel | `youtube` |
| format | `video` only |
| API | YouTube Data API v3 resumable upload |
| scopes | `youtube.upload`, `youtube.readonly` |
| env | `YOUTUBE_REFRESH_TOKEN` + `YOUTUBE_CLIENT_ID`/`SECRET` (or `GOOGLE_CLIENT_*`) and/or connected account `platform=youtube` |
| privacy default | `private` (`YOUTUBE_DEFAULT_PRIVACY`) |
| provider idempotency | **none** — ContentForge Publication identity is authoritative |
| reconcile | `videos.list` by id; listing miss ≠ absence for in-flight uploads |
| real publish gate | `CONTENTFORGE_REAL_PUBLISH_E2E=1` (optional cert mode + budget) |
| deferred | playlists, live, premieres, Shorts optimization, analytics, comments |

### Live certification

1. Complete Google OAuth with offline access and YouTube upload scopes; store refresh token.
2. Reuse an **existing** ContentForge VideoAsset (do not call fal/ElevenLabs).
3. Approve a video Artifact; publish with `privacyStatus=private` or `unlisted`.
4. Exactly one intentional real upload under certification budget.
5. Confirm `externalId` (video id) and reconcile path.

Without a refresh/access token that has upload scope:

`BLOCKED — credential unavailable`

Do not claim live certification from unit doubles alone.
