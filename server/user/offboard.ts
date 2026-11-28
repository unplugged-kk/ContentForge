import { eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import {
  agentRuns,
  agentToolCalls,
  aiModelRoutes,
  aiProviders,
  aiUsageLog,
  analytics,
  articles,
  artifacts,
  auditLogs,
  automationPolicies,
  automationRuns,
  autonomyConfigs,
  autonomyDecisions,
  cannedResponses,
  carousels,
  connectedAccounts,
  contentTemplates,
  contextVault,
  conversations,
  discoveredIdeas,
  discoverySettings,
  experimentAssignments,
  experimentEvaluations,
  experiments,
  experimentVariants,
  generatedImages,
  generationJobs,
  generationPolicies,
  ideas,
  jevDecisions,
  learningObservations,
  learningProposals,
  learningSignals,
  messages,
  monitoredAccounts,
  opportunities,
  performanceSignals,
  pillars,
  policyActivations,
  policyCandidates,
  posts,
  publications,
  referenceContent,
  referencePosts,
  references,
  repurposingPlans,
  researchAnalyses,
  researchEvidence,
  researchJobs,
  researchSources,
  results,
  rssSources,
  scheduleOccurrences,
  schedules,
  stories,
  styleAnalyses,
  styleObservations,
  styleProfiles,
  templates,
  tweets,
  userProfile,
  users,
  videoRepurposingJobs,
  videoRepurposingOutputs,
  viralScores,
  visualAssetRefs,
  visualAssets,
  visualGenerations,
  voices,
  youtubeChannels,
} from "@shared/schema";

export type OffboardStep =
  | {
      readonly kind: "user_column";
      readonly tableName: string;
      readonly table: AnyPgTable;
      readonly userIdColumn: AnyPgColumn;
      readonly clearSelfRefKey?: string;
    }
  | {
      readonly kind: "parent_ids";
      readonly tableName: string;
      readonly table: AnyPgTable;
      readonly foreignKeyColumn: AnyPgColumn;
      readonly parentKey: "schedules" | "research_jobs";
    }
  | {
      readonly kind: "users";
      readonly tableName: "users";
      readonly table: typeof users;
    };

/**
 * Strict child-before-parent deletion plan covering every user-owned table
 * and non-user_id child table in `shared/schema.ts`.
 *
 * Global content-addressed transcript cache tables (`video_sources`,
 * `video_chunks`, `video_claims`) have no `user_id` and no FK to user rows, so
 * they are intentionally excluded.
 */
export const OFFBOARD_DELETE_PLAN: readonly OffboardStep[] = [
  // Autonomous optimization & experimentation (leaf tables first)
  { kind: "user_column", tableName: "autonomy_decisions", table: autonomyDecisions, userIdColumn: autonomyDecisions.userId },
  { kind: "user_column", tableName: "autonomy_configs", table: autonomyConfigs, userIdColumn: autonomyConfigs.userId },
  { kind: "user_column", tableName: "policy_activations", table: policyActivations, userIdColumn: policyActivations.userId },
  { kind: "user_column", tableName: "policy_candidates", table: policyCandidates, userIdColumn: policyCandidates.userId },
  { kind: "user_column", tableName: "experiment_assignments", table: experimentAssignments, userIdColumn: experimentAssignments.userId },
  { kind: "user_column", tableName: "experiment_evaluations", table: experimentEvaluations, userIdColumn: experimentEvaluations.userId },
  { kind: "user_column", tableName: "experiment_variants", table: experimentVariants, userIdColumn: experimentVariants.userId },
  { kind: "user_column", tableName: "experiments", table: experiments, userIdColumn: experiments.userId },

  // Learning & performance telemetry
  { kind: "user_column", tableName: "learning_proposals", table: learningProposals, userIdColumn: learningProposals.userId },
  { kind: "user_column", tableName: "learning_observations", table: learningObservations, userIdColumn: learningObservations.userId },
  { kind: "user_column", tableName: "learning_signals", table: learningSignals, userIdColumn: learningSignals.userId },
  { kind: "user_column", tableName: "performance_signals", table: performanceSignals, userIdColumn: performanceSignals.userId },

  // Distribution & scheduling chain
  { kind: "user_column", tableName: "results", table: results, userIdColumn: results.userId },
  { kind: "user_column", tableName: "publications", table: publications, userIdColumn: publications.userId },
  { kind: "parent_ids", tableName: "schedule_occurrences", table: scheduleOccurrences, foreignKeyColumn: scheduleOccurrences.scheduleId, parentKey: "schedules" },
  { kind: "user_column", tableName: "schedules", table: schedules, userIdColumn: schedules.userId },

  // Visual & video repurposing chain (visual_generations.source_visual_asset_id cycle broken pre-delete)
  { kind: "user_column", tableName: "visual_asset_refs", table: visualAssetRefs, userIdColumn: visualAssetRefs.userId },
  { kind: "user_column", tableName: "video_repurposing_outputs", table: videoRepurposingOutputs, userIdColumn: videoRepurposingOutputs.userId },
  { kind: "user_column", tableName: "video_repurposing_jobs", table: videoRepurposingJobs, userIdColumn: videoRepurposingJobs.userId },
  { kind: "user_column", tableName: "visual_assets", table: visualAssets, userIdColumn: visualAssets.userId },
  { kind: "user_column", tableName: "visual_generations", table: visualGenerations, userIdColumn: visualGenerations.userId },

  // Core content lifecycle
  { kind: "user_column", tableName: "artifacts", table: artifacts, userIdColumn: artifacts.userId },
  { kind: "user_column", tableName: "generation_jobs", table: generationJobs, userIdColumn: generationJobs.userId },
  { kind: "user_column", tableName: "generation_policies", table: generationPolicies, userIdColumn: generationPolicies.userId },
  { kind: "user_column", tableName: "voices", table: voices, userIdColumn: voices.userId },
  { kind: "user_column", tableName: "content_templates", table: contentTemplates, userIdColumn: contentTemplates.userId },
  { kind: "user_column", tableName: "repurposing_plans", table: repurposingPlans, userIdColumn: repurposingPlans.userId },
  { kind: "user_column", tableName: "opportunities", table: opportunities, userIdColumn: opportunities.userId },
  { kind: "user_column", tableName: "stories", table: stories, userIdColumn: stories.userId },

  // Automation
  { kind: "user_column", tableName: "automation_runs", table: automationRuns, userIdColumn: automationRuns.userId },
  { kind: "user_column", tableName: "automation_policies", table: automationPolicies, userIdColumn: automationPolicies.userId },

  // Research domain
  { kind: "user_column", tableName: "research_analyses", table: researchAnalyses, userIdColumn: researchAnalyses.userId },
  { kind: "parent_ids", tableName: "research_evidence", table: researchEvidence, foreignKeyColumn: researchEvidence.jobId, parentKey: "research_jobs" },
  { kind: "parent_ids", tableName: "research_sources", table: researchSources, foreignKeyColumn: researchSources.jobId, parentKey: "research_jobs" },
  { kind: "user_column", tableName: "research_jobs", table: researchJobs, userIdColumn: researchJobs.userId },

  // Style intelligence & references
  { kind: "user_column", tableName: "style_observations", table: styleObservations, userIdColumn: styleObservations.userId },
  {
    kind: "user_column",
    tableName: "style_profiles",
    table: styleProfiles,
    userIdColumn: styleProfiles.userId,
    clearSelfRefKey: "supersedesId",
  },
  { kind: "user_column", tableName: "style_analyses", table: styleAnalyses, userIdColumn: styleAnalyses.userId },
  { kind: "user_column", tableName: "reference_content", table: referenceContent, userIdColumn: referenceContent.userId },
  { kind: "user_column", tableName: "reference_posts", table: referencePosts, userIdColumn: referencePosts.userId },
  { kind: "user_column", tableName: "references", table: references, userIdColumn: references.userId },

  // Agent runtime & AI providers
  { kind: "user_column", tableName: "agent_tool_calls", table: agentToolCalls, userIdColumn: agentToolCalls.userId },
  { kind: "user_column", tableName: "agent_runs", table: agentRuns, userIdColumn: agentRuns.userId },
  { kind: "user_column", tableName: "ai_model_routes", table: aiModelRoutes, userIdColumn: aiModelRoutes.userId },
  { kind: "user_column", tableName: "ai_providers", table: aiProviders, userIdColumn: aiProviders.userId },

  // Legacy content, chat, discovery, and account tables
  { kind: "user_column", tableName: "tweets", table: tweets, userIdColumn: tweets.userId },
  { kind: "user_column", tableName: "analytics", table: analytics, userIdColumn: analytics.userId },
  { kind: "user_column", tableName: "viral_scores", table: viralScores, userIdColumn: viralScores.userId },
  { kind: "user_column", tableName: "generated_images", table: generatedImages, userIdColumn: generatedImages.userId },
  { kind: "user_column", tableName: "articles", table: articles, userIdColumn: articles.userId },
  { kind: "user_column", tableName: "posts", table: posts, userIdColumn: posts.userId },
  { kind: "user_column", tableName: "messages", table: messages, userIdColumn: messages.userId },
  { kind: "user_column", tableName: "conversations", table: conversations, userIdColumn: conversations.userId },
  { kind: "user_column", tableName: "ideas", table: ideas, userIdColumn: ideas.userId },
  { kind: "user_column", tableName: "templates", table: templates, userIdColumn: templates.userId },
  { kind: "user_column", tableName: "discovered_ideas", table: discoveredIdeas, userIdColumn: discoveredIdeas.userId },
  { kind: "user_column", tableName: "carousels", table: carousels, userIdColumn: carousels.userId },
  { kind: "user_column", tableName: "rss_sources", table: rssSources, userIdColumn: rssSources.userId },
  { kind: "user_column", tableName: "youtube_channels", table: youtubeChannels, userIdColumn: youtubeChannels.userId },
  { kind: "user_column", tableName: "pillars", table: pillars, userIdColumn: pillars.userId },
  { kind: "user_column", tableName: "monitored_accounts", table: monitoredAccounts, userIdColumn: monitoredAccounts.userId },
  { kind: "user_column", tableName: "discovery_settings", table: discoverySettings, userIdColumn: discoverySettings.userId },
  { kind: "user_column", tableName: "canned_responses", table: cannedResponses, userIdColumn: cannedResponses.userId },
  { kind: "user_column", tableName: "context_vault", table: contextVault, userIdColumn: contextVault.userId },
  { kind: "user_column", tableName: "connected_accounts", table: connectedAccounts, userIdColumn: connectedAccounts.userId },
  { kind: "user_column", tableName: "ai_usage_log", table: aiUsageLog, userIdColumn: aiUsageLog.userId },
  { kind: "user_column", tableName: "audit_logs", table: auditLogs, userIdColumn: auditLogs.userId },
  { kind: "user_column", tableName: "jev_decisions", table: jevDecisions, userIdColumn: jevDecisions.userId },
  { kind: "user_column", tableName: "user_profile", table: userProfile, userIdColumn: userProfile.userId },

  // Account row deleted last
  { kind: "users", tableName: "users", table: users },
];

export const OFFBOARD_DELETE_ORDER: readonly string[] = OFFBOARD_DELETE_PLAN.map(
  (step) => step.tableName,
);

export interface OffboardTx {
  select: (fields: Record<string, unknown>) => {
    from: (table: AnyPgTable) => {
      where: (condition: SQL) => Promise<Array<Record<string, unknown>>>;
    };
  };
  update: (table: AnyPgTable) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: SQL) => Promise<unknown>;
    };
  };
  delete: (table: AnyPgTable) => {
    where: (condition: SQL) => {
      returning: (fields: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    };
  };
}

export interface OffboardDb {
  transaction: <T>(fn: (tx: OffboardTx) => Promise<T>) => Promise<T>;
}

export interface OffboardOptions {
  /** Defaults to true so callers must explicitly opt in to destructive deletion. */
  dryRun?: boolean;
}

export interface OffboardResult {
  userId: number;
  found: boolean;
  dryRun: boolean;
  counts: Record<string, number>;
  totalRows: number;
}

async function countRows(tx: OffboardTx, table: AnyPgTable, condition: SQL): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(condition);
  const raw = rows[0]?.count;
  return typeof raw === "number" ? raw : Number(raw ?? 0);
}

async function deleteRows(tx: OffboardTx, table: AnyPgTable, condition: SQL): Promise<number> {
  const deleted = await tx
    .delete(table)
    .where(condition)
    .returning({ ok: sql<number>`1` });
  return deleted.length;
}

/**
 * Count (dryRun: true) or delete (dryRun: false) all rows owned by `userId`
 * inside a single database transaction in strict child-before-parent FK order.
 *
 * Never touches rows belonging to other users or rows with `user_id IS NULL`.
 */
export async function offboardUser(
  db: OffboardDb,
  userId: number,
  options: OffboardOptions = {},
): Promise<OffboardResult> {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error(`Invalid userId: ${userId}`);
  }
  const dryRun = options.dryRun ?? true;

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId));

    if (existing.length === 0) {
      return {
        userId,
        found: false,
        dryRun,
        counts: {},
        totalRows: 0,
      };
    }

    const ownedScheduleRows = await tx
      .select({ id: schedules.id })
      .from(schedules)
      .where(eq(schedules.userId, userId));
    const ownedResearchJobRows = await tx
      .select({ id: researchJobs.id })
      .from(researchJobs)
      .where(eq(researchJobs.userId, userId));

    const parentIds: Record<"schedules" | "research_jobs", number[]> = {
      schedules: ownedScheduleRows
        .map((r) => Number(r.id))
        .filter((id) => Number.isInteger(id) && id > 0),
      research_jobs: ownedResearchJobRows
        .map((r) => Number(r.id))
        .filter((id) => Number.isInteger(id) && id > 0),
    };

    if (!dryRun) {
      // Break the mutual FK cycle between visual_generations.source_visual_asset_id
      // and visual_assets.visual_generation_id before deleting visual_assets.
      await tx
        .update(visualGenerations)
        .set({ sourceVisualAssetId: null })
        .where(eq(visualGenerations.userId, userId));
    }

    const counts: Record<string, number> = {};
    let totalRows = 0;

    for (const step of OFFBOARD_DELETE_PLAN) {
      let condition: SQL | null = null;
      if (step.kind === "user_column") {
        condition = eq(step.userIdColumn, userId);
      } else if (step.kind === "parent_ids") {
        const ids = parentIds[step.parentKey];
        if (ids.length === 0) {
          counts[step.tableName] = 0;
          continue;
        }
        condition = inArray(step.foreignKeyColumn, ids);
      } else {
        condition = eq(users.id, userId);
      }

      if (dryRun) {
        const n = await countRows(tx, step.table, condition);
        counts[step.tableName] = n;
        totalRows += n;
      } else {
        if (step.kind === "user_column" && step.clearSelfRefKey) {
          await tx
            .update(step.table)
            .set({ [step.clearSelfRefKey]: null })
            .where(condition);
        }
        const n = await deleteRows(tx, step.table, condition);
        counts[step.tableName] = n;
        totalRows += n;
      }
    }

    return {
      userId,
      found: true,
      dryRun,
      counts,
      totalRows,
    };
  });
}
