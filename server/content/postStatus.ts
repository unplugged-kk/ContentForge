/**
 * D23 / §27 option A — draft-only mode for auto-generated posts.
 *
 * The risk this closes: the autopilot wrote `status: "scheduled"`, and
 * `server/scheduler.ts` publishes anything that is `scheduled` and due. So a
 * generated post could reach a connected account with no human in the loop. The
 * `DISABLE_*` environment flags were holding that off, but a brake is not a fix:
 * one missing env var and generation becomes publishing.
 *
 * Instead, auto-generated posts are written as `"draft"`. A draft is never
 * selected by the publishing scheduler, so the behaviour is enforced by the
 * status value rather than by an operational setting someone can forget.
 *
 * Nothing here can publish. Promoting a draft to `scheduled` remains a human
 * action in the UI/API (`PATCH /api/posts/:id` with the `scheduled` status),
 * which is exactly the gate D23 asks for.
 */

/** The status every auto-generated post is created with. */
export const AUTO_GENERATED_POST_STATUS = "draft" as const;

/**
 * Statuses that OCCUPY a publishing slot.
 *
 * This matters more than it looks. `autofillCalendar` decides which slots are
 * free by collecting the `scheduledAt` of posts it believes are taken. If drafts
 * stopped counting, every run would see every slot free and create a duplicate
 * draft for the same slot every day. Occupancy is about "a human already has
 * something waiting here", not about "the scheduler will fire".
 */
export const SLOT_OCCUPYING_STATUSES = ["draft", "ready", "scheduled"] as const;

/**
 * Statuses that the PUBLISHING scheduler is allowed to pick up.
 *
 * Deliberately does not include `draft` or `ready`. Tested directly.
 */
export const PUBLISHABLE_STATUSES = ["scheduled"] as const;

export function occupiesSlot(status: string | null | undefined): boolean {
  return !!status && (SLOT_OCCUPYING_STATUSES as readonly string[]).includes(status);
}

export function isPublishable(status: string | null | undefined): boolean {
  return !!status && (PUBLISHABLE_STATUSES as readonly string[]).includes(status);
}
