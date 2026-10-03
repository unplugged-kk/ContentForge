/**
 * Decision definition — `agent_route` (JC-03), shadow only.
 *
 * The agent's plan comes from a deterministic regex compiler
 * (`shared/agent-ui.ts:compileWorkspaceIntent`). This shadow asks the decision
 * layer which tool an objective should START with, and which time window it
 * implies, so the two can be compared before any cut-over.
 *
 * The tool set is a CONTROLLED REGISTRY — exactly the eight tools the compiler
 * can emit. Jev selects from that list; it cannot invent a tool, and an answer
 * outside the list is discarded.
 */

import type { JevQuestion, JevResponse } from "../jev";
import type { DecisionBuildInput, DecisionDefinition, DecisionOutcome } from "../registry";
import type { AgentRouteDecision } from "../schemas";

/** The compiler's emitted tools — the complete, closed set. */
export const AGENT_TOOLS = [
  "get_story",
  "research_topic",
  "create_story",
  "repurpose_story",
  "generate_image",
  "generate_video",
  "generate_audio",
  "repurpose_video",
] as const;

export const AGENT_WINDOWS = ["today", "last_24h", "last_7d", "last_30d"] as const;

const TOOL_HINTS: Record<string, string> = {
  get_story: "read an existing story by id",
  research_topic: "run fresh research on a topic",
  create_story: "turn research into a story",
  repurpose_story: "fan a story out into opportunities/content",
  generate_image: "produce a visual",
  generate_video: "produce a video",
  generate_audio: "produce narration/audio",
  repurpose_video: "cut clips from an existing video",
};

const WINDOW_HINTS: Record<string, string> = {
  today: "today only",
  last_24h: "the last 24 hours",
  last_7d: "the last 7 days",
  last_30d: "the last 30 days",
};

const NONE = "none";

function matchOption(choice: string, options: readonly string[]): string | null {
  const value = choice.trim().toLowerCase();
  if (!value) return null;
  for (const option of options) if (option.toLowerCase() === value) return option;
  for (const option of options) if (value.includes(option.toLowerCase())) return option;
  return null;
}

export const agentRouteDefinition: DecisionDefinition<AgentRouteDecision> = {
  type: "agent_route",

  buildQuestions(input: DecisionBuildInput) {
    const objective = input.state.topic?.title ?? input.state.topic?.query ?? "";
    const tools: Record<string, string> = {};
    for (const tool of AGENT_TOOLS) tools[tool] = TOOL_HINTS[tool] ?? tool;
    const windows: Record<string, string> = { [NONE]: "no particular window" };
    for (const window of AGENT_WINDOWS) windows[window] = WINDOW_HINTS[window] ?? window;

    return {
      tool: {
        type: "choice",
        instructions: `An operator asked: "${objective}". Which SINGLE tool should this start with? Choose exactly one.`,
        criteria: tools,
      },
      window: {
        type: "choice",
        instructions: "Which time window does that request imply? Choose exactly one.",
        criteria: windows,
      },
    };
  },

  parse(input: DecisionBuildInput, response: JevResponse): DecisionOutcome<AgentRouteDecision> {
    const toolAnswer = response.answers.tool;
    const windowAnswer = response.answers.window;

    const firstTool =
      toolAnswer && toolAnswer.type === "choice" && typeof toolAnswer.choice === "string"
        ? matchOption(toolAnswer.choice, AGENT_TOOLS)
        : null;
    const windowChoice =
      windowAnswer && windowAnswer.type === "choice" && typeof windowAnswer.choice === "string"
        ? matchOption(windowAnswer.choice, [...AGENT_WINDOWS, NONE])
        : null;
    const windowPreset =
      windowChoice === null || windowChoice === NONE
        ? null
        : (windowChoice as AgentRouteDecision["windowPreset"]);

    // Nothing readable is not "route to nothing": reach the fallback.
    if (firstTool === null && windowPreset === null) throw new Error("JEV_NO_ROUTE_ANSWER");

    const signals: Record<string, unknown> = { tool: firstTool };
    // The compiler's own choice travels in the state flags, so one ledger row
    // holds both sides of the comparison.
    const legacy = (input.state.quality?.flags ?? []).filter((flag) => flag.startsWith("legacy:"));
    if (legacy.length > 0) signals.legacy = legacy;

    return {
      decision: { firstTool, windowPreset },
      confidence:
        toolAnswer && toolAnswer.type === "choice" && Number.isFinite(toolAnswer.confidence)
          ? Number(Math.min(1, Math.max(0, toolAnswer.confidence)).toFixed(4))
          : undefined,
      reasons: [`start with ${firstTool ?? "nothing"}, window ${windowPreset ?? "none"}`],
      signals,
    };
  },

  /** Deterministic: choose nothing. A shadow changes no behaviour either way. */
  fallback(_input: DecisionBuildInput) {
    return { firstTool: null, windowPreset: null };
  },
};
