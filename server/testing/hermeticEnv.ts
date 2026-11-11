/**
 * Hermetic test environment — imported before any test module loads.
 *
 * A test process must never be able to reach a real distribution provider, spend
 * money on a model, or inherit an operator's behaviour flags. On a developer
 * machine (and under an agent harness that exported `.env` into the shell) the
 * suite does inherit them, and the consequences are not cosmetic:
 *
 *   • `XQUIK_API_KEY` / `X_*` made `adapters.test.ts` publish to the live X
 *     provider instead of failing fast on "credentials missing".
 *   • `AI_API_KEY` + `GEMINI_API_KEY` + `CONTENTFORGE_ALLOW_PAID_MEDIA` let
 *     research and generation tests make real, billable calls.
 *   • `JEV_CONTENT_GATE=1` turned an expected `200` into a `409` on submit-review.
 *
 * CI has none of these variables, so the same tree passes there and fails locally
 * for reasons that read as product bugs. Every credential and flag is therefore
 * removed once, here. A test that needs one sets it inside the test itself, which
 * is the only place it is visible.
 */

/** Ambient variables that must never reach a test process. */
const NON_HERMETIC = [
  // Distribution channels — write-capable provider credentials.
  /^X_/,
  /^XQUIK_/,
  /^XQUICK_/,
  /^THREADS_/,
  /^INSTAGRAM_/,
  /^LINKEDIN_/,
  /^FACEBOOK_/,
  /^YOUTUBE_/,
  // Model providers — every call may be billable.
  /^AI_API_KEY$/,
  /^AI_BASE_URL$/,
  /^AI_[A-Z]+_MODEL$/,
  /^OPENAI_/,
  /^GEMINI_/,
  /^GOOGLE_API_KEY$/,
  /^ANTHROPIC_/,
  // Research providers that reach the network or a paid index.
  /^LAST30DAYS_/,
  /^OPENSEO_/,
  /^REDDIT_/,
  /^WEB_RESEARCH_/,
  /^VIDEO_RESEARCH_/,
  // Behaviour flags and opt-ins.
  /^JEV_/,
  /^CONTENTFORGE_ALLOW_PAID_MEDIA$/,
  /^CONTENTFORGE_EXPERTISE$/,
  /^CONTENTFORGE_AUDIENCE$/,
  /^CONTENTFORGE_PUBLIC_URL$/,
];

const removed = Object.keys(process.env).filter((key) =>
  NON_HERMETIC.some((pattern) => pattern.test(key)),
);

for (const key of removed) delete process.env[key];

if (removed.length > 0 && process.env.CONTENTFORGE_TEST_ENV_VERBOSE === "1") {
  console.log(`[hermetic-env] removed ${removed.length}: ${removed.sort().join(", ")}`);
}
