/**
 * CSRF token store for the React client. Lazily fetches /api/csrf-token on the
 * first non-GET request, caches the token in memory for the session, and
 * refreshes once if the server rejects it with 403.
 *
 * Single-flight: if many requests fire at once and no token is cached, only
 * one network call to /api/csrf-token is made; the others wait on the same
 * promise.
 */

let cachedToken: string | null = null;
let inflight: Promise<string | null> | null = null;

async function fetchToken(): Promise<string | null> {
  const res = await fetch("/api/csrf-token", {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { csrfToken?: string };
  return body.csrfToken ?? null;
}

export async function getCsrfToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (inflight) return inflight;
  inflight = (async () => {
    const token = await fetchToken();
    cachedToken = token;
    inflight = null;
    return token;
  })();
  return inflight;
}

export function invalidateCsrfToken(): void {
  cachedToken = null;
}
