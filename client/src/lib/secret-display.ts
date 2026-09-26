/**
 * Masking for credentials on their way into the DOM.
 *
 * The server already masks `accessToken` before it leaves `/api/accounts`
 * (`server/routes.ts` maps it to `••••••` + last 4). This helper exists so the
 * UI does not *depend* on that. If the server-side masking is ever removed, or
 * a future endpoint returns a raw token, the client still cannot print more
 * than the last 4 characters of a secret.
 *
 * The previous inline render (`{account.accessToken}`) had no such guarantee —
 * it printed whatever the API sent, so a single server change would have put a
 * live credential into the DOM.
 *
 * Two rules it enforces that a naive "show the last 4" does not:
 *  - a value too short to survive a 4-character suffix is never shown at all,
 *    because "show the last 4" on a 4-character secret shows the whole secret;
 *  - the rendered string is always derived from the value, never passed through.
 */

const MASK = "••••••";
const VISIBLE_SUFFIX_LENGTH = 4;

export const SECRET_NOT_SET = "Not set";

/** Longest run of the original value that `maskSecret` can ever expose. */
export const MASKED_SECRET_VISIBLE_SUFFIX = VISIBLE_SUFFIX_LENGTH;

/**
 * Render a credential for display without exposing it.
 *
 * Returns a fixed mask plus at most the last 4 characters, or "Not set" for a
 * missing value. Never returns any other part of the input.
 */
export function maskSecret(value: string | null | undefined): string {
  if (typeof value !== "string") return SECRET_NOT_SET;
  const trimmed = value.trim();
  if (trimmed.length === 0) return SECRET_NOT_SET;
  // A value this short would be fully revealed by a 4-character suffix.
  if (trimmed.length <= VISIBLE_SUFFIX_LENGTH) return MASK;
  return MASK + trimmed.slice(-VISIBLE_SUFFIX_LENGTH);
}
