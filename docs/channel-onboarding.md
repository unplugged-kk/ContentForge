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
| `youtube` | video | Phase 28.1B — see below |

TikTok: not registered.

## YouTube (Phase 28.1 / 28.1B)

| Field | Value |
| --- | --- |
| channel | `youtube` |
| format | `video` only |
| API | YouTube Data API v3 resumable upload |
| scopes | `youtube.upload`, `youtube.readonly` |
| credentials | `connected_accounts` (canonical) after Google OAuth; optional env fallback |
| privacy default | `private` (`YOUTUBE_DEFAULT_PRIVACY`) |
| provider idempotency | **none** — ContentForge Publication identity is authoritative |
| reconcile | `videos.list` by id; listing miss ≠ absence for in-flight uploads |
| real publish gate | `CONTENTFORGE_REAL_PUBLISH_E2E=1` (optional cert mode + budget) |
| deferred | playlists, live, premieres, Shorts optimization, analytics, comments |

### Google OAuth setup (server-side web app)

Official guide: [server-side web apps](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps).

1. In Google Cloud Console, create (or reuse) an OAuth 2.0 **Web application** client.
2. Enable **YouTube Data API v3**.
3. Set env:
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (or `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`)
   - Optional explicit callback: `YOUTUBE_CALLBACK_URL`
4. Register this **exact** authorized redirect URI (must match env/derived value):

   `http://localhost:5000/api/social/youtube/callback`

   (or your production origin + `/api/social/youtube/callback`)

   If `YOUTUBE_CALLBACK_URL` is unset, ContentForge derives
   `{origin of GOOGLE_CALLBACK_URL}/api/social/youtube/callback`.

5. Requested scopes (only):
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`

6. Authorization uses `access_type=offline` and `prompt=consent` so Google can
   return a **refresh token**. ContentForge stores it encrypted on
   `connected_accounts.refresh_token` and **preserves** the existing refresh
   token when a later exchange omits one.

### Account connection flow

```
Settings → Connect YouTube
  → GET /api/social/youtube/connect  (CSRF state in session)
  → Google consent
  → GET /api/social/youtube/callback (validates state, exchanges code)
  → channels.list?mine=true
  → connected_accounts row (platform=youtube, channel id/title, scopes)
```

Status: `GET /api/social/youtube/status` reports (no secrets):

- `clientConfigured`
- `accountConnected`
- `refreshCredentialPresent`
- `requiredScopesPresent`
- `tokenRefreshPossible`
- `channelDiscovered` / `channelTitle`
- `publicationReady` / `ready` (true only when publish can succeed)

Never claim `ready` merely because `GOOGLE_CLIENT_ID` exists.

### Publication + reconciliation

1. Approve a `video` Artifact targeting `youtube` (payload may include
   `title`, `description`, `privacyStatus`, `certificationKey`).
2. Schedule / `publish_now` → Publication → YouTube adapter → resumable
   `videos.insert`.
3. On ambiguous outcomes, Publication stays reconciliable; `videos.list` by
   provider id resolves `published` without a second upload.

### Real certification (manual)

```bash
CONTENTFORGE_REAL_PUBLISH_E2E=1 CONTENTFORGE_PUBLISH_CERTIFICATION=1 \
  DATABASE_URL='postgresql://cfuser:cfpass@127.0.0.1:5433/cf_e2e_live' \
  npx tsx script/publish-certify-youtube.ts
```

- Certification key: `phase28.1-youtube-certification-v1`
- Exactly one real upload; re-runs reuse evidence / refuse via budget
- Prefer existing VideoAsset (e.g. Phase 27.3 fal asset `688`)
- Privacy: `private` (unverified API projects may force private until audit)
- No fal/ElevenLabs generation in this path

Without OAuth refresh credential:

`BLOCKED — YouTube OAuth refresh credential unavailable`

If Google returns `redirect_uri_mismatch`, register the exact
`YOUTUBE_CALLBACK_URL` (or derived URI) on the OAuth Web client in Google
Cloud Console before retrying Connect YouTube. Do not claim live certification
from unit doubles alone.
