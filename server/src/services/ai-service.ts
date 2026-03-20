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

export interface AiHouseholdQuestionAnswer {
  answer: string;
  canAnswer: boolean;
}

export interface AiWhatsappRoute {
  kind:
    | "HELP"
    | "COMMAND"
    | "QUESTION"
    | "ACTION"
    | "EXPENSE"
    | "SETTLEMENT"
    | "CONVERSATION_REPLY"
    | "UNKNOWN";
  command: "TASKS" | "WEEK" | "MONTH" | "STATUS" | null;
  action:
    | "DONE"
    | "SKIP"
    | "SKIP_REASSIGN"
    | "RESCHEDULE"
    | "RESCUE"
    | null;
  assignmentId: number | null;
  roommateName: string | null;
  choreTitle: string | null;
  reason: string | null;
  answer: string | null;
  expenseTitle: string | null;
  amountCents: number | null;
  excludedRoommateNames: string[];
  settlementToRoommateName: string | null;
  targetDate: string | null;
  replyType: "AFFIRMATIVE" | "NEGATIVE" | "TOMORROW" | "REASSIGN" | null;
  questionContextType:
    | "ROOMMATE_TASKS"
    | "ROOMMATE_COMPLETION"
    | "TASK_OWNER"
    | "DUE_OVERVIEW"
    | "COMPLETION_OVERVIEW"
    | "MISSED_OVERVIEW"
    | "RESCUE_OVERVIEW"
    | "PURCHASES"
    | "SCOREBOARD"
    | null;
  timeScope:
    | "TODAY"
    | "TOMORROW"
    | "THIS_WEEK"
    | "LAST_WEEK"
    | "THIS_MONTH"
    | "NEXT_WEEK"
    | "UPCOMING"
    | null;
}

type WhatsappMessageKind =
  | "weekly_heads_up"
  | "two_day_reminder"
  | "day_of_reminder"
  | "assignment_reminder"
  | "completion_check"
  | "escalation_nudge"
  | "resolution_options"
  | "rescue_request"
  | "handoff_notice"
  | "done_confirmation"
  | "skip_confirmation"
  | "rescue_confirmation"
  | "postpone_confirmation";

const client = hasOpenAiCredentials()
  ? new OpenAI({ apiKey: config.openAiApiKey })
  : null;

function formatDueTimingLabel(value?: string | null) {
  if (!value) {
    return null;
  }

  const due = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(due.getTime())) {
    return value;
  }

  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const dueDay = Date.UTC(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate()
  );
  const diffDays = Math.round((dueDay - today) / 86400000);

  if (diffDays === 0) {
    return "today";
  }

  if (diffDays === 1) {
    return "tomorrow";
  }

  return value;
}

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

function getWhatsappMessageRequirements(kind: WhatsappMessageKind) {
  switch (kind) {
    case "weekly_heads_up":
      return "Give a friendly start-of-week heads up that this task is coming later this week.";
    case "two_day_reminder":
      return "Remind them the task is coming up in two days and ask them to keep it on their radar.";
    case "day_of_reminder":
      return "Tell them the task is due today and ask them to message back when it is finished.";
    case "assignment_reminder":
      return "Tell them the task is theirs, mention the due timing, and ask politely if they could take care of it by today or tomorrow. It should feel like a roommate asking, not a command.";
    case "completion_check":
      return "Ask clearly whether they managed to finish it. Tell them to reply yes or no.";
    case "escalation_nudge":
      return "Be firmer. Say it is okay to forget once, but it needs sorting soon or it will count as a missed turn or a strike.";
    case "resolution_options":
      return "Offer exactly two options in plain language: push it to tomorrow, or assign someone else. Ask them to choose one.";
    case "rescue_request":
      return "Ask if they can pick this task up for the house because the original roommate is out. Tell them a simple yes is enough if they can take it.";
    case "handoff_notice":
      return "Tell them the task was handed to them and ask them to take care of it tonight.";
    case "done_confirmation":
      return "Confirm that the task is marked done. If the extra context mentions a streak, congratulate them like a Duolingo or Snapchat streak win, but keep it natural.";
    case "skip_confirmation":
      return "Confirm that the task was skipped or moved to the next roommate.";
    case "rescue_confirmation":
      return "Confirm that the task was rescued and that the original missed turn still stays on record.";
    case "postpone_confirmation":
      return "Confirm that the task was pushed to tomorrow and stayed with the same roommate.";
    default:
      return "Write a clear WhatsApp update.";
  }
}

function fallbackWhatsappConversationMessage(input: {
  kind: WhatsappMessageKind;
  roommateName: string;
  choreTitle: string;
  dueDate?: string | null;
  nextRoommateName?: string | null;
  contextNote?: string | null;
}) {
  const dueTiming = formatDueTimingLabel(input.dueDate);
  const duePhrase = dueTiming ? ` and it’s due ${dueTiming}` : "";

  switch (input.kind) {
    case "weekly_heads_up":
      return `Hey ${input.roommateName}, just a heads up that ${input.choreTitle} is yours later this week. Keep it in mind so it gets wrapped up on time 😃`;
    case "two_day_reminder":
      return `Hey ${input.roommateName}, just a reminder that ${input.choreTitle} is coming up in two days. Keep it on your radar 😅`;
    case "day_of_reminder":
      return `Hey ${input.roommateName}, ${input.choreTitle} is due today. Please get it done today and message me when it’s finished 😃`;
    case "assignment_reminder":
      return `Hey ${input.roommateName}, ${input.choreTitle} is yours${duePhrase}. Could you please take care of it by then 😅`;
    case "completion_check":
      return `Hey ${input.roommateName}, were you able to finish ${input.choreTitle}? Just reply yes or no 👀`;
    case "escalation_nudge":
      return `Hey ${input.roommateName}, just a nudge on ${input.choreTitle}. It’s okay to forget once, but please sort it soon or it’ll count as a missed turn and a strike 🚨`;
    case "resolution_options":
      return `No stress, it happens. Do you want me to push ${input.choreTitle} to tomorrow, or should I assign someone else so it gets done tonight 🙂`;
    case "rescue_request":
      return `Hey ${input.roommateName}, ${input.choreTitle} just opened up because someone can’t take it this week. Could you pick it up for the house by ${dueTiming ?? "the due time"}? If yes, just reply yes 🙂`;
    case "handoff_notice":
      return `Hey ${input.roommateName}, ${input.choreTitle} was handed over to you for tonight. Can you take care of it this evening and message me when it’s done 😃`;
    case "done_confirmation":
      return input.contextNote
        ? `Amazing, I marked ${input.choreTitle} as done 😍 ${input.contextNote} ♥️`
        : `Amazing, I marked ${input.choreTitle} as done 😍♥️`;
    case "skip_confirmation":
      return input.nextRoommateName
        ? `Okay, I moved ${input.choreTitle} to ${input.nextRoommateName} 😌`
        : `Okay, I marked ${input.choreTitle} as skipped 😌`;
    case "rescue_confirmation":
      return `Thank you, I marked ${input.choreTitle} as rescued 😍 The original turn still stays on record ♥️`;
    case "postpone_confirmation":
      return `Okay, I pushed ${input.choreTitle} to tomorrow and left it with you 😌`;
    default:
      return `Hey ${input.roommateName}, quick update about ${input.choreTitle}.`;
  }
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

export async function composeWhatsappConversationMessage(input: {
  kind: WhatsappMessageKind;
  roommateName: string;
  choreTitle: string;
  dueDate?: string | null;
  nextRoommateName?: string | null;
  contextNote?: string | null;
}) {
  const fallback = fallbackWhatsappConversationMessage(input);

  if (input.kind === "assignment_reminder") {
    return {
      source: "heuristic" as const,
      model: null,
      text: fallback
    };
  }

  if (!client) {
    return {
      source: "heuristic" as const,
      model: null,
      text: fallback
    };
  }

  try {
    const response = await createResponse(`
You write WhatsApp messages for a shared-apartment chore assistant.

Write one short, natural message.
It should feel human, clear, friendly, and lightly persuasive.
Use simple everyday English.
Do not use bullet points, markdown, labels, or quotation marks.
Keep it to 1 or 2 short sentences.
Use 1 or 2 fitting emojis.
Do not use hyphens, en dashes, or em dashes in the message.
Do not start the message with an emoji.
Prefer smiley or warm emojis like 😃 🙂 👀 🚨 😍 ♥️ when they fit the message.
Place emojis naturally in the middle or at the end, like a real text from a roommate.
Do not say "let me know if you need a hand".
Do not say "just checking in".
For reminder style messages, keep the opening natural, like a person texting another roommate.
For overdue nudges, use a firmer emoji like 👀 or 🚨.
For success or thanks, use warm celebratory emojis like 😍 or ♥️.
The goal is to get the roommate to actually finish the task.
If the task is overdue, be warmer but firmer.
It is okay to mention that leaving it open can lead to a missed turn or a strike, but do it casually and not like a legal warning.
Make the phrasing sound like a real roommate wrote it, not a bot or system notification.
Do not make it sound like an instruction or command.
Prefer phrasing like "could you", "would you mind", or "when you get a chance" when it fits.
For assignment reminders, the tone should feel cooperative and polite, not managerial.
If a due date or due timing is provided, keep it exact and do not soften or blur it.
Do not rewrite an exact due date into vague phrases like "around today or tomorrow".

Message type: ${input.kind}
Roommate name: ${input.roommateName}
Chore: ${input.choreTitle}
Due date context: ${input.dueDate ?? "not provided"}
Next roommate if relevant: ${input.nextRoommateName ?? "not relevant"}
Extra context if relevant: ${input.contextNote ?? "none"}
Required content: ${getWhatsappMessageRequirements(input.kind)}
    `);

    const text = response?.text?.trim();
    if (!response || !text) {
      return {
        source: "heuristic" as const,
        model: null,
        text: fallback
      };
    }

    return {
      source: "openai" as const,
      model: response.model,
      text
    };
  } catch {
    return {
      source: "heuristic" as const,
      model: null,
      text: fallback
    };
  }
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

export async function routeWhatsappMessageWithAi(input: {
  body: string;
  senderName: string | null;
  trustedProxy: boolean;
  lastReferencedAssignmentId: number | null;
  latestPromptType: string | null;
  candidateAssignments: Array<{
    id: number;
    choreTitle: string;
    roommateName: string;
    dueDate: string;
    status: string;
  }>;
  snapshot: {
    todayDate: string;
    timezone?: string | null;
    roommates: Array<{
      id: number;
      name: string;
      isActive: number;
      pendingCount: number;
      completedCount: number;
      skippedCount: number;
      openPenaltyCount: number;
    }>;
    assignments: Array<{
      id: number;
      choreTitle: string;
      roommateName: string;
      roommateId: number;
      dueDate: string;
      status: string;
      statusNote?: string | null;
      resolutionType?: string | null;
      responsibleRoommateName?: string | null;
      rescuedByRoommateName?: string | null;
      completedAt?: string | null;
      escalationLevel?: number;
      strikeApplied?: number;
      rescueCreditApplied?: number;
      completedByRoommateName?: string | null;
      points: number;
      frequencyUnit: string;
      taskMode: string;
    }>;
    balances: Array<{
      fromRoommateName: string;
      toRoommateName: string;
      amountCents: number;
    }>;
    expenses: Array<{
      title: string;
      amountCents: number;
      paidByRoommateName: string;
      createdAt: string;
    }>;
    recentEvents?: Array<{
      eventType: string;
      roommateName: string | null;
      createdAt: string;
      payloadJson: string | null;
    }>;
    derived?: {
      currentWeek: { start: string; end: string };
      lastWeek: { start: string; end: string };
      dueToday: Array<Record<string, unknown>>;
      dueThisWeek: Array<Record<string, unknown>>;
      completedThisWeek: Array<Record<string, unknown>>;
      rescuedThisWeek: Array<Record<string, unknown>>;
      missedThisWeek: Array<Record<string, unknown>>;
      lastWeekAssignments: Array<Record<string, unknown>>;
    };
  };
  latestHouseQuestionContext?: {
    type: string | null;
    roommateName?: string | null;
    choreTitle?: string | null;
    timeScope?: string | null;
  } | null;
}) {
  const fallback: AiWhatsappRoute = {
    kind: "UNKNOWN",
    command: null,
    action: null,
    assignmentId: null,
    roommateName: null,
    choreTitle: null,
    reason: null,
    answer: null,
    expenseTitle: null,
    amountCents: null,
    excludedRoommateNames: [],
    settlementToRoommateName: null,
    targetDate: null,
    replyType: null,
    questionContextType: null,
    timeScope: null
  };

  if (!client) {
    return {
      source: "openai_unavailable" as const,
      model: null,
      route: fallback
    };
  }

  try {
    const response = await createResponse(`
You are the single WhatsApp router for a shared-apartment assistant.

Your job is to read the message and decide exactly one of these:
- HELP
- COMMAND
- QUESTION
- ACTION
- EXPENSE
- SETTLEMENT
- CONVERSATION_REPLY
- UNKNOWN

Sender:
- name: ${input.senderName ?? "Unknown"}
- trusted proxy: ${input.trustedProxy ? "yes" : "no"}
- last referenced assignment id: ${input.lastReferencedAssignmentId ?? "none"}
- latest open conversation prompt type: ${input.latestPromptType ?? "none"}
- latest house question context: ${JSON.stringify(input.latestHouseQuestionContext ?? null)}

Candidate assignments for action resolution:
${JSON.stringify(input.candidateAssignments, null, 2)}

Live household snapshot:
${JSON.stringify(input.snapshot, null, 2)}

Message:
${input.body}

Return JSON only in this exact shape:
{
  "kind":"ACTION",
  "command":null,
  "action":"DONE",
  "assignmentId":1,
  "roommateName":null,
  "choreTitle":"Taking Out Trash",
  "reason":null,
  "answer":null,
  "expenseTitle":null,
  "amountCents":null,
  "excludedRoommateNames":[],
  "settlementToRoommateName":null,
  "targetDate":null,
  "replyType":null,
  "questionContextType":null,
  "timeScope":null
}

Rules:
- This is GPT-first routing. Do not assume the caller already classified the message.
- Every non-empty inbound WhatsApp message should be treated as natural language first, even if it looks short, colloquial, or messy.
- For exact commands like TASKS, WEEK, MONTH, STATUS, return kind COMMAND and fill command.
- For direct questions about chores, roommates, money, due dates, free week, scoreboard, or who owns a task, return kind QUESTION and write the answer directly in answer.
- For direct questions about what is due, what was completed, who missed, who rescued, who owns a task, or what happened last week, return kind QUESTION and answer directly from the snapshot.
- If the message is asking for information, prefer QUESTION instead of UNKNOWN.
- For action messages, return kind ACTION and use action DONE, SKIP, SKIP_REASSIGN, RESCHEDULE, or RESCUE.
- Prefer selecting assignmentId from the candidate assignments whenever possible.
- Use choreTitle and roommateName to disambiguate even when assignmentId is null.
- If the message says someone else's task was completed by the sender, use action RESCUE.
- If the message says they cannot do it and want it passed on, use SKIP_REASSIGN.
- If the message proposes a specific future day/date for the same task (for example "I can do it Sunday"), use RESCHEDULE and fill targetDate as YYYY-MM-DD.
- If the message says they skipped it but does not ask for handoff, use SKIP.
- For natural completions, understand many phrasings like tossed the trash out, threw the bins out, took the trash out, handled it, sorted it, got it done, finished up, wrapped it up, took care of it.
- Understand task aliases broadly:
  - trash, bins, garbage, recycling, plastic, glass
  - towels, towel duty, towel cleaning
  - dishwasher, unload dishwasher, run dishwasher
  - bathroom, kitchen, hallway, living room, toilet
- If the user asks a question like "who is taking trash out" or "did Varun finish his task", do not return ACTION. Return QUESTION with a direct answer.
- Questions like "whose tasks are due", "who finished their tasks", "who did what last week", "did Noah finish his task last week", "who missed", and "who rescued" should all be answered from the snapshot.
- Use snapshot.derived as the source of truth for due/completed/missed/rescued/last-week questions whenever possible.
- "Due" means pending tasks in the asked scope, not all future assignments.
- "Finished" means tasks with status done in the asked scope. If a task was rescued, say who actually completed it.
- "Did Noah finish his task last week" should answer whether Noah personally completed it. If Maria rescued it, answer "No, Noah did not finish it; Maria rescued/completed it."
- "Who missed the task" means overdue or struck/missed assignments, not chores that are merely due later today.
- "Who rescued" should mention the roommate(s) in snapshot.derived.rescuedThisWeek or the most recent rescue in context.
- Follow-up phrasing like "what about Tracy?", "and next week?", or "who after that?" should still be answered from the provided snapshot and latest context when possible.
- When returning QUESTION, fill questionContextType and timeScope whenever you can so future follow-ups stay grounded.
- If the message is an expense, return kind EXPENSE with expenseTitle, amountCents, and excludedRoommateNames.
- If the message is a settlement like "I paid Varun 8 euros", return kind SETTLEMENT with amountCents and settlementToRoommateName.
- If the message is replying to an open prompt, return kind CONVERSATION_REPLY and set replyType to AFFIRMATIVE, NEGATIVE, TOMORROW, or REASSIGN.
- Only return CONVERSATION_REPLY for short direct replies like "yes", "no", "tomorrow", "assign someone else", "reassign it", or similarly short follow-ups.
- If the message contains a real chore description, a roommate name, a question like who/what/when/did/whose, or a new action like "I tossed the trash out", do not force it into CONVERSATION_REPLY just because a prompt is open.
- If there is no safe interpretation, return UNKNOWN.
- Never invent assignments or people that do not exist in the provided data.
    `);

    if (!response?.text) {
      return {
        source: "heuristic" as const,
        model: null,
        route: fallback
      };
    }

    const parsed = JSON.parse(sanitizeJsonBlock(response.text)) as Partial<AiWhatsappRoute>;

    return {
      source: "openai" as const,
      model: response.model,
      route: {
        kind: parsed.kind ?? "UNKNOWN",
        command:
          parsed.command === "TASKS" ||
          parsed.command === "WEEK" ||
          parsed.command === "MONTH" ||
          parsed.command === "STATUS"
            ? parsed.command
            : null,
        action:
          parsed.action === "DONE" ||
          parsed.action === "SKIP" ||
          parsed.action === "SKIP_REASSIGN" ||
          parsed.action === "RESCHEDULE" ||
          parsed.action === "RESCUE"
            ? parsed.action
            : null,
        assignmentId:
          typeof parsed.assignmentId === "number" ? parsed.assignmentId : null,
        roommateName: parsed.roommateName ?? null,
        choreTitle: parsed.choreTitle ?? null,
        reason: parsed.reason ?? null,
        answer: parsed.answer ?? null,
        expenseTitle: parsed.expenseTitle ?? null,
        amountCents:
          typeof parsed.amountCents === "number" ? parsed.amountCents : null,
        excludedRoommateNames: Array.isArray(parsed.excludedRoommateNames)
          ? parsed.excludedRoommateNames
              .map((value) => String(value).trim())
              .filter(Boolean)
          : [],
        settlementToRoommateName: parsed.settlementToRoommateName ?? null,
        targetDate:
          typeof parsed.targetDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(parsed.targetDate)
            ? parsed.targetDate
            : null,
        replyType:
          parsed.replyType === "AFFIRMATIVE" ||
          parsed.replyType === "NEGATIVE" ||
          parsed.replyType === "TOMORROW" ||
          parsed.replyType === "REASSIGN"
            ? parsed.replyType
            : null,
        questionContextType:
          parsed.questionContextType === "ROOMMATE_TASKS" ||
          parsed.questionContextType === "ROOMMATE_COMPLETION" ||
          parsed.questionContextType === "TASK_OWNER" ||
          parsed.questionContextType === "DUE_OVERVIEW" ||
          parsed.questionContextType === "COMPLETION_OVERVIEW" ||
          parsed.questionContextType === "MISSED_OVERVIEW" ||
          parsed.questionContextType === "RESCUE_OVERVIEW" ||
          parsed.questionContextType === "PURCHASES" ||
          parsed.questionContextType === "SCOREBOARD"
            ? parsed.questionContextType
            : null,
        timeScope:
          parsed.timeScope === "TODAY" ||
          parsed.timeScope === "TOMORROW" ||
          parsed.timeScope === "THIS_WEEK" ||
          parsed.timeScope === "LAST_WEEK" ||
          parsed.timeScope === "THIS_MONTH" ||
          parsed.timeScope === "NEXT_WEEK" ||
          parsed.timeScope === "UPCOMING"
            ? parsed.timeScope
            : null
      }
    };
  } catch {
    return {
      source: "openai_error" as const,
      model: null,
      route: fallback
    };
  }
}
