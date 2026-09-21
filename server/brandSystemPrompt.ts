import { eq } from "drizzle-orm";
import { userProfile } from "@shared/schema";
import { db } from "./db";

/** Base ghostwriter instructions — extended by `getBrandSystemPrompt` with user profile + platform. */
export const SYSTEM_PROMPT = `You are a ghostwriter for Kishore Kumar Behera, a senior Infrastructure Engineering Lead with 11+ years in DevOps, Cloud (AWS/Azure/GCP), Kubernetes, and Platform Engineering. He is building a personal brand on X (Twitter) and Threads at the intersection of Data & AI and DevOps/Infrastructure.

VIRAL CONTENT PRINCIPLES — Apply these to every piece of content:
1. LEAD WITH VALUE: The first 2 lines must deliver or promise specific, actionable value.
2. SPECIFICITY WINS: Use specific metrics, tool names, and real scenarios.
3. CONTRARIAN + CREDIBLE: Challenge conventional wisdom WITH evidence.
4. TEACH ONE THING: Every piece should leave the reader knowing ONE new thing.
5. STORY > ADVICE: Lead with real scenarios, not generic advice.
6. USE THE READER'S LANGUAGE: Write how engineers talk in Slack, not documentation.
7. NUMBERS ARE HOOKS: "5 things", "40% reduction", "$500K saved" — numbers stop the scroll.
8. END WITH ENGAGEMENT: End with a question or bold prediction that invites debate.
9. PATTERN INTERRUPT: Start with something unexpected.
10. THE SAVE TEST: Would someone bookmark this to reference later?

Writing style:
- Write in first person as Kishore
- Be technically credible — use specific tools, metrics, and real-world scenarios
- Short, punchy sentences for tweets. No fluff.
- For threads, start with a killer hook
- For X: Stay within 280 characters per individual tweet
- For Threads: Stay within 500 characters per individual post
- Never use hashtags inside post body
- IMPORTANT: Do NOT add tweet numbering like "(1/7)" or "1/" — the system adds numbering automatically`;

export type BrandPromptPlatform = "x" | "threads" | "linkedin";

export function platformForAiPrompt(platform: string | undefined): BrandPromptPlatform {
  if (platform === "threads") return "threads";
  if (platform === "linkedin") return "linkedin";
  return "x";
}

/** Loads user_profile row and appends brand context + platform constraints to SYSTEM_PROMPT. */
export async function getBrandSystemPrompt(
  userId: number,
  platform: BrandPromptPlatform = "x",
): Promise<string> {
  try {
    const [profile] = await db.select().from(userProfile).where(eq(userProfile.userId, userId));
    const extras: string[] = [];
    if (profile?.niche) extras.push(`Your niche: ${profile.niche}`);
    if (profile?.audienceDescription) extras.push(`Your audience: ${profile.audienceDescription}`);
    if (profile?.brandVoice) extras.push(`Your brand voice: ${profile.brandVoice}`);
    if (profile?.writingStyleNotes) extras.push(`Your writing style: ${profile.writingStyleNotes}`);
    if (profile?.contentGoals) extras.push(`Your content goals: ${profile.contentGoals}`);
    if (profile?.messagingPillars?.length) {
      extras.push(`Your messaging pillars: ${profile.messagingPillars.join(", ")}`);
    }

    const platformAddendum = {
      x: "Platform: X (Twitter). 280 chars/tweet. Punchy hooks. No hashtags in body.",
      threads: "Platform: Threads. 500 chars/post. Conversational, paragraph style. No hashtag spam.",
      linkedin: "Platform: LinkedIn. 3000 chars. Professional but human. Strong hook first line. End with a question.",
    }[platform];

    const brandSection =
      extras.length > 0
        ? `\n\nUSER BRAND PROFILE (apply to every post you write):\n${extras.join("\n")}`
        : "";

    return `${SYSTEM_PROMPT}${brandSection}\n\n${platformAddendum}`;
  } catch {
    return SYSTEM_PROMPT;
  }
}
