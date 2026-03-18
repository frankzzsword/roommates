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

function normalizeBody(body: string) {
  return body.trim().replace(/\s+/g, " ");
}

function buildHelpMessage() {
  return [
    "Commands:",
    "HELP - show this help",
    "TASKS - your pending chores",
    "STATUS - house summary",
    "DONE [id] - mark a chore complete",
    "SKIP [id] [reason] - mark a chore skipped",
    "RESCUE [id] - close someone else's overdue or escalated chore",
    "",
    "Natural language also works:",
    "\"I can't do it today, skip\"",
    "\"Done with bathroom\"",
    "\"Rescue 3\""
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
    `New handoff: ${reassigned.roommateName} is now up for ${reassigned.choreTitle}.`,
    `Due date: ${reassigned.dueDate}`,
    `Reply DONE ${reassigned.id} when finished.`,
    `If you cannot do it, reply "I can't do it today, skip".`
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

  const interpretation = await interpretWhatsappIntentWithAi({
    body: normalized,
    senderName: actorRoommate?.name ?? (trustedProxy ? "Trusted proxy" : null),
    trustedProxy,
    lastReferencedAssignmentId: getLastReferencedAssignmentId(params.from),
    pendingAssignments: getPendingAssignmentsForInterpretation(actor.roommateId, trustedProxy)
  });
  const intent = interpretation.intent;
  const assignmentIdInput = intent.assignmentId ? String(intent.assignmentId) : undefined;

  addEventLog({
    roommateId: actor.roommateId,
    assignmentId: intent.assignmentId ?? null,
    eventType: "WHATSAPP_INTENT_INTERPRETED",
    payload: JSON.stringify({
      source: interpretation.source,
      model: interpretation.model,
      action: intent.action,
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
    return handleDone(actor, assignmentIdInput, intent.assignmentId);
  }

  if (intent.action === "SKIP") {
    return handleSkip(
      actor,
      assignmentIdInput,
      intent.reason ?? undefined,
      false,
      intent.assignmentId
    );
  }

  if (intent.action === "SKIP_REASSIGN") {
    return handleSkip(
      actor,
      assignmentIdInput,
      intent.reason ?? undefined,
      true,
      intent.assignmentId
    );
  }

  if (intent.action === "RESCUE") {
    return handleRescue(actor, assignmentIdInput, intent.assignmentId);
  }

  return {
    message: `I did not understand "${normalized}".\n\n${buildHelpMessage()}`
  };
}
