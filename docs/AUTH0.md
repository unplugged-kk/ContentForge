# Authentication with Auth0

Status: CURRENT. Applies from branch `feat/auth0-migration` (October 2026).

Auth0 proves who someone is. ContentForge decides what they own. The
application keeps `users.id` as the key for every user record, owner check and
future organization membership. Auth0's subject (`sub`) is stored only as a
lookup column, `users.auth0_subject`.

## Architecture

```
Browser SPA ──Authorization Code + PKCE──▶ Auth0 Universal Login ──▶ Google (social connection)
     │                                              │
     │◀──────────── access token (aud = AUTH0_AUDIENCE) ┘
     │
     │ POST /api/auth/auth0/session   Authorization: Bearer <access token>
     ▼
ContentForge API
     validate signature (tenant JWKS), issuer, audience, exp/iat/nbf
     sub ──▶ users.auth0_subject ──▶ users.id
     regenerate session, store userId + authMethod=auth0
     │
     ▼
connect.sid session ──▶ authGate ──▶ req.userId ──▶ existing owner checks
```

There is one application authentication boundary: `authGate`
(`server/middleware/authGate.ts`). It writes `req.userId` from one of two
sources, and every handler reads only `req.userId`.

| Request carries | Gate decision |
|---|---|
| `Authorization: Bearer <Auth0 access token>` | Token must validate and resolve to a user, else 401 (403 for an identity refusal). The cookie is ignored. CSRF is skipped because no cookie authenticated the request. |
| No `Authorization` header | The `connect.sid` session must hold a `userId`, else 401. CSRF applies to writes. |

The browser uses the bearer token once, to obtain the session. After that it
runs on the cookie, the same as a password login. This keeps image and media
tags, downloads, streams and the existing CSRF protection working unchanged.
API clients that are not browsers may send the bearer token on every request.

Public, unauthenticated API paths are exactly: `/api/auth/config`,
`/api/auth/register`, `/api/auth/login`, `/api/auth/logout`,
`/api/auth/google`, `/api/auth/google/callback`, `/api/auth/auth0/session`,
`/api/csrf-token`, `/api/health`, `/api/ready`, and `/api/provider-media/<grant>`.
`/api/auth/me` is protected and CSRF-checked.

YouTube is not part of this. Connecting a YouTube channel is a separate Google
OAuth grant for an already signed-in user (`server/social/youtube.ts`), stored
in `connected_accounts`. It keeps its own `YOUTUBE_*` / `GOOGLE_*` credentials.

## Configuration values

| Variable | Kind | Where it lives |
|---|---|---|
| `AUTH0_DOMAIN` | Public | Server env. Sent to the browser by `/api/auth/config`. |
| `AUTH0_CLIENT_ID` | Public | Server env. Sent to the browser. |
| `AUTH0_AUDIENCE` | Public | Server env. Sent to the browser. |
| Google OAuth client secret for the Auth0 Google connection | Secret | Entered only in the Auth0 dashboard. Never in ContentForge. |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | Secret | Server env only (unchanged). |
| Callback, logout and origin URLs | Operator-only | Auth0 dashboard. Derived from the page origin in the app, so no env vars. |

There is no Auth0 client secret. The SPA application is a public client.
Leaving any of the three `AUTH0_*` variables unset disables Auth0: the button
disappears and every bearer token is rejected.

The variables reach the container through the existing `env_file` in
`docker-compose.yml`, so the local and VPS overlays need no change.

## Auth0 tenant setup

Replace `HOST` with the public hostname (for example `contentforge.example.com`).

### 1. API

Dashboard → Applications → APIs → Create API.

- Name: `ContentForge API`.
- Identifier: a stable URI such as `https://api.contentforge.example.com`.
  This is `AUTH0_AUDIENCE`. It cannot be changed later.
- JSON Web Token Signing Algorithm: `RS256`.

### 2. SPA application

Dashboard → Applications → Applications → Create Application →
Single Page Web Applications.

Settings tab:

| Field | Value |
|---|---|
| Allowed Callback URLs | `https://HOST/auth/callback, http://localhost:5000/auth/callback` |
| Allowed Logout URLs | `https://HOST, http://localhost:5000` |
| Allowed Web Origins | `https://HOST, http://localhost:5000` |
| Allowed Origins (CORS) | `https://HOST, http://localhost:5000` |

Advanced Settings → Grant Types: `Authorization Code` on, `Implicit` off,
`Refresh Token` off. Credentials tab: Authentication Method `None`.

Copy the application's Domain into `AUTH0_DOMAIN` and Client ID into
`AUTH0_CLIENT_ID`.

### 3. Google social connection

Dashboard → Authentication → Social → Google / Gmail.

- Use a Google Cloud OAuth client of type Web application whose Authorized
  redirect URI is `https://<AUTH0_DOMAIN>/login/callback`. Enter its Client ID
  and Client Secret in this Auth0 form. Do not reuse the YouTube client.
- Attributes: Email (Basic Profile) on.
- Applications tab: enable the ContentForge SPA application.

Auth0's built-in development keys are for testing only. Production needs your
own Google client.

### 4. Database connection, if used

If the Username-Password connection stays enabled for the SPA, keep email
verification on. ContentForge links or creates an account only for a verified
email, so an unverified sign-up is refused with a message until the user
clicks the verification link.

## Users and account linking

`resolveAuth0User` (`server/auth0/identity.ts`) is the only place an Auth0
identity becomes an application user:

1. A user with this `auth0_subject` exists: that user.
2. Otherwise, email and `email_verified` are read from Auth0 `/userinfo`
   server-side with the validated token. The browser never supplies them.
3. Missing email or `email_verified` not `true`: refused.
4. Exactly one user with that email (case-insensitive) and no Auth0 subject:
   the subject is attached. `users.id`, password hash and `google_id` stay.
5. That user already has a different subject: refused, nothing changes.
6. More than one user with that email: refused, nothing changes.
7. No user: created with a `user_profile` row, unless `REGISTRATION_DISABLED=1`,
   which refuses it.

Concurrent first sign-ins are safe. The unique constraints on
`auth0_subject` and `email` reject the second insert, and the loser resolves
to the winner's row.

To list email collisions before go-live:

```sql
select lower(email) as email, array_agg(id order by id) as user_ids
from users where email is not null
group by lower(email) having count(*) > 1;
```

Each row is an account an operator must merge by hand before its owner can
sign in through Auth0.

## Sessions and logout

Every login path (password, registration, direct Google, Auth0) calls
`establishSession`, which regenerates the session id before binding the user.
A session id planted before login is never promoted.

Logout destroys the session and clears `connect.sid`. When the session came
from Auth0, the response says so and the browser then calls Auth0's logout
with `returnTo` set to the origin, which ends the Auth0 SSO session. The next
sign-in click shows Universal Login again instead of silently reusing it.

## Local development

```sh
# .env
AUTH0_DOMAIN=your-dev-tenant.us.auth0.com
AUTH0_CLIENT_ID=...
AUTH0_AUDIENCE=https://api.contentforge.example.com
npm run dev   # http://localhost:5000
```

Auth0 always shows a consent screen on `localhost`. That is expected.

Deterministic browser test without a tenant (production bundle, mock issuer):

```sh
npm run build
E2E_AUTH0_DATABASE_URL=postgres://e2e:e2e@127.0.0.1:5433/contentforge_e2e npm run test:e2e:auth0
```

## VPS / production

1. Complete the tenant setup above with the production `HOST`.
2. Add the three `AUTH0_*` lines to the env file used by `make vps`.
3. `make deploy-vps`. Migration `0035_auth0_subject` runs on boot.
4. Sign in with Google through the new button and confirm the account is the
   existing one (same data visible).

## Troubleshooting

| Symptom | Cause |
|---|---|
| Auth0 page says "Callback URL mismatch" | `https://HOST/auth/callback` is missing from Allowed Callback URLs. |
| Back on the sign-in page with "Verify your email address" | The identity's email is not verified at Auth0. |
| "linked to a different sign-in" | The email's ContentForge account is already linked to another Auth0 identity. |
| "More than one ContentForge account uses this email" | Run the collision query and merge the accounts. |
| Every request 401 after sign-in, server log `bearer rejected: ERR_JWT_CLAIM_VALIDATION_FAILED (aud)` | `AUTH0_AUDIENCE` differs from the API Identifier. |
| Log `bearer rejected: ERR_JWT_CLAIM_VALIDATION_FAILED (iss)` | `AUTH0_DOMAIN` differs from the tenant domain (custom domain vs `*.auth0.com`). |
| Logout returns an Auth0 error page | The origin is missing from Allowed Logout URLs. |

The server logs only the jose error code, never a token.

## Rollback

- Turn Auth0 off without a code change: remove the `AUTH0_*` variables and
  restart. Password and direct Google login keep working. Existing Auth0-made
  sessions stay valid until logout.
- Revert the code: revert the `feat(auth)` commits on `feat/auth0-migration`.
- Revert the schema (only after the code): `ALTER TABLE users DROP COLUMN
  auth0_subject;` then delete row `0035_auth0_subject` from
  `drizzle.__drizzle_migrations` and its journal entry.

## Legacy login retirement

Password login and the direct Google route stay until the operator has signed
in through Auth0 in production. Removing them is a separate change that must
first check that every active user has an `auth0_subject`, decide what
password-only users do (Auth0 password reset on the same email links them),
remove `passport-google-oauth20`, `/api/auth/google*`, `/api/auth/login` and
`/api/auth/register`, and update the E2E setup that registers by password.

## Future organizations

Organization membership will be a table keyed by `users.id`. Auth0
Organizations, if adopted, map to it the same way subjects do, as a lookup
column, never as the key.
