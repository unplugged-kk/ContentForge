import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Auth0 configuration and access-token verification. No database access, so
 * the verifier can be tested against a local key set.
 *
 * All three values are public: the SPA receives them from /api/auth/config.
 * There is no client secret: the SPA uses Authorization Code + PKCE.
 */
export interface Auth0Config {
  domain: string;
  clientId: string;
  audience: string;
  /** `https://<domain>/`, the exact `iss` Auth0 puts in its tokens. */
  issuer: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function readAuth0Config(env: NodeJS.ProcessEnv = process.env): Auth0Config | null {
  const domain = env.AUTH0_DOMAIN?.trim();
  const clientId = env.AUTH0_CLIENT_ID?.trim();
  const audience = env.AUTH0_AUDIENCE?.trim();
  if (!domain || !clientId || !audience) return null;

  const base = new URL(/^https?:\/\//.test(domain) ? domain : `https://${domain}`);
  // A plain-http issuer is only accepted on loopback, where the E2E mock
  // issuer runs. Anything else would let a network attacker serve the JWKS.
  if (base.protocol !== "https:" && !LOOPBACK_HOSTS.has(base.hostname)) {
    throw new Error("AUTH0_DOMAIN must be an https host");
  }
  return { domain, clientId, audience, issuer: `${base.origin}/` };
}

export type Auth0TokenVerifier = (token: string) => Promise<{ subject: string } | null>;

/**
 * Validates signature (against the tenant JWKS, cached and rotated by jose),
 * issuer, audience, expiry and not-before. Any failure yields null and a
 * server log naming the jose error code. The token itself is never logged.
 */
export function createAuth0TokenVerifier(
  config: Auth0Config,
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(".well-known/jwks.json", config.issuer)),
): Auth0TokenVerifier {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ["RS256"],
        requiredClaims: ["sub", "exp", "iat"],
        clockTolerance: 5,
      });
      return payload.sub ? { subject: payload.sub } : null;
    } catch (err) {
      const code = (err as { code?: string; claim?: string }).code ?? "unknown";
      const claim = (err as { claim?: string }).claim;
      console.warn(`[auth0] bearer rejected: ${code}${claim ? ` (${claim})` : ""}`);
      return null;
    }
  };
}

export interface Auth0Profile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/**
 * Email and email_verified come from Auth0's /userinfo, called server-side
 * with the already-validated access token. The browser never supplies them.
 */
export async function fetchAuth0Profile(
  config: Auth0Config,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Auth0Profile> {
  const res = await fetchImpl(new URL("userinfo", config.issuer), {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Auth0 userinfo returned ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    subject: str(body.sub) ?? "",
    email: str(body.email),
    emailVerified: body.email_verified === true,
    name: str(body.name),
    picture: str(body.picture),
  };
}
