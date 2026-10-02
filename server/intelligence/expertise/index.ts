/**
 * Expertise intelligence (signals only — it decides nothing).
 */

export {
  buildExpertiseProfile,
  normalizePhrase,
  profileTokens,
  splitList,
  PROFILE_BOUNDS,
  type ExpertiseConfidence,
  type ExpertiseInput,
  type ExpertiseProfile,
} from "./profile";

export {
  expertiseAlignment,
  expertiseBand,
  type ExpertiseAlignment,
  type ExpertiseBand,
  type ExpertiseTopic,
} from "./signals";
