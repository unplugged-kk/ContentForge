import type { JWTVerifyGetKey } from "jose";
import {
  createAuth0TokenVerifier,
  fetchAuth0Profile,
  readAuth0Config,
  type Auth0Config,
  type Auth0Profile,
} from "./token";
import { resolveAuth0User, type Auth0Refusal } from "./identity";
import type { BearerAuthentication, BearerAuthenticator } from "../middleware/authGate";

export type Auth0Authenticator = BearerAuthenticator;

const REFUSAL_MESSAGES: Record<Auth0Refusal, string> = {
  email_missing:
    "Your sign-in did not share an email address. Use a sign-in method that provides one.",
  email_unverified: "Verify your email address with the sign-in provider, then sign in again.",
  email_ambiguous:
    "More than one ContentForge account uses this email. Ask the administrator to link your sign-in.",
  subject_conflict:
    "This email belongs to a ContentForge account linked to a different sign-in. Use that sign-in or ask the administrator.",
  registration_disabled: "Registration is disabled on this instance.",
};

const UNAUTHORIZED: BearerAuthentication = { ok: false, status: 401, message: "Unauthorized" };

export function createAuth0Authenticator(
  config: Auth0Config,
  deps: {
    keys?: JWTVerifyGetKey;
    loadProfile?: (accessToken: string) => Promise<Auth0Profile>;
    registrationOpen?: () => boolean;
  } = {},
): Auth0Authenticator {
  const verify = createAuth0TokenVerifier(config, deps.keys);
  const loadProfile = deps.loadProfile ?? ((token: string) => fetchAuth0Profile(config, token));
  const registrationOpen = deps.registrationOpen ?? (() => process.env.REGISTRATION_DISABLED !== "1");

  return async (accessToken) => {
    const verified = await verify(accessToken);
    if (!verified) return UNAUTHORIZED;
    try {
      const outcome = await resolveAuth0User(verified.subject, () => loadProfile(accessToken), {
        registrationOpen: registrationOpen(),
      });
      if (outcome.kind === "resolved") {
        if (outcome.via !== "subject") {
          console.log(`[auth0] ${outcome.via} user=${outcome.userId}`);
        }
        return { ok: true, userId: outcome.userId };
      }
      console.warn(`[auth0] refused: ${outcome.reason}`);
      return { ok: false, status: 403, message: REFUSAL_MESSAGES[outcome.reason] };
    } catch (err) {
      console.error(`[auth0] identity resolution failed: ${(err as Error).message}`);
      return UNAUTHORIZED;
    }
  };
}

let configured: { config: Auth0Config; authenticate: Auth0Authenticator } | null | undefined;

/** Reads AUTH0_* once. Null when Auth0 is not configured on this instance. */
export function auth0FromEnv(): { config: Auth0Config; authenticate: Auth0Authenticator } | null {
  if (configured === undefined) {
    const config = readAuth0Config();
    configured = config ? { config, authenticate: createAuth0Authenticator(config) } : null;
  }
  return configured;
}
