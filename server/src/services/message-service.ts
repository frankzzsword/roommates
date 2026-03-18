import { isTrustedProxyWhatsappNumber } from "../config.js";
import type { Assignment, CommandResult } from "../lib/types.js";
import {
  composeWhatsappConversationMessage,
  interpretWhatsappIntentWithAi
} from "./ai-service.js";
import {
  addEventLog,
  createExpense,
  createSettlement,
  findRoommateByWhatsappNumber,
  getAssignmentById,
  getLatestConversationPromptForWhatsapp,
  getOldestPendingAssignment,
  getRoommateById,
  handoffAssignmentToNextRoommate,
  listBalances,
  listAllPendingAssignments,
  listPendingAssignmentsForRoommate,
  listRecentEvents,
  listRoommates,
  postponeAssignmentToTomorrow,
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

function isAffirmativeReply(body: string) {
  const lowered = normalizeMatchText(body);
  return /^(yes|yeah|yep|done|finished|completed)\b/.test(lowered);
}

function isNegativeReply(body: string) {
  const lowered = normalizeMatchText(body);
  return (
    /^(no|nope|not yet|didn t|didnt|haven t|havent)\b/.test(lowered) ||
    lowered.includes("not yet") ||
    lowered.includes("haven t") ||
    lowered.includes("havent")
  );
}

function wantsTomorrow(body: string) {
  const lowered = normalizeMatchText(body);
  return (
    lowered.includes("tomorrow") ||
    lowered.includes("push it") ||
    lowered.includes("move it to tomorrow")
  );
}

function wantsReassign(body: string) {
  const lowered = normalizeMatchText(body);
  return (
    lowered.includes("assign someone else") ||
    lowered.includes("someone else") ||
    lowered.includes("pass it on") ||
    lowered.includes("give it to someone else") ||
    lowered.includes("reassign")
  );
}

function parseMoneyAmount(body: string) {
  const match = body.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?|eur)\b/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]?.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return {
    amount,
    amountCents: Math.round(amount * 100),
    raw: match[0],
    index: match.index ?? -1
  };
}

function findMentionedRoommates(body: string) {
  const normalized = normalizeMatchText(body);
  return listRoommates().filter((roommate) =>
    normalized.includes(normalizeMatchText(roommate.name))
  );
}

function parseExpenseMessage(body: string, actorRoommateId: number | null) {
  if (!actorRoommateId) {
    return null;
  }

  const lowered = normalizeMatchText(body);
  if (
    lowered.includes("done") ||
    lowered.includes("skip") ||
    lowered.includes("rescue") ||
    lowered.includes("task") ||
    lowered.includes("chore") ||
    lowered.startsWith("tasks") ||
    lowered.startsWith("status")
  ) {
    return null;
  }

  const amountMatch = parseMoneyAmount(body);
  if (!amountMatch) {
    return null;
  }

  const title = body.slice(0, amountMatch.index).trim().replace(/[,:-]+$/g, "");
  if (!title) {
    return null;
  }

  const excluded = body.match(/exclude\s+(.+)$/i)?.[1] ?? "";
  const excludedNames = excluded
    .split(/,|and/i)
    .map((value) => value.trim())
    .filter(Boolean);
  const allRoommates = listRoommates().filter((roommate) => roommate.isActive);
  const excludedRoommateIds = new Set<number>();

  for (const excludedName of excludedNames) {
    const match = allRoommates.find(
      (roommate) => normalizeMatchText(roommate.name) === normalizeMatchText(excludedName)
    );
    if (match) {
      excludedRoommateIds.add(match.id);
    }
  }

  const includedRoommateIds = allRoommates
    .map((roommate) => roommate.id)
    .filter((roommateId) => !excludedRoommateIds.has(roommateId));

  if (!includedRoommateIds.includes(actorRoommateId)) {
    includedRoommateIds.push(actorRoommateId);
  }

  return {
    title,
    amountCents: amountMatch.amountCents,
    excludedRoommateIds: Array.from(excludedRoommateIds),
    includedRoommateIds: [...new Set(includedRoommateIds)].sort((left, right) => left - right)
  };
}

function parseSettlementMessage(body: string, actorRoommateId: number | null) {
  if (!actorRoommateId) {
    return null;
  }

  const lowered = normalizeMatchText(body);
  if (!lowered.includes("paid")) {
    return null;
  }

  const amountMatch = parseMoneyAmount(body);
  if (!amountMatch) {
    return null;
  }

  const mentionedRoommates = findMentionedRoommates(body).filter(
    (roommate) => roommate.id !== actorRoommateId
  );
  const counterparty = mentionedRoommates[0];
  if (!counterparty) {
    return null;
  }

  return {
    fromRoommateId: actorRoommateId,
    toRoommateId: counterparty.id,
    amountCents: amountMatch.amountCents
  };
}

function buildHelpMessage() {
  return [
    "Just reply in plain English:",
    '"I finished the kitchen"',
    '"I can\'t do trash today, pass it on"',
    '"I did Noah\'s trash for him"',
    '"Toilet paper 3.56 euros exclude Julia"',
    '"I paid Varun 8 euros"',
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
  const composed = await composeWhatsappConversationMessage({
    kind: "handoff_notice",
    roommateName: reassigned.roommateName,
    choreTitle: reassigned.choreTitle,
    dueDate: reassigned.dueDate,
    contextNote: reassigned.statusNote
  });
  const message = composed.text;

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
    addEventLog({
      roommateId: reassigned.roommateId,
      assignmentId: reassigned.id,
      eventType: "CONVERSATION_MESSAGE_SENT",
      payload: JSON.stringify({
        promptType: "handoff_notice",
        originalTo: reassigned.whatsappNumber,
        effectiveTo: outboundTo,
        source: composed.source,
        model: composed.model
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

async function sendConversationalReply(params: {
  to: string;
  roommateId: number | null;
  assignmentId: number | null;
  promptType:
    | "done_confirmation"
    | "skip_confirmation"
    | "rescue_confirmation"
    | "postpone_confirmation"
    | "resolution_options"
    | "escalation_nudge";
  roommateName: string;
  choreTitle: string;
    dueDate?: string | null;
    nextRoommateName?: string | null;
    contextNote?: string | null;
    deliver?: boolean;
}) {
  const outboundTo = resolveOutboundWhatsappNumber(params.to);
  const composed = await composeWhatsappConversationMessage({
    kind: params.promptType,
    roommateName: params.roommateName,
    choreTitle: params.choreTitle,
    dueDate: params.dueDate,
    nextRoommateName: params.nextRoommateName,
    contextNote: params.contextNote
  });
  if (params.deliver !== false) {
    await sendWhatsappMessage(params.to, composed.text);
  }
  if (params.assignmentId) {
    rememberLastOutboundAssignment(outboundTo, params.assignmentId);
  }
  addEventLog({
    roommateId: params.roommateId,
    assignmentId: params.assignmentId,
    eventType: "CONVERSATION_MESSAGE_SENT",
    payload: JSON.stringify({
      promptType: params.promptType,
      originalTo: params.to,
      effectiveTo: outboundTo,
      delivered: params.deliver !== false,
      source: composed.source,
      model: composed.model
    })
  });

  return composed.text;
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
    message: `✅ Nice, I marked ${assignment.choreTitle} as done.`,
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

  updateAssignmentStatus(assignmentId, "skipped", reason ?? null, {
    resolutionType: "skipped",
    responsibleRoommateId: assignment.roommateId,
    strikeApplied: 0
  });
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
      message: `👌 Okay, I marked ${assignment.choreTitle} as skipped.${reason ? ` Reason noted: ${reason}` : ""}`,
      assignmentId
    };
  }

  const reassigned = handoffAssignmentToNextRoommate(assignmentId, reason ?? null);
  if (!reassigned) {
    return {
      message: `🙂 Okay, ${assignment.choreTitle} is skipped for this week. I put it at the front of next week's list because nobody was free to swap in.`,
      assignmentId
    };
  }

  return notifyAssignmentHandoff(reassigned).then(() => ({
    message: `🔁 Okay, I switched ${assignment.choreTitle} over to ${reassigned.roommateName} for this week.`,
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
    message: `🛟 Thanks, I marked ${assignment.choreTitle} as rescued. ${assignment.roommateName} still keeps the missed turn on record.`,
    assignmentId
  };
}

async function handleConversationalReply(actor: {
  whatsappNumber: string;
  roommateId: number | null;
  trustedProxy: boolean;
}, body: string) {
  const latestPrompt = getLatestConversationPromptForWhatsapp(actor.whatsappNumber);
  const assignmentId =
    latestPrompt?.assignmentId ?? getLastReferencedAssignmentId(actor.whatsappNumber);

  if (!latestPrompt?.promptType || !assignmentId) {
    return null;
  }

  const assignment = getAssignmentById(assignmentId);
  if (!assignment || assignment.status !== "pending") {
    return null;
  }

  if (
    latestPrompt.promptType === "weekly_heads_up" ||
    latestPrompt.promptType === "two_day_reminder" ||
    latestPrompt.promptType === "day_of_reminder" ||
    latestPrompt.promptType === "assignment_reminder" ||
    latestPrompt.promptType === "completion_check" ||
    latestPrompt.promptType === "escalation_nudge"
  ) {
    if (isAffirmativeReply(body)) {
      handleDone(actor, String(assignmentId), assignmentId);
      const message = await sendConversationalReply({
        to: actor.whatsappNumber,
        roommateId: assignment.roommateId,
        assignmentId,
        promptType: "done_confirmation",
        roommateName: assignment.roommateName,
        choreTitle: assignment.choreTitle,
        dueDate: assignment.dueDate,
        deliver: false
      });
      return { message, assignmentId };
    }

    if (
      isNegativeReply(body) &&
      (
        latestPrompt.promptType === "day_of_reminder" ||
        latestPrompt.promptType === "assignment_reminder" ||
        latestPrompt.promptType === "completion_check" ||
        latestPrompt.promptType === "escalation_nudge"
      )
    ) {
      const message = await sendConversationalReply({
        to: actor.whatsappNumber,
        roommateId: assignment.roommateId,
        assignmentId,
        promptType: "resolution_options",
        roommateName: assignment.roommateName,
        choreTitle: assignment.choreTitle,
        dueDate: assignment.dueDate,
        deliver: false
      });
      return { message, assignmentId };
    }
  }

  if (latestPrompt.promptType === "resolution_options") {
    if (wantsTomorrow(body)) {
      const postponed = postponeAssignmentToTomorrow(
        assignmentId,
        "postponed in WhatsApp conversation"
      );
      if (!postponed) {
        return null;
      }

      const message = await sendConversationalReply({
        to: actor.whatsappNumber,
        roommateId: postponed.roommateId,
        assignmentId,
        promptType: "postpone_confirmation",
        roommateName: postponed.roommateName,
        choreTitle: postponed.choreTitle,
        dueDate: postponed.dueDate,
        deliver: false
      });
      return { message, assignmentId };
    }

    if (wantsReassign(body)) {
      const result = await handleSkip(
        actor,
        String(assignmentId),
        "reassigned in WhatsApp conversation",
        true,
        assignmentId
      );
      return result;
    }
  }

  return null;
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

  const expenseInput = parseExpenseMessage(normalized, actorRoommate?.id ?? null);
  if (expenseInput && actorRoommate) {
    const expense = createExpense({
      title: expenseInput.title,
      amountCents: expenseInput.amountCents,
      paidByRoommateId: actorRoommate.id,
      includedRoommateIds: expenseInput.includedRoommateIds,
      note:
        expenseInput.excludedRoommateIds.length > 0
          ? `Excluded ${expenseInput.excludedRoommateIds.length} roommate(s)`
          : null
    });

    if (expense) {
      const splitCount = expense.shares.length;
      const perPerson = expense.shares[0]?.shareCents ?? 0;
      return {
        message:
          expense.excludedRoommateNames.length > 0
            ? `😍 Logged ${expense.title} for ${(expense.amountCents / 100).toFixed(2)} EUR. Split between ${splitCount} people, ${Math.round(perPerson) / 100} EUR each, excluding ${expense.excludedRoommateNames.join(", ")} ♥️`
            : `😍 Logged ${expense.title} for ${(expense.amountCents / 100).toFixed(2)} EUR. Split between ${splitCount} people, ${Math.round(perPerson) / 100} EUR each ♥️`
      };
    }
  }

  const settlementInput = parseSettlementMessage(normalized, actorRoommate?.id ?? null);
  if (settlementInput) {
    const balance = listBalances().find(
      (entry) =>
        entry.fromRoommateId === settlementInput.fromRoommateId &&
        entry.toRoommateId === settlementInput.toRoommateId
    );

    const amountCents = Math.min(
      settlementInput.amountCents,
      balance?.amountCents ?? settlementInput.amountCents
    );

    const settlement = createSettlement({
      fromRoommateId: settlementInput.fromRoommateId,
      toRoommateId: settlementInput.toRoommateId,
      amountCents,
      note: "Logged from chat"
    });

    if (settlement) {
      return {
        message: `😃 Logged your payment of ${(settlement.amountCents / 100).toFixed(2)} EUR to ${settlement.toRoommateName}. The dashboard balances are updated.`
      };
    }
  }

  const conversationalResult = await handleConversationalReply(actor, normalized);
  if (conversationalResult) {
    return conversationalResult;
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
