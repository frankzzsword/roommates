import OpenAI from "openai";

import { config, hasOpenAiCredentials } from "../config.js";
import type { FrequencyUnit, HouseholdSnapshot, TaskMode } from "../lib/types.js";

export interface AiSubtaskSuggestion {
  title: string;
  description: string;
  area: string;
  frequencyInterval: number;
  frequencyUnit: FrequencyUnit;
  isOptionalSubtask: boolean;
  rationale: string;
}

export interface AiHouseInsight {
  title: string;
  impact: "high" | "medium" | "low";
  recommendation: string;
}

export interface AiWhatsappIntent {
  action:
    | "HELP"
    | "TASKS"
    | "STATUS"
    | "DONE"
    | "SKIP"
    | "SKIP_REASSIGN"
    | "RESCUE"
    | "UNKNOWN";
  assignmentId: number | null;
  reason: string | null;
}

const client = hasOpenAiCredentials()
  ? new OpenAI({ apiKey: config.openAiApiKey })
  : null;

function sanitizeJsonBlock(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function uniqueModels() {
  return Array.from(
    new Set([config.openAiSubtaskModel, "gpt-5-mini"].filter(Boolean))
  );
}

function heuristicSubtasks(input: {
  title: string;
  description: string;
  area: string;
  taskMode: TaskMode;
}) {
  const value = `${input.title} ${input.description}`.toLowerCase();
  const suggestions: AiSubtaskSuggestion[] = [];

  if (value.includes("bathroom")) {
    suggestions.push(
      {
        title: "Restock toilet paper",
        description: "Check spare rolls and refill before the bathroom runs empty.",
        area: "Bathroom",
        frequencyInterval: 1,
        frequencyUnit: "week",
        isOptionalSubtask: false,
        rationale: "This prevents the classic bathroom reset blind spot."
      },
      {
        title: "Deep clean bathtub",
        description: "Scrub the tub edges, drain, and grout line on a less frequent cycle.",
        area: "Bathroom",
        frequencyInterval: 1,
        frequencyUnit: "month",
        isOptionalSubtask: true,
        rationale: "A monthly deep-clean subtask keeps the main weekly task from getting bloated."
      }
    );
  }

  if (value.includes("kitchen") || value.includes("dishwasher")) {
    suggestions.push(
      {
        title: "Wipe appliance fronts",
        description: "Give the dishwasher, oven, and fridge handles a quick wipe.",
        area: "Kitchen",
        frequencyInterval: 1,
        frequencyUnit: "week",
        isOptionalSubtask: false,
        rationale: "This captures the visible kitchen mess that often gets skipped."
      },
      {
        title: "Restock dishwasher tabs",
        description: "Check that detergent tabs and rinse aid are topped up.",
        area: "Kitchen",
        frequencyInterval: 1,
        frequencyUnit: "month",
        isOptionalSubtask: true,
        rationale: "Consumables are easy to forget and work well as monthly optional subtasks."
      }
    );
  }

  if (value.includes("trash") || value.includes("bin")) {
    suggestions.push(
      {
        title: "Replace bin liners",
        description: "Refill liners for kitchen and bathroom bins after emptying them.",
        area: "Utilities",
        frequencyInterval: 1,
        frequencyUnit: "week",
        isOptionalSubtask: false,
        rationale: "Emptying trash without liners creates repeat friction right away."
      },
      {
        title: "Sanitize bin lids",
        description: "Wipe down the bin lid and handle to avoid smells building up.",
        area: "Utilities",
        frequencyInterval: 1,
        frequencyUnit: "month",
        isOptionalSubtask: true,
        rationale: "This keeps the rolling trash task from becoming a bigger cleaning job every time."
      }
    );
  }

  if (suggestions.length === 0) {
    suggestions.push({
      title: `Deep clean ${input.title.toLowerCase()}`,
      description: "Create a less frequent deep-clean companion for the main recurring task.",
      area: input.area,
      frequencyInterval: input.taskMode === "rolling_until_done" ? 1 : 1,
      frequencyUnit: "month",
      isOptionalSubtask: true,
      rationale: "Every recurring task benefits from a deeper companion task on a slower cycle."
    });
  }

  return suggestions.slice(0, 4);
}

function heuristicHouseInsights(snapshot: HouseholdSnapshot): AiHouseInsight[] {
  const roommateLoad = new Map<number, number>();
  for (const chore of snapshot.chores.filter((item) => item.isActive && item.parentChoreId === null)) {
    if (chore.defaultAssigneeId) {
      roommateLoad.set(
        chore.defaultAssigneeId,
        (roommateLoad.get(chore.defaultAssigneeId) ?? 0) + 1
      );
    }
  }

  const overloaded = snapshot.roommates.find(
    (roommate) => (roommateLoad.get(roommate.id) ?? 0) > 1
  );
  const trashLike = snapshot.chores.find((chore) =>
    /trash|dishwasher|recycling/i.test(`${chore.title} ${chore.description ?? ""}`)
  );

  const insights: AiHouseInsight[] = [];

  if (overloaded) {
    insights.push({
      title: "Load is clumping on one roommate",
      impact: "high",
      recommendation: `${overloaded.name} is first up on multiple primary tasks. Inline coverage warnings help, but drag-to-reorder or one-tap rebalance would reduce setup friction even more.`
    });
  }

  if (trashLike && trashLike.taskMode !== "rolling_until_done") {
    insights.push({
      title: "A fill-based chore is still fixed-schedule",
      impact: "high",
      recommendation: `${trashLike.title} reads like a rolling ownership chore. Switching it to rolling-until-done will better match real household behaviour and reminders.`
    });
  }

  insights.push({
    title: "Heavy use tasks need one-tap controls",
    impact: "medium",
    recommendation: "For frequent admin actions, keep inline editing as the default and reserve full-screen editors for deeper configuration."
  });
  insights.push({
    title: "Subtasks should be suggested, not manually invented",
    impact: "medium",
    recommendation: "AI-assisted subtask generation is the right pattern for bathrooms, kitchens, and consumables because most users know the outcome they want but not the exact structure."
  });

  return insights.slice(0, 4);
}

async function createResponse(input: string) {
  if (!client) {
    return null;
  }

  let lastError: unknown = null;

  for (const model of uniqueModels()) {
    try {
      const response = await client.responses.create({
        model,
        input
      });

      return {
        model,
        text: response.output_text
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenAI request failed.");
}

export async function suggestSubtasksWithAi(input: {
  title: string;
  description: string;
  area: string;
  taskMode: TaskMode;
}) {
  const fallback = heuristicSubtasks(input);

  if (!client) {
    return {
      source: "heuristic" as const,
      model: null,
      suggestions: fallback
    };
  }

  try {
    const response = await createResponse(`
You are helping configure a shared-apartment chore system.
Suggest 3 or 4 practical subtasks for this parent chore.

Parent chore:
- title: ${input.title}
- description: ${input.description || "No description"}
- area: ${input.area}
- task mode: ${input.taskMode}

Return JSON only in this exact shape:
{"suggestions":[{"title":"...","description":"...","area":"...","frequencyInterval":1,"frequencyUnit":"week","isOptionalSubtask":false,"rationale":"..."}]}

Rules:
- Keep subtasks realistic for a shared flat.
- At least one suggestion should be a lower-frequency deep-clean or restock style subtask.
- Prefer week or month cadences for subtasks.
- Do not invent more than 4 subtasks.
    `);

    if (!response?.text) {
      return {
        source: "heuristic" as const,
        model: null,
        suggestions: fallback
      };
    }

    const parsed = JSON.parse(sanitizeJsonBlock(response.text)) as {
      suggestions?: AiSubtaskSuggestion[];
    };

    return {
      source: "openai" as const,
      model: response.model,
      suggestions: (parsed.suggestions ?? fallback).slice(0, 4)
    };
  } catch {
    return {
      source: "heuristic" as const,
      model: null,
      suggestions: fallback
    };
  }
}

export async function analyzeHouseholdFlowWithAi(snapshot: HouseholdSnapshot) {
  const fallback = heuristicHouseInsights(snapshot);

  if (!client) {
    return {
      source: "heuristic" as const,
      model: null,
      insights: fallback
    };
  }

  try {
    const response = await createResponse(`
You are auditing a roommate task-management app for usability and accountability.
Look at the household setup below and return 4 concise, high-signal findings.

Household summary:
${JSON.stringify(
  {
    roommates: snapshot.roommates.map((roommate) => ({
      name: roommate.name,
      pending: roommate.pendingCount,
      completed: roommate.completedCount,
      skipped: roommate.skippedCount,
      rescues: roommate.openPenaltyCount
    })),
    chores: snapshot.chores.map((chore) => ({
      title: chore.title,
      taskMode: chore.taskMode,
      assignee: chore.defaultAssigneeName,
      cadence: chore.cadence,
      isOptional: chore.isOptional,
      parent: chore.parentChoreTitle
    }))
  },
  null,
  2
)}

Return JSON only in this exact shape:
{"insights":[{"title":"...","impact":"high","recommendation":"..."}]}

Rules:
- Focus on product friction, setup friction, or accountability confusion.
- Prefer recommendations that simplify the flow.
- Do not give more than 4 findings.
    `);

    if (!response?.text) {
      return {
        source: "heuristic" as const,
        model: null,
        insights: fallback
      };
    }

    const parsed = JSON.parse(sanitizeJsonBlock(response.text)) as {
      insights?: AiHouseInsight[];
    };

    return {
      source: "openai" as const,
      model: response.model,
      insights: (parsed.insights ?? fallback).slice(0, 4)
    };
  } catch {
    return {
      source: "heuristic" as const,
      model: null,
      insights: fallback
    };
  }
}

function heuristicWhatsappIntent(body: string): AiWhatsappIntent {
  const normalized = body.trim().replace(/\s+/g, " ");
  const lowered = normalized.toLowerCase();
  const assignmentIdMatch = normalized.match(/#?(\d+)/);
  const assignmentId = assignmentIdMatch ? Number(assignmentIdMatch[1]) : null;

  if (!normalized) {
    return { action: "HELP", assignmentId: null, reason: null };
  }

  if (/^help\b/i.test(normalized)) {
    return { action: "HELP", assignmentId, reason: null };
  }

  if (/^tasks?\b/i.test(normalized)) {
    return { action: "TASKS", assignmentId, reason: null };
  }

  if (/^status\b/i.test(normalized)) {
    return { action: "STATUS", assignmentId, reason: null };
  }

  if (/^rescue\b/i.test(normalized) || lowered.includes("i did it for")) {
    return { action: "RESCUE", assignmentId, reason: null };
  }

  if (
    lowered.includes("can't do") ||
    lowered.includes("cant do") ||
    lowered.includes("cannot do") ||
    lowered.includes("skip and pass") ||
    lowered.includes("give it to the next") ||
    lowered.includes("assign it to the next") ||
    lowered.includes("not today")
  ) {
    return {
      action: "SKIP_REASSIGN",
      assignmentId,
      reason: normalized
    };
  }

  if (/^skip\b/i.test(normalized) || lowered.includes("skip")) {
    const rawReason = normalized.replace(/^skip\b\s*/i, "").trim();
    const reason = rawReason.replace(/^#?\d+\b\s*/, "").trim() || null;
    return {
      action: "SKIP",
      assignmentId,
      reason
    };
  }

  if (
    /^done\b/i.test(normalized) ||
    /^finished\b/i.test(normalized) ||
    /^completed\b/i.test(normalized) ||
    lowered.includes("i did it") ||
    lowered.includes("it's done") ||
    lowered.includes("it is done")
  ) {
    return { action: "DONE", assignmentId, reason: null };
  }

  return { action: "UNKNOWN", assignmentId, reason: null };
}

export async function interpretWhatsappIntentWithAi(input: {
  body: string;
  senderName: string | null;
  trustedProxy: boolean;
  lastReferencedAssignmentId: number | null;
  pendingAssignments: Array<{
    id: number;
    choreTitle: string;
    roommateName: string;
    dueDate: string;
  }>;
}) {
  const heuristic = heuristicWhatsappIntent(input.body);
  if (heuristic.action !== "UNKNOWN") {
    return {
      source: "heuristic" as const,
      model: null,
      intent: heuristic
    };
  }

  if (!client) {
    return {
      source: "heuristic" as const,
      model: null,
      intent: heuristic
    };
  }

  try {
    const response = await createResponse(`
You translate a WhatsApp message about a shared-apartment chore bot into a structured command.

Sender:
- name: ${input.senderName ?? "Unknown"}
- trusted proxy: ${input.trustedProxy ? "yes" : "no"}
- last referenced assignment id: ${input.lastReferencedAssignmentId ?? "none"}

Pending assignments:
${JSON.stringify(input.pendingAssignments, null, 2)}

Message:
${input.body}

Return JSON only in this exact shape:
{"action":"DONE","assignmentId":1,"reason":null}

Allowed actions:
- HELP
- TASKS
- STATUS
- DONE
- SKIP
- SKIP_REASSIGN
- RESCUE
- UNKNOWN

Rules:
- If the user says they cannot do it today or asks to pass it to the next person, use SKIP_REASSIGN.
- If the user says skip without handoff language, use SKIP.
- If the message is generic and there is a last referenced assignment id, use it.
- Only assign an assignmentId that appears in the pending assignments list, unless there is exactly one obvious pending item and the user is clearly referring to it.
- reason should be a short plain text reason or null.
    `);

    if (!response?.text) {
      return {
        source: "heuristic" as const,
        model: null,
        intent: heuristic
      };
    }

    const parsed = JSON.parse(sanitizeJsonBlock(response.text)) as AiWhatsappIntent;
    return {
      source: "openai" as const,
      model: response.model,
      intent: {
        action: parsed.action ?? "UNKNOWN",
        assignmentId: parsed.assignmentId ?? null,
        reason: parsed.reason ?? null
      }
    };
  } catch {
    return {
      source: "heuristic" as const,
      model: null,
      intent: heuristic
    };
  }
}
