import { isTrustedProxyWhatsappNumber } from "../config.js";
import type { Assignment, CommandResult } from "../lib/types.js";
import { interpretWhatsappIntentWithAi } from "./ai-service.js";
import {
  addEventLog,
  findRoommateByWhatsappNumber,
  getAssignmentById,
  getOldestPendingAssignment,
  handoffAssignmentToNextRoommate,
  listAllPendingAssignments,
  listPendingAssignmentsForRoommate,
  listRecentEvents,
  rescueAssignment,
  updateAssignmentStatus
} from "./task-service.js";
import {
  resolveOutboundWhatsappNumber,
  sendWhatsappMessage
} from "./twilio-service.js";

const lastOutboundAssignmentByWhatsapp = new Map<string, number>();
const MATCH_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "have",
  "just",
  "from",
  "into",
  "your",
  "my",
  "our",
  "his",
  "her",
  "their",
  "today",
  "right",
  "now",
  "already",
  "really",
  "about",
  "around",
  "task",
  "chore",
  "please",
  "cant",
  "cannot",
  "dont",
  "didnt",
  "skip",
  "done",
  "finish",
  "finished",
  "completed",
  "rescue",
  "rescued",
  "help",
  "status",
  "tasks"
]);
type ActionableIntentAction = "DONE" | "SKIP" | "SKIP_REASSIGN" | "RESCUE";

function normalizeBody(body: string) {
  return body.trim().replace(/\s+/g, " ");
}

function buildHelpMessage() {
  return [
    "Just reply in plain English:",
    '"I finished the kitchen"',
    '"I can\'t do trash today, pass it on"',
    '"I did Noah\'s trash for him"',
    "",
    "Fallback commands still work:",
    "TASKS - show open chores",
    "STATUS - show house summary",
    "DONE [id]",
    "SKIP [id] [reason]",
    "RESCUE [id]"
  ].join("\n");
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenizeMatchText(value: string) {
  return normalizeMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) => token.length > 2 && !MATCH_STOP_WORDS.has(token)
    );
}

function isGenericAssignmentReference(body: string) {
  const lowered = normalizeMatchText(body);
  return (
    /^(done|finished|completed|skip|rescued?|tasks?|status|help)\b/.test(lowered) ||
    lowered.includes("i did it") ||
    lowered.includes("it s done") ||
    lowered.includes("its done") ||
    lowered.includes("it is done") ||
    lowered.includes("can t do it") ||
    lowered.includes("cant do it") ||
    lowered.includes("cannot do it") ||
    lowered.includes("pass it on") ||
    lowered.includes("give it to the next")
  );
}

function scoreAssignmentMatch(
  body: string,
  assignment: {
    id: number;
    choreTitle: string;
    roommateName: string;
  }
) {
  const normalizedBody = normalizeMatchText(body);
  const bodyTokens = new Set(tokenizeMatchText(body));
  let score = 0;

  const normalizedTitle = normalizeMatchText(assignment.choreTitle);
  const normalizedRoommate = normalizeMatchText(assignment.roommateName);

  if (normalizedTitle && normalizedBody.includes(normalizedTitle)) {
    score += 12;
  }

  if (normalizedRoommate && normalizedBody.includes(normalizedRoommate)) {
    score += 8;
  }

  for (const token of new Set(tokenizeMatchText(assignment.choreTitle))) {
    if (bodyTokens.has(token)) {
      score += 3;
    }
  }

  for (const token of new Set(tokenizeMatchText(assignment.roommateName))) {
    if (bodyTokens.has(token)) {
      score += 4;
    }
  }

  if (
    normalizedBody.includes("for him") ||
    normalizedBody.includes("for her") ||
    normalizedBody.includes("for them")
  ) {
    score += 1;
  }

  return score;
}

function resolveAssignmentFromContext(input: {
  body: string;
  action: "DONE" | "SKIP" | "SKIP_REASSIGN" | "RESCUE";
  pendingAssignments: Array<{
    id: number;
    choreTitle: string;
    roommateName: string;
    dueDate: string;
  }>;
  lastReferencedAssignmentId: number | null;
}) {
  const { body, action, pendingAssignments, lastReferencedAssignmentId } = input;

  if (pendingAssignments.length === 0) {
    return {
      assignmentId: null,
      ambiguous: false
    };
  }

  if (pendingAssignments.length === 1) {
    return {
      assignmentId: pendingAssignments[0]?.id ?? null,
      ambiguous: false
    };
  }

  if (lastReferencedAssignmentId && isGenericAssignmentReference(body)) {
    const referenced = pendingAssignments.find(
      (assignment) => assignment.id === lastReferencedAssignmentId
    );
    if (referenced) {
      return {
        assignmentId: referenced.id,
        ambiguous: false
      };
    }
  }

  const scored = pendingAssignments
    .map((assignment) => ({
      assignment,
      score: scoreAssignmentMatch(body, assignment)
    }))
    .sort((left, right) => right.score - left.score);

  const top = scored[0];
  const second = scored[1];

  if (
    top &&
    (
      (top.score >= 4 && (!second || top.score >= second.score + 2)) ||
      (top.score >= 3 && (!second || second.score === 0))
    )
  ) {
    return {
      assignmentId: top.assignment.id,
      ambiguous: false
    };
  }

  const hasAnySignal = Boolean(top && top.score > 0);

  return {
    assignmentId: null,
    ambiguous: hasAnySignal,
    suggestions: scored
      .filter((entry) => entry.score > 0)
      .slice(0, 3)
      .map((entry) => entry.assignment),
    action
  };
}

function buildClarifyAssignmentMessage(input: {
  action: "DONE" | "SKIP" | "SKIP_REASSIGN" | "RESCUE";
  trustedProxy: boolean;
  pendingAssignments: Array<{
    id: number;
    choreTitle: string;
    roommateName: string;
    dueDate: string;
  }>;
  suggestions?: Array<{
    id: number;
    choreTitle: string;
    roommateName: string;
    dueDate: string;
  }>;
}) {
  const actionLabel =
    input.action === "RESCUE"
      ? "rescue"
      : input.action === "DONE"
        ? "mark as done"
        : "skip";
  const candidates = (input.suggestions && input.suggestions.length > 0
    ? input.suggestions
    : input.pendingAssignments
  ).slice(0, 3);

  const lines = candidates.map(
    (assignment) =>
      `#${assignment.id} ${assignment.roommateName}: ${assignment.choreTitle}`
  );

  const examples = input.trustedProxy
    ? [
        '"I finished Mayssa\'s kitchen task"',
        '"Skip Varun\'s trash today"',
        '"I rescued Noah\'s bathroom task"'
      ]
    : [
        '"I finished the kitchen"',
        '"Skip the trash today"',
        '"I rescued Noah\'s trash"'
      ];

  return [
    `I couldn't tell which chore to ${actionLabel}.`,
    "Say it with the roommate or task name, for example:",
    ...examples,
    "",
    "Possible open chores:",
    ...lines
  ].join("\n");
}

export function rememberLastOutboundAssignment(
  whatsappNumber: string,
  assignmentId: number
) {
  lastOutboundAssignmentByWhatsapp.set(whatsappNumber, assignmentId);
}

function getLastReferencedAssignmentId(whatsappNumber: string) {
  return lastOutboundAssignmentByWhatsapp.get(whatsappNumber) ?? null;
}

function buildTasksMessage(whatsappNumber: string) {
  const roommate = findRoommateByWhatsappNumber(whatsappNumber);
  if (!roommate) {
    return "Your number is not registered yet. Ask the admin to add you first.";
  }

  const assignments = listPendingAssignmentsForRoommate(roommate.id);
  if (assignments.length === 0) {
    return `No open chores for ${roommate.name}.`;
  }

  const lines = assignments.map(
    (assignment) =>
      `#${assignment.id} ${assignment.choreTitle} - due ${assignment.dueDate}`
  );

  return [`Open chores for ${roommate.name}:`, ...lines].join("\n");
}

function buildStatusMessage() {
  const pendingAssignments = listAllPendingAssignments();
  const events = listRecentEvents(5) as Array<{
    eventType: string;
    createdAt: string;
    roommateName: string | null;
  }>;

  const pendingLines =
    pendingAssignments.length > 0
      ? pendingAssignments.map(
          (assignment) =>
            `#${assignment.id} ${assignment.roommateName}: ${assignment.choreTitle} (${assignment.dueDate})`
        )
      : ["No pending chores."];

  const eventLines =
    events.length > 0
      ? events.map(
          (event) =>
            `${event.createdAt.slice(0, 16).replace("T", " ")} ${event.roommateName ?? "System"} ${event.eventType}`
        )
      : ["No recent events."];

  return ["Pending chores:", ...pendingLines, "", "Recent activity:", ...eventLines].join(
    "\n"
  );
}

function resolveAssignmentId(
  roommateId: number | null,
  rawId?: string,
  fallbackAssignmentId?: number | null
) {
  if (rawId) {
    const parsed = Number(rawId);
    return Number.isInteger(parsed) ? parsed : null;
  }

  if (fallbackAssignmentId) {
    return fallbackAssignmentId;
  }

  if (!roommateId) {
    return null;
  }

  const assignment = getOldestPendingAssignment(roommateId);
  return assignment?.id ?? null;
}

function canOperateOnAssignment(
  assignment: Assignment,
  actorRoommateId: number | null,
  trustedProxy: boolean
) {
  if (trustedProxy) {
    return true;
  }

  return assignment.roommateId === actorRoommateId;
}

function getPendingAssignmentsForInterpretation(
  actorRoommateId: number | null,
  trustedProxy: boolean
) {
  const assignments = trustedProxy
    ? listAllPendingAssignments()
    : actorRoommateId
      ? listPendingAssignmentsForRoommate(actorRoommateId)
      : [];

  return assignments.map((assignment) => ({
    id: assignment.id,
    choreTitle: assignment.choreTitle,
    roommateName: assignment.roommateName,
    dueDate: assignment.dueDate
  }));
}

async function notifyAssignmentHandoff(reassigned: Assignment) {
  const outboundTo = resolveOutboundWhatsappNumber(reassigned.whatsappNumber);
  const message = [
    `${reassigned.roommateName}, you are now up for ${reassigned.choreTitle}.`,
    `Due date: ${reassigned.dueDate}`,
    'Reply naturally, for example "I finished it" or "I can\'t do it today, pass it on".',
    `Fallback: DONE ${reassigned.id} or SKIP ${reassigned.id} <reason>.`
  ].join("\n");

  try {
    await sendWhatsappMessage(reassigned.whatsappNumber, message);
    rememberLastOutboundAssignment(outboundTo, reassigned.id);
    addEventLog({
      roommateId: reassigned.roommateId,
      assignmentId: reassigned.id,
      eventType: "HANDOFF_MESSAGE_SENT",
      payload: JSON.stringify({
        originalTo: reassigned.whatsappNumber,
        effectiveTo: outboundTo
      })
    });
  } catch (error) {
    addEventLog({
      roommateId: reassigned.roommateId,
      assignmentId: reassigned.id,
      eventType: "HANDOFF_MESSAGE_FAILED",
      payload: JSON.stringify({
        error: error instanceof Error ? error.message : "unknown"
      })
    });
  }
}

function handleDone(
  actor: { whatsappNumber: string; roommateId: number | null; trustedProxy: boolean },
  assignmentIdInput?: string,
  fallbackAssignmentId?: number | null
): CommandResult {
  const assignmentId = resolveAssignmentId(
    actor.roommateId,
    assignmentIdInput,
    fallbackAssignmentId
  );
  if (!assignmentId) {
    return { message: "No pending chore found to mark as done." };
  }

  const assignment = getAssignmentById(assignmentId);
  if (!assignment || !canOperateOnAssignment(assignment, actor.roommateId, actor.trustedProxy)) {
    return { message: `Assignment #${assignmentId} is not available for this sender.` };
  }

  if (assignment.status !== "pending") {
    return { message: `Assignment #${assignmentId} is already ${assignment.status}.` };
  }

  updateAssignmentStatus(assignmentId, "done", null);
  addEventLog({
    roommateId: actor.roommateId,
    assignmentId,
    eventType: "DONE",
    payload: JSON.stringify({
      source: "whatsapp",
      trustedProxy: actor.trustedProxy
    })
  });

  return {
    message: `Marked #${assignmentId} ${assignment.choreTitle} as done.`,
    assignmentId
  };
}

function handleSkip(
  actor: { whatsappNumber: string; roommateId: number | null; trustedProxy: boolean },
  assignmentIdInput?: string,
  reason?: string,
  reassignToNext = false,
  fallbackAssignmentId?: number | null
): Promise<CommandResult> | CommandResult {
  const assignmentId = resolveAssignmentId(
    actor.roommateId,
    assignmentIdInput,
    fallbackAssignmentId
  );
  if (!assignmentId) {
    return { message: "No pending chore found to skip." };
  }

  const assignment = getAssignmentById(assignmentId);
  if (!assignment || !canOperateOnAssignment(assignment, actor.roommateId, actor.trustedProxy)) {
    return { message: `Assignment #${assignmentId} is not available for this sender.` };
  }

  if (assignment.status !== "pending") {
    return { message: `Assignment #${assignmentId} is already ${assignment.status}.` };
  }

  updateAssignmentStatus(assignmentId, "skipped", reason ?? null);
  addEventLog({
    roommateId: actor.roommateId,
    assignmentId,
    eventType: reassignToNext ? "SKIP_REASSIGN" : "SKIP",
    payload: JSON.stringify({
      source: "whatsapp",
      reason: reason ?? null,
      trustedProxy: actor.trustedProxy
    })
  });

  if (!reassignToNext) {
    return {
      message: `Marked #${assignmentId} ${assignment.choreTitle} as skipped.${reason ? ` Reason: ${reason}` : ""}`,
      assignmentId
    };
  }

  const reassigned = handoffAssignmentToNextRoommate(assignmentId, reason ?? null);
  if (!reassigned) {
    return {
      message: `Marked #${assignmentId} ${assignment.choreTitle} as skipped, but there was no next roommate available for handoff.`,
      assignmentId
    };
  }

  return notifyAssignmentHandoff(reassigned).then(() => ({
    message: `Marked #${assignmentId} ${assignment.choreTitle} as skipped and handed it to ${reassigned.roommateName} as #${reassigned.id}.`,
    assignmentId
  }));
}

function handleRescue(
  actor: { whatsappNumber: string; roommateId: number | null; trustedProxy: boolean },
  assignmentIdInput?: string,
  fallbackAssignmentId?: number | null
): CommandResult {
  if (!actor.roommateId && !actor.trustedProxy) {
    return {
      message: "Your number is not registered yet. Ask the admin to add you first."
    };
  }

  const assignmentId = resolveAssignmentId(
    actor.roommateId,
    assignmentIdInput,
    fallbackAssignmentId
  );
  if (!assignmentId || !Number.isInteger(assignmentId)) {
    return { message: "Use RESCUE [id] to rescue a specific chore." };
  }

  const assignment = getAssignmentById(assignmentId);
  if (!assignment) {
    return { message: `Assignment #${assignmentId} was not found.` };
  }

  if (assignment.status !== "pending") {
    return { message: `Assignment #${assignmentId} is already ${assignment.status}.` };
  }

  const rescuerRoommateId = actor.roommateId ?? assignment.roommateId;
  const rescued = rescueAssignment(assignmentId, rescuerRoommateId, "rescued via WhatsApp");
  if (!rescued) {
    return { message: `Unable to rescue assignment #${assignmentId} right now.` };
  }

  addEventLog({
    roommateId: rescuerRoommateId,
    assignmentId,
    eventType: "RESCUE",
    payload: JSON.stringify({
      source: "whatsapp",
      responsibleRoommateId: assignment.roommateId,
      trustedProxy: actor.trustedProxy
    })
  });

  return {
    message: `Marked #${assignmentId} ${assignment.choreTitle} as rescued by ${rescued.rescuedByRoommateName ?? "the house"}. ${assignment.roommateName} keeps the missed turn on record.`,
    assignmentId
  };
}

export async function processInboundMessage(params: {
  body: string;
  from: string;
}): Promise<CommandResult> {
  const normalized = normalizeBody(params.body);
  if (!normalized) {
    return { message: buildHelpMessage() };
  }

  const trustedProxy = isTrustedProxyWhatsappNumber(params.from);
  const actorRoommate = findRoommateByWhatsappNumber(params.from);
  const actor = {
    whatsappNumber: params.from,
    roommateId: actorRoommate?.id ?? null,
    trustedProxy
  };

  if (!actorRoommate && !trustedProxy) {
    return {
      message: "Your number is not registered yet. Ask the admin to add you first."
    };
  }

  const pendingAssignments = getPendingAssignmentsForInterpretation(
    actor.roommateId,
    trustedProxy
  );
  const interpretation = await interpretWhatsappIntentWithAi({
    body: normalized,
    senderName: actorRoommate?.name ?? (trustedProxy ? "Trusted proxy" : null),
    trustedProxy,
    lastReferencedAssignmentId: getLastReferencedAssignmentId(params.from),
    pendingAssignments
  });
  const intent = interpretation.intent;
  const actionableAction: ActionableIntentAction | null =
    intent.action === "DONE"
      ? "DONE"
      : intent.action === "SKIP"
        ? "SKIP"
        : intent.action === "SKIP_REASSIGN"
          ? "SKIP_REASSIGN"
          : intent.action === "RESCUE"
            ? "RESCUE"
            : null;
  const resolvedAssignment =
    actionableAction && !intent.assignmentId
      ? resolveAssignmentFromContext({
          body: normalized,
          action: actionableAction,
          pendingAssignments,
          lastReferencedAssignmentId: getLastReferencedAssignmentId(params.from)
        })
      : {
          assignmentId: intent.assignmentId,
          ambiguous: false
        };
  const finalAssignmentId = intent.assignmentId ?? resolvedAssignment.assignmentId ?? null;
  const assignmentIdInput = finalAssignmentId ? String(finalAssignmentId) : undefined;
  const resolutionSuggestions =
    "suggestions" in resolvedAssignment ? resolvedAssignment.suggestions : undefined;

  addEventLog({
    roommateId: actor.roommateId,
    assignmentId: finalAssignmentId,
    eventType: "WHATSAPP_INTENT_INTERPRETED",
    payload: JSON.stringify({
      source: interpretation.source,
      model: interpretation.model,
      action: intent.action,
      resolvedAssignmentId: finalAssignmentId,
      trustedProxy
    })
  });

  if (intent.action === "HELP") {
    return { message: buildHelpMessage() };
  }

  if (intent.action === "TASKS") {
    if (trustedProxy) {
      return { message: buildStatusMessage() };
    }

    return { message: buildTasksMessage(params.from) };
  }

  if (intent.action === "STATUS") {
    return { message: buildStatusMessage() };
  }

  if (intent.action === "DONE") {
    if (!assignmentIdInput) {
      return {
        message: buildClarifyAssignmentMessage({
          action: intent.action,
          trustedProxy,
          pendingAssignments,
          suggestions: resolutionSuggestions
        })
      };
    }

    return handleDone(actor, assignmentIdInput, finalAssignmentId);
  }

  if (intent.action === "SKIP") {
    if (!assignmentIdInput) {
      return {
        message: buildClarifyAssignmentMessage({
          action: intent.action,
          trustedProxy,
          pendingAssignments,
          suggestions: resolutionSuggestions
        })
      };
    }

    return handleSkip(
      actor,
      assignmentIdInput,
      intent.reason ?? undefined,
      false,
      finalAssignmentId
    );
  }

  if (intent.action === "SKIP_REASSIGN") {
    if (!assignmentIdInput) {
      return {
        message: buildClarifyAssignmentMessage({
          action: intent.action,
          trustedProxy,
          pendingAssignments,
          suggestions: resolutionSuggestions
        })
      };
    }

    return handleSkip(
      actor,
      assignmentIdInput,
      intent.reason ?? undefined,
      true,
      finalAssignmentId
    );
  }

  if (intent.action === "RESCUE") {
    if (!assignmentIdInput) {
      return {
        message: buildClarifyAssignmentMessage({
          action: intent.action,
          trustedProxy,
          pendingAssignments,
          suggestions: resolutionSuggestions
        })
      };
    }

    return handleRescue(actor, assignmentIdInput, finalAssignmentId);
  }

  return {
    message: `I did not understand "${normalized}".\n\n${buildHelpMessage()}`
  };
}
