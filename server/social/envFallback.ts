export interface EnvFallbackOptions {
  env?: NodeJS.ProcessEnv;
  allowLegacyXQuickAlias?: boolean;
}

/**
 * Env-var channel credentials are a deployment-wide escape hatch and must
 * never silently satisfy an authenticated owner who has no connected account.
 */
export function isEnvCredentialFallbackAllowed(
  ownerUserId?: number | null,
  options: EnvFallbackOptions = {},
): boolean {
  if (ownerUserId == null) return true;
  const env = options.env ?? process.env;
  const enabled =
    env.ALLOW_ENV_CHANNEL_FALLBACK === "1" ||
    (options.allowLegacyXQuickAlias === true && env.ALLOW_ENV_XQUICK_FALLBACK === "1");
  if (!enabled) return false;
  const singleOwner = env.SINGLE_OPERATOR_OWNER_ID?.trim();
  if (!singleOwner) return true;
  return Number(singleOwner) === ownerUserId;
}
