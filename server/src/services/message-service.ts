import { config, isTrustedProxyWhatsappNumber } from "../config.js";
import type { Assignment, CommandResult, Expense, Settlement } from "../lib/types.js";
import {
  composeWhatsappConversationMessage,
  routeWhatsappMessageWithAi
} from "./ai-service.js";
import type { AiWhatsappRoute } from "./ai-service.js";
import {
  addEventLogAsync,
  createExpenseAsync,
  createSettlementAsync,
  findRoommateByWhatsappNumberAsync,
  getAssignmentByIdAsync,
  getHouseSettingsAsync,
  getLatestConversationPromptForWhatsappAsync,
  getOldestPendingAssignmentAsync,
  getRoommateByIdAsync,
  getRoommateLoginPasswordAsync,
  getRoommateStreakSummaryAsync,
  handoffAssignmentToNextRoommateAsync,
  handoffAssignmentToRoommateAsync,
  hasRoommateReceivedWhatsappWelcomeAsync,
  listAllPendingAssignmentsAsync,
  listAssignmentsAsync,
  listBalancesAsync,
  listExpensesAsync,
  listPendingAssignmentsForRoommateAsync,
  listRecentEventsAsync,
  listRescueCandidatesForAssignmentAsync,
  listRoommatesAsync,
  postponeAssignmentToTomorrowAsync,
  rescheduleAssignmentToDateAsync,
  rescueAssignmentAsync,
  shiftNextWeeklyWindowAfterWeekendDelayAsync,
  shiftNextWeeklyWindowAfterSundayCompletionAsync,
  updateAssignmentStatusAsync
} from "./task-service-async.js";
import {
  resolveOutboundWhatsappNumber,
  sendWhatsappMessage
} from "./twilio-service.js";

const lastOutboundAssignmentByWhatsapp = new Map<string, number>();
const lastHouseQuestionContextByWhatsapp = new Map<
  string,
  {
    type:
      | "ROOMMATE_TASKS"
      | "ROOMMATE_COMPLETION"
      | "TASK_OWNER"
      | "DUE_OVERVIEW"
      | "COMPLETION_OVERVIEW"
      | "MISSED_OVERVIEW"
      | "RESCUE_OVERVIEW"
      | "PURCHASES"
      | "SCOREBOARD";
    roommateId?: number | null;
    roommateName?: string | null;
    choreTitle?: string | null;
    assignmentId?: number | null;
    timeScope?: string | null;
  }
>();
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

const TASK_ALIASES: Record<string, string[]> = {
  "Taking Out Trash": ["trash", "bins", "bin", "garbage", "taking trash out", "take out trash", "trash out", "taking trash"],
  "Plastic and Glass Trash": ["recycling", "plastic", "glass", "plastic and glass", "recycle"],
  "Washing Towels": ["towels", "towel", "towel duty", "towel cleaning", "washing towels"],
  "Running Dishwasher": ["running dishwasher", "run dishwasher", "dishwasher run", "start dishwasher", "dishwasher run duty", "dishwasher"],
  "Emptying Dishwasher": ["empty dishwasher", "emptying dishwasher", "unload dishwasher", "dishwasher empty", "dishwasher unload"],
  Bathroom: ["bathroom", "bath"],
  Kitchen: ["kitchen"],
  Hallway: ["hallway", "hall"],
  "Living Room": ["living room", "living"],
  Toilet: ["toilet", "restroom"]
};
type ActionableIntentAction = "DONE" | "SKIP" | "SKIP_REASSIGN" | "RESCHEDULE" | "RESCUE";

function normalizeBody(body: string) {
  return body.trim().replace(/\s+/g, " ");
}

function parseIsoDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function parseRequestedDueDate(body: string, timezone: string) {
  const lowered = normalizeMatchText(body);

  const explicitIso = body.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (explicitIso?.[1]) {
    return explicitIso[1];
  }

  const weekdayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6
  };

  const matchedWeekday = Object.keys(weekdayMap).find((weekday) =>
    new RegExp(`\\b${weekday}\\b`, "i").test(lowered)
  );

  if (!matchedWeekday) {
    return null;
  }

  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short"
  });
  const dateParts = dateFormatter.formatToParts(now);
  const dateYear = dateParts.find((part) => part.type === "year")?.value;
  const dateMonth = dateParts.find((part) => part.type === "month")?.value;
  const dateDay = dateParts.find((part) => part.type === "day")?.value;
  const datePart =
    dateYear && dateMonth && dateDay
      ? `${dateYear}-${dateMonth}-${dateDay}`
      : now.toISOString().slice(0, 10);
  const weekdayPart = weekdayFormatter.format(now).toLowerCase();
  const weekdayLookup: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };
  const nowWeekday = weekdayLookup[weekdayPart.slice(0, 3)] ?? 1;
  const targetWeekday = weekdayMap[matchedWeekday];
  const delta = (targetWeekday - nowWeekday + 7) % 7 || 7;
  const targetDate = parseIsoDate(datePart);
  targetDate.setUTCDate(targetDate.getUTCDate() + delta);
  return targetDate.toISOString().slice(0, 10);
}

function formatShortDueDate(value: string) {
  const due = parseIsoDate(value);
  if (Number.isNaN(due.getTime())) {
    return value;
  }

  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const diffDays = Math.round((dueDay - today) / 86400000);

  if (diffDays === 0) {
    return "today";
  }

  if (diffDays === 1) {
    return "tomorrow";
  }

  return value;
}

function formatEuroCents(amountCents: number) {
  return (amountCents / 100).toFixed(2);
}

function toUtcDay(value: string | Date) {
  const date =
    value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function getTuesdayAnchoredWeekRange(baseDate: Date) {
  const weekday = baseDate.getUTCDay();
  const diffToTuesday = (weekday + 5) % 7;
  const startDate = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), baseDate.getUTCDate()));
  startDate.setUTCDate(startDate.getUTCDate() - diffToTuesday);
  const endDate = new Date(startDate);
  endDate.setUTCDate(endDate.getUTCDate() + 6);
  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10)
  };
}

function isDateWithinRange(value: string, start: string, end: string) {
  const day = toUtcDay(value);
  return day >= toUtcDay(start) && day <= toUtcDay(end);
}

function addDaysIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getSundayWeekEndForIsoDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const weekday = date.getUTCDay();
  const daysToSunday = (7 - weekday) % 7;
  return addDaysIsoDate(value, daysToSunday);
}

function getMonthRange(baseDateIso: string) {
  const base = new Date(`${baseDateIso}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return { start: baseDateIso, end: baseDateIso };
  }
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10)
  };
}

function resolveCompletedByRoommateName(assignment: {
  roommateName: string;
  resolutionType?: string | null;
  rescuedByRoommateName?: string | null;
  responsibleRoommateName?: string | null;
}) {
  if (assignment.resolutionType === "rescued" && assignment.rescuedByRoommateName) {
    return assignment.rescuedByRoommateName;
  }

  return assignment.responsibleRoommateName ?? assignment.roommateName;
}

function filterAssignmentsForScope(
  assignments: Assignment[],
  scope: "week" | "month"
) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const maxDays = scope === "week" ? 6 : 30;

  return assignments.filter((assignment) => {
    const due = parseIsoDate(assignment.dueDate);
    if (Number.isNaN(due.getTime())) {
      return false;
    }

    const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
    const diffDays = Math.round((dueDay - today) / 86400000);
    return diffDays >= 0 && diffDays <= maxDays;
  });
}

function filterAssignmentsForRelativeDays(
  assignments: Assignment[],
  minDays: number,
  maxDays: number
) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return assignments.filter((assignment) => {
    const due = parseIsoDate(assignment.dueDate);
    if (Number.isNaN(due.getTime())) {
      return false;
    }

    const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
    const diffDays = Math.round((dueDay - today) / 86400000);
    return diffDays >= minDays && diffDays <= maxDays;
  });
}

function isWeeklyRecurringAssignment(assignment: Assignment) {
  return assignment.taskMode === "fixed_schedule" && assignment.frequencyUnit === "week";
}

function buildHelpMessage() {
  return [
    "Just reply in plain English:",
    '"I finished the kitchen"',
    '"I can\'t do trash today, pass it on"',
    '"Move my living room task to Sunday"',
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

function isMissedOverviewQuestion(lowered: string) {
  return /who missed|who skip|who skipped|missed\b/.test(lowered);
}

function isCompletionOverviewQuestion(lowered: string) {
  return (
    /who finished|who completed|did .* finish|did .* complete/.test(lowered) ||
    /who did what|what was done|what got done/.test(lowered)
  );
}

function isDueOverviewQuestion(lowered: string) {
  return /whose tasks are due|who.*tasks.*due|what.*due/.test(lowered);
}

function isRoommateTasksQuestion(lowered: string) {
  return /show me .*tasks|what are .*tasks|what is .* doing|what about /.test(lowered);
}

function isTaskOwnerQuestion(lowered: string) {
  return /who is doing|who has|whose duty|who should/.test(lowered);
}

function tokenizeMatchText(value: string) {
  return normalizeMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(
      (token) => token.length > 2 && !MATCH_STOP_WORDS.has(token)
    );
}

function normalizeMatchStem(token: string) {
  let stem = token.toLowerCase().trim();

  if (stem.endsWith("ing") && stem.length > 5) {
    stem = stem.slice(0, -3);
  }

  if (stem.endsWith("es") && stem.length > 4) {
    stem = stem.slice(0, -2);
  } else if (stem.endsWith("s") && stem.length > 3) {
    stem = stem.slice(0, -1);
  }

  return stem;
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
  const bodyStems = new Set(Array.from(bodyTokens).map(normalizeMatchStem));
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
    if (
      bodyTokens.has(token) ||
      bodyStems.has(normalizeMatchStem(token))
    ) {
      score += 3;
    }
  }

  for (const token of new Set(tokenizeMatchText(assignment.roommateName))) {
    if (
      bodyTokens.has(token) ||
      bodyStems.has(normalizeMatchStem(token))
    ) {
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

function resolveAssignmentAliasTitle(body: string) {
  return resolveAssignmentAliasTitleFromNormalized(
    normalizeMatchText(body),
    new Set(tokenizeMatchText(body).map(normalizeMatchStem))
  );
}

function resolveAssignmentAliasTitleFromNormalized(
  lowered: string,
  bodyStems: Set<string>
) {
  let bestTitle: string | null = null;
  let bestScore = 0;

  for (const [title, aliases] of Object.entries(TASK_ALIASES)) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeMatchText(alias);
      const aliasTokens = tokenizeMatchText(alias);
      const aliasStems = aliasTokens.map(normalizeMatchStem);
      const exact = normalizedAlias.length > 0 && lowered.includes(normalizedAlias);
      const tokenMatch =
        aliasStems.length > 0 &&
        aliasStems.every((stem) => bodyStems.has(stem));

      if (!exact && !tokenMatch) {
        continue;
      }

      const candidateScore =
        (exact ? 10 : 0) +
        aliasTokens.length * (exact ? 4 : 3);

      if (candidateScore > bestScore) {
        bestScore = candidateScore;
        bestTitle = title;
      }
    }
  }

  return bestTitle;
}

function resolveAssignmentFromContext(input: {
  body: string;
  action: ActionableIntentAction;
  pendingAssignments: Array<{
    id: number;
    choreTitle: string;
    roommateName: string;
    dueDate: string;
  }>;
  lastReferencedAssignmentId: number | null;
}) {
  const { body, action, pendingAssignments, lastReferencedAssignmentId } = input;
  const aliasTitle = resolveAssignmentAliasTitle(body);

  if (pendingAssignments.length === 0) {
    return {
      assignmentId: null,
      ambiguous: false,
      missingAliasTitle: aliasTitle
    };
  }

  if (aliasTitle) {
    const aliasMatches = pendingAssignments.filter(
      (assignment) =>
        normalizeMatchText(assignment.choreTitle) === normalizeMatchText(aliasTitle)
    );

    if (aliasMatches.length === 1) {
      return {
        assignmentId: aliasMatches[0]?.id ?? null,
        ambiguous: false
      };
    }

    if (aliasMatches.length > 1) {
      const scoredAliasMatches = aliasMatches
        .map((assignment) => ({
          assignment,
          score: scoreAssignmentMatch(body, assignment)
        }))
        .sort((left, right) => right.score - left.score);
      const topAlias = scoredAliasMatches[0];
      const secondAlias = scoredAliasMatches[1];

      if (
        topAlias &&
        (
          topAlias.score >= 4 ||
          !secondAlias ||
          topAlias.score >= secondAlias.score + 2
        )
      ) {
        return {
          assignmentId: topAlias.assignment.id,
          ambiguous: false
        };
      }

      return {
        assignmentId: null,
        ambiguous: true,
        suggestions: aliasMatches.slice(0, 3),
        action,
        missingAliasTitle: aliasTitle
      };
    }
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
    action,
    missingAliasTitle: aliasTitle
  };
}

function buildNoOpenAssignmentMessage(
  action: ActionableIntentAction,
  choreTitle: string
) {
  const actionLabel =
    action === "RESCUE"
      ? "rescue"
      : action === "RESCHEDULE"
        ? "reschedule"
      : action === "DONE"
        ? "mark as done"
        : "skip";

  return `I can tell you mean ${choreTitle}, but I can’t see an open ${choreTitle} task to ${actionLabel} right now.`;
}

function buildClarifyAssignmentMessage(input: {
  action: ActionableIntentAction;
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
      : input.action === "RESCHEDULE"
        ? "reschedule"
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

function looksLikeRescueLanguage(body: string) {
  const lowered = normalizeMatchText(body);
  return (
    lowered.includes("rescue") ||
    lowered.includes("rescued") ||
    lowered.includes("for him") ||
    lowered.includes("for her") ||
    lowered.includes("for them") ||
    lowered.includes("covered") ||
    lowered.includes("picked it up for") ||
    lowered.includes("did it for")
  );
}

function looksLikeCompletionLanguage(body: string) {
  const lowered = normalizeMatchText(body);
  return (
    lowered.includes("finished") ||
    lowered.includes("done") ||
    lowered.includes("completed") ||
    lowered.includes("cleaned") ||
    lowered.includes("handled") ||
    lowered.includes("sorted") ||
    lowered.includes("took out") ||
    lowered.includes("tossed") ||
    lowered.includes("threw out") ||
    lowered.includes("brought out") ||
    lowered.includes("put the bins out") ||
    lowered.includes("put the bin out")
  );
}

export function rememberLastOutboundAssignment(
  whatsappNumber: string,
  assignmentId: number
) {
  lastOutboundAssignmentByWhatsapp.set(whatsappNumber, assignmentId);
}

export async function notifyHouseExpenseAddedAsync(
  expense: Expense,
  options?: { excludeRoommateIds?: number[] }
) {
  const excludedIds = new Set(options?.excludeRoommateIds ?? []);
  const roommates = await listRoommatesAsync();
  const targets = roommates.filter(
    (roommate) =>
      roommate.isActive &&
      Boolean(roommate.whatsappNumber) &&
      !excludedIds.has(roommate.id)
  );

  const excludedLabel =
    expense.excludedRoommateNames.length > 0
      ? ` Excluded: ${expense.excludedRoommateNames.join(", ")}.`
      : "";

  for (const roommate of targets) {
    const share = expense.shares.find((entry) => entry.roommateId === roommate.id);
    const shareText = share
      ? `Your share is ${formatEuroCents(share.shareCents)} EUR.`
      : "You are excluded from this split.";
    const message =
      `🧾 ${expense.paidByRoommateName} added ${expense.title} for ${formatEuroCents(expense.amountCents)} EUR. ` +
      `${shareText}${excludedLabel}`;
    try {
      await sendWhatsappMessage(roommate.whatsappNumber, message);
    } catch (error) {
      await addEventLogAsync({
        roommateId: roommate.id,
        assignmentId: null,
        eventType: "EXPENSE_NOTIFICATION_FAILED",
        payload: JSON.stringify({
          expenseId: expense.id,
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }
}

export async function notifyHouseSettlementAddedAsync(
  settlement: Settlement,
  options?: { excludeRoommateIds?: number[] }
) {
  const excludedIds = new Set(options?.excludeRoommateIds ?? []);
  const roommates = await listRoommatesAsync();
  const targets = roommates.filter(
    (roommate) =>
      roommate.isActive &&
      Boolean(roommate.whatsappNumber) &&
      !excludedIds.has(roommate.id)
  );

  const message =
    `💸 Settlement logged: ${settlement.fromRoommateName} paid ${settlement.toRoommateName} ` +
    `${formatEuroCents(settlement.amountCents)} EUR. Balances were updated.`;

  for (const roommate of targets) {
    try {
      await sendWhatsappMessage(roommate.whatsappNumber, message);
    } catch (error) {
      await addEventLogAsync({
        roommateId: roommate.id,
        assignmentId: null,
        eventType: "SETTLEMENT_NOTIFICATION_FAILED",
        payload: JSON.stringify({
          settlementId: settlement.id,
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }
}

function getLastReferencedAssignmentId(whatsappNumber: string) {
  return lastOutboundAssignmentByWhatsapp.get(whatsappNumber) ?? null;
}

async function buildWhatsappWelcomeMessageAsync(roommateId: number) {
  const roommate = await getRoommateByIdAsync(roommateId);
  if (!roommate) {
    return buildHelpMessage();
  }

  const loginPassword =
    (await getRoommateLoginPasswordAsync(roommateId)) ?? `${roommate.name.toLowerCase()}123`;

  return [
    `Hey ${roommate.name} 🙂 welcome to the new flat system.`,
    "",
    "From now on, chores, swaps, rescues, streaks, and shared expenses all run through this chat and the app.",
    "",
    `Website: ${config.appBaseUrl}`,
    `Login: ${roommate.name}`,
    `Password: ${loginPassword}`,
    "",
    "You can text naturally here, for example:",
    '• "What are my tasks this week?"',
    '• "I finished the bathroom"',
    '• "I am not home this week"',
    '• "What is Noah doing this week?"',
    '• "Toilet paper 3.56 euros exclude Julia"',
    "",
    "Weekly chores run from Tuesday to Friday. Rolling chores like dishwasher and trash keep moving as people finish them. If you stay on top of things, your streak and score go up 😍"
  ].join("\n");
}

async function buildTasksMessageAsync(
  whatsappNumber: string,
  scope: "week" | "month" = "week"
) {
  const roommate = await findRoommateByWhatsappNumberAsync(whatsappNumber);
  if (!roommate) {
    return "Your number is not registered yet. Ask the admin to add you first.";
  }

  const assignments = filterAssignmentsForScope(
    await listPendingAssignmentsForRoommateAsync(roommate.id),
    scope
  );
  if (assignments.length === 0) {
    return scope === "month"
      ? `You’re clear for the next month, ${roommate.name} 😌`
      : `You’re clear for this week, ${roommate.name} 😌`;
  }

  const lines = assignments
    .slice(0, 5)
    .map((assignment) => `• ${assignment.choreTitle} by ${formatShortDueDate(assignment.dueDate)}`);

  return [
    scope === "month"
      ? `Hey ${roommate.name}, here’s what’s coming up for the next month 🙂`
      : `Hey ${roommate.name}, here’s what’s due for you this week 🙂`,
    ...lines,
    scope === "week" ? "If you want the longer view, send MONTH." : "Message me when you finish one."
  ].join("\n");
}

async function buildStatusMessageAsync() {
  const [pendingAssignments, events] = await Promise.all([
    listAllPendingAssignmentsAsync(),
    listRecentEventsAsync(5)
  ]);

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

  return ["Pending chores:", ...pendingLines, "", "Recent activity:", ...eventLines].join("\n");
}

async function buildHouseholdQuestionSnapshotAsync() {
  const [settings, roommates, assignments, balances, expenses, recentEvents] = await Promise.all([
    getHouseSettingsAsync(),
    listRoommatesAsync(),
    listAssignmentsAsync(),
    listBalancesAsync(),
    listExpensesAsync(),
    listRecentEventsAsync(50)
  ]);

  const todayDate = new Date().toISOString().slice(0, 10);
  const tomorrowDate = addDaysIsoDate(todayDate, 1);
  const currentWeek = getTuesdayAnchoredWeekRange(new Date(`${todayDate}T12:00:00Z`));
  const nextWeekBase = new Date(`${currentWeek.start}T12:00:00Z`);
  nextWeekBase.setUTCDate(nextWeekBase.getUTCDate() + 7);
  const nextWeek = getTuesdayAnchoredWeekRange(nextWeekBase);
  const previousWeekBase = new Date(`${currentWeek.start}T12:00:00Z`);
  previousWeekBase.setUTCDate(previousWeekBase.getUTCDate() - 7);
  const lastWeek = getTuesdayAnchoredWeekRange(previousWeekBase);
  const thisMonth = getMonthRange(todayDate);

  const assignmentViews = assignments.map((assignment) => ({
    id: assignment.id,
    choreTitle: assignment.choreTitle,
    roommateName: assignment.roommateName,
    roommateId: assignment.roommateId,
    dueDate: assignment.dueDate,
    status: assignment.status,
    statusNote: assignment.statusNote,
    resolutionType: assignment.resolutionType,
    responsibleRoommateName: assignment.responsibleRoommateName,
    rescuedByRoommateName: assignment.rescuedByRoommateName,
    completedAt: assignment.completedAt,
    escalationLevel: assignment.escalationLevel,
    strikeApplied: assignment.strikeApplied,
    rescueCreditApplied: assignment.rescueCreditApplied,
    points: assignment.points,
    frequencyUnit: assignment.frequencyUnit,
    taskMode: assignment.taskMode,
    completedByRoommateName: resolveCompletedByRoommateName(assignment)
  }));

  const dueToday = assignmentViews.filter(
    (assignment) => assignment.status === "pending" && assignment.dueDate === todayDate
  );
  const dueTomorrow = assignmentViews.filter(
    (assignment) => assignment.status === "pending" && assignment.dueDate === tomorrowDate
  );
  const dueThisWeek = assignmentViews.filter(
    (assignment) =>
      assignment.status === "pending" &&
      isDateWithinRange(assignment.dueDate, currentWeek.start, currentWeek.end)
  );
  const dueNextWeek = assignmentViews.filter(
    (assignment) =>
      assignment.status === "pending" &&
      isDateWithinRange(assignment.dueDate, nextWeek.start, nextWeek.end)
  );
  const dueThisMonth = assignmentViews.filter(
    (assignment) =>
      assignment.status === "pending" &&
      isDateWithinRange(assignment.dueDate, thisMonth.start, thisMonth.end)
  );
  const dueUpcoming = assignmentViews.filter(
    (assignment) =>
      assignment.status === "pending" &&
      toUtcDay(assignment.dueDate) > toUtcDay(currentWeek.end)
  );
  const completedThisWeek = assignmentViews.filter(
    (assignment) =>
      assignment.status === "done" &&
      isDateWithinRange(assignment.dueDate, currentWeek.start, currentWeek.end)
  );
  const rescuedThisWeek = assignmentViews.filter(
    (assignment) =>
      assignment.resolutionType === "rescued" &&
      isDateWithinRange(assignment.dueDate, currentWeek.start, currentWeek.end)
  );
  const missedThisWeek = assignmentViews.filter(
    (assignment) =>
      (
        assignment.status === "pending" &&
        toUtcDay(assignment.dueDate) < toUtcDay(todayDate)
      ) ||
      (
        assignment.status === "skipped" &&
        isDateWithinRange(assignment.dueDate, currentWeek.start, currentWeek.end) &&
        (assignment.strikeApplied ?? 0) > 0
      )
  );
  const lastWeekAssignments = assignmentViews.filter((assignment) =>
    isDateWithinRange(assignment.dueDate, lastWeek.start, lastWeek.end)
  );

  return {
    todayDate,
    timezone: settings.timezone,
    roommates: roommates.map((roommate) => ({
      id: roommate.id,
      name: roommate.name,
      isActive: roommate.isActive,
      pendingCount: roommate.pendingCount,
      completedCount: roommate.completedCount,
      skippedCount: roommate.skippedCount,
      openPenaltyCount: roommate.openPenaltyCount
    })),
    assignments: assignmentViews,
    balances: balances.map((balance) => ({
      fromRoommateName: balance.fromRoommateName,
      toRoommateName: balance.toRoommateName,
      amountCents: balance.amountCents
    })),
    expenses: expenses.map((expense) => ({
      title: expense.title,
      amountCents: expense.amountCents,
      paidByRoommateName: expense.paidByRoommateName,
      createdAt: expense.createdAt
    })),
    recentEvents: recentEvents.map((event) => ({
      eventType: event.eventType,
      roommateName: event.roommateName,
      createdAt: event.createdAt,
      payloadJson: event.payloadJson
    })),
    derived: {
      currentWeek,
      nextWeek,
      lastWeek,
      thisMonth,
      dueToday,
      dueTomorrow,
      dueThisWeek,
      dueNextWeek,
      dueThisMonth,
      dueUpcoming,
      completedThisWeek,
      rescuedThisWeek,
      missedThisWeek,
      lastWeekAssignments
    }
  };
}

function rememberHouseQuestionContext(
  whatsappNumber: string,
  body: string,
  route: AiWhatsappRoute,
  householdSnapshot: Awaited<ReturnType<typeof buildHouseholdQuestionSnapshotAsync>>
) {
  if (route.kind !== "QUESTION") {
    return;
  }

  const loweredBody = normalizeMatchText(body);
  const heuristicType =
    isMissedOverviewQuestion(loweredBody)
      ? "MISSED_OVERVIEW"
      : isDueOverviewQuestion(loweredBody)
        ? "DUE_OVERVIEW"
        : isCompletionOverviewQuestion(loweredBody)
          ? route.roommateName
            ? "ROOMMATE_COMPLETION"
            : "COMPLETION_OVERVIEW"
          : isRoommateTasksQuestion(loweredBody)
            ? "ROOMMATE_TASKS"
            : isTaskOwnerQuestion(loweredBody) && (route.choreTitle || resolveAssignmentAliasTitle(body))
              ? "TASK_OWNER"
              : null;
  const inferredType =
    (
      /who rescued|who rescue|rescued\b/.test(loweredBody)
        ? "RESCUE_OVERVIEW"
        : heuristicType
    ) ??
    route.questionContextType ??
    null;

  if (!inferredType) {
    return;
  }

  const matchedRoommate =
    route.roommateName
      ? householdSnapshot.roommates.find(
          (roommate) =>
            normalizeMatchText(roommate.name) === normalizeMatchText(route.roommateName ?? "")
        )
      : null;

  lastHouseQuestionContextByWhatsapp.set(whatsappNumber, {
    type: inferredType,
    roommateId: matchedRoommate?.id ?? null,
    roommateName: matchedRoommate?.name ?? route.roommateName ?? null,
    choreTitle: route.choreTitle ?? resolveAssignmentAliasTitle(body) ?? null,
    assignmentId: route.assignmentId ?? null,
    timeScope: route.timeScope ?? null
  });
}

function formatQuestionScopeLabel(scope: string | null | undefined) {
  switch (scope) {
    case "TODAY":
      return "today";
    case "TOMORROW":
      return "tomorrow";
    case "LAST_WEEK":
      return "last week";
    case "THIS_MONTH":
      return "this month";
    case "NEXT_WEEK":
      return "next week";
    case "UPCOMING":
      return "upcoming";
    case "THIS_WEEK":
    default:
      return "this week";
  }
}

function findSnapshotRoommateByName(
  snapshot: Awaited<ReturnType<typeof buildHouseholdQuestionSnapshotAsync>>,
  roommateName: string | null | undefined
) {
  if (!roommateName) {
    return null;
  }

  return (
    snapshot.roommates.find(
      (roommate) =>
        normalizeMatchText(roommate.name) === normalizeMatchText(roommateName)
    ) ?? null
  );
}

function getAssignmentsForScope(
  snapshot: Awaited<ReturnType<typeof buildHouseholdQuestionSnapshotAsync>>,
  scope: string | null | undefined
) {
  switch (scope) {
    case "TODAY":
      return snapshot.derived.dueToday;
    case "TOMORROW":
      return snapshot.derived.dueTomorrow;
    case "NEXT_WEEK":
      return snapshot.derived.dueNextWeek;
    case "THIS_MONTH":
      return snapshot.derived.dueThisMonth;
    case "UPCOMING":
      return snapshot.derived.dueUpcoming;
    case "LAST_WEEK":
      return snapshot.derived.lastWeekAssignments;
    case "THIS_WEEK":
    case null:
    case undefined:
      return snapshot.derived.dueThisWeek;
    default:
      return snapshot.derived.dueThisWeek;
  }
}

function buildStructuredQuestionAnswer(input: {
  body: string;
  route: AiWhatsappRoute;
  snapshot: Awaited<ReturnType<typeof buildHouseholdQuestionSnapshotAsync>>;
  latestContext?: {
    type: string | null;
    roommateName?: string | null;
    choreTitle?: string | null;
    timeScope?: string | null;
  } | null;
}) {
  const { route, snapshot, latestContext } = input;
  const loweredBody = normalizeMatchText(input.body);
  const inferredRoommate =
    route.roommateName ??
    snapshot.roommates.find((roommate) =>
      loweredBody.includes(normalizeMatchText(roommate.name))
    )?.name ??
    latestContext?.roommateName ??
    null;
  const inferredChoreTitle =
    route.choreTitle ??
    resolveAssignmentAliasTitle(input.body) ??
    latestContext?.choreTitle ??
    null;
  const inferredTimeScope =
    route.timeScope ??
    (loweredBody.includes("last week")
      ? "LAST_WEEK"
      : loweredBody.includes("next week")
        ? "NEXT_WEEK"
        : loweredBody.includes("this month")
          ? "THIS_MONTH"
          : loweredBody.includes("tomorrow")
            ? "TOMORROW"
            : loweredBody.includes("today")
              ? "TODAY"
              : loweredBody.includes("upcoming")
                ? "UPCOMING"
                : loweredBody.includes("this week")
                  ? "THIS_WEEK"
                  : latestContext?.timeScope ??
                    null);
  const inferredContextType =
    (
      /who rescued|who rescue|rescued\b/.test(loweredBody)
        ? "RESCUE_OVERVIEW"
        : isMissedOverviewQuestion(loweredBody)
          ? "MISSED_OVERVIEW"
          : isDueOverviewQuestion(loweredBody)
            ? "DUE_OVERVIEW"
            : isCompletionOverviewQuestion(loweredBody)
              ? inferredRoommate
                ? "ROOMMATE_COMPLETION"
                : "COMPLETION_OVERVIEW"
              : isRoommateTasksQuestion(loweredBody)
                ? "ROOMMATE_TASKS"
                : isTaskOwnerQuestion(loweredBody) && inferredChoreTitle
                  ? "TASK_OWNER"
                  : latestContext?.type &&
                      (loweredBody.startsWith("what about") || loweredBody.startsWith("and "))
                    ? latestContext.type
                    : null
    ) ??
    route.questionContextType ??
    null;
  const contextType = inferredContextType;
  if (!contextType) {
    return null;
  }

  const effectiveScope =
    inferredTimeScope ??
    latestContext?.timeScope ??
    (contextType === "ROOMMATE_COMPLETION" ? "THIS_WEEK" : "THIS_WEEK");
  const effectiveRoommateName =
    inferredRoommate;
  const effectiveChoreTitle =
    inferredChoreTitle;
  const scopeLabel = formatQuestionScopeLabel(effectiveScope);

  if (contextType === "DUE_OVERVIEW") {
    const assignments = getAssignmentsForScope(snapshot, effectiveScope).filter(
      (assignment) => assignment.status === "pending"
    );
    if (assignments.length === 0) {
      return effectiveScope === "TODAY"
        ? "Nothing is due today."
        : `No tasks are due ${scopeLabel}.`;
    }
    return [
      effectiveScope === "TODAY"
        ? `The tasks due today (${snapshot.todayDate}) are:`
        : `Here’s what is due ${scopeLabel}:`,
      ...assignments.map(
        (assignment) =>
          `• ${assignment.roommateName}: ${assignment.choreTitle} (#${assignment.id})`
      )
    ].join("\n");
  }

  if (contextType === "COMPLETION_OVERVIEW") {
    const completed =
      effectiveScope === "LAST_WEEK"
        ? snapshot.derived.lastWeekAssignments.filter(
            (assignment) => assignment.status === "done"
          )
        : snapshot.derived.completedThisWeek;
    if (completed.length === 0) {
      return `Nobody has completed a task ${scopeLabel} yet.`;
    }

    return [
      `Completed ${scopeLabel}:`,
      ...completed.map((assignment) => {
        if (assignment.resolutionType === "rescued" && assignment.rescuedByRoommateName) {
          return `• ${assignment.rescuedByRoommateName} rescued ${assignment.choreTitle} for ${assignment.roommateName}`;
        }
        return `• ${assignment.roommateName}: ${assignment.choreTitle}`;
      })
    ].join("\n");
  }

  if (contextType === "MISSED_OVERVIEW") {
    const missed =
      effectiveScope === "LAST_WEEK"
        ? snapshot.derived.lastWeekAssignments.filter(
            (assignment) =>
              assignment.status === "skipped" && (assignment.strikeApplied ?? 0) > 0
          )
        : snapshot.derived.missedThisWeek;

    if (missed.length === 0) {
      return `Nobody has missed a task ${scopeLabel}.`;
    }

    return [
      `Missed ${scopeLabel}:`,
      ...missed.map((assignment) => {
        if (assignment.resolutionType === "rescued" && assignment.rescuedByRoommateName) {
          return `• ${assignment.roommateName} missed ${assignment.choreTitle}; ${assignment.rescuedByRoommateName} later rescued it`;
        }
        return `• ${assignment.roommateName}: ${assignment.choreTitle}`;
      })
    ].join("\n");
  }

  if (contextType === "RESCUE_OVERVIEW") {
    const rescues =
      effectiveScope === "LAST_WEEK"
        ? snapshot.derived.lastWeekAssignments.filter(
            (assignment) => assignment.resolutionType === "rescued"
          )
        : snapshot.derived.rescuedThisWeek;
    if (rescues.length === 0) {
      return `Nobody has rescued a task ${scopeLabel}.`;
    }

    return [
      `Rescues ${scopeLabel}:`,
      ...rescues.map(
        (assignment) =>
          `• ${assignment.rescuedByRoommateName ?? "Someone"} rescued ${assignment.choreTitle} for ${assignment.roommateName}`
      )
    ].join("\n");
  }

  if (contextType === "ROOMMATE_TASKS") {
    const roommate = findSnapshotRoommateByName(snapshot, effectiveRoommateName);
    if (!roommate) {
      return null;
    }
    const assignments = getAssignmentsForScope(snapshot, effectiveScope).filter((assignment) =>
      assignment.roommateId === roommate.id &&
      (effectiveScope === "LAST_WEEK" ? true : assignment.status === "pending")
    );

    if (assignments.length === 0) {
      return `${roommate.name} has nothing due ${scopeLabel}.`;
    }

    return [
      `Here’s ${roommate.name}'s ${scopeLabel}:`,
      ...assignments.map(
        (assignment) =>
          `• ${assignment.choreTitle} by ${formatShortDueDate(assignment.dueDate)} (${assignment.status})`
      )
    ].join("\n");
  }

  if (contextType === "ROOMMATE_COMPLETION") {
    const roommate = findSnapshotRoommateByName(snapshot, effectiveRoommateName);
    if (!roommate) {
      return null;
    }

    const assignments =
      effectiveScope === "LAST_WEEK"
        ? snapshot.derived.lastWeekAssignments.filter(
            (assignment) => assignment.roommateId === roommate.id
          )
        : snapshot.derived.completedThisWeek.filter(
            (assignment) => assignment.roommateId === roommate.id
          );

    if (assignments.length === 0) {
      return `${roommate.name} did not complete a task ${scopeLabel}.`;
    }

    if (assignments.length === 1) {
      const assignment = assignments[0];
      if (!assignment) {
        return `${roommate.name} did not complete a task ${scopeLabel}.`;
      }
      if (
        assignment.resolutionType === "rescued" &&
        assignment.rescuedByRoommateName &&
        normalizeMatchText(assignment.rescuedByRoommateName) !==
          normalizeMatchText(roommate.name)
      ) {
        return `No — ${roommate.name} did not finish ${assignment.choreTitle} ${scopeLabel}. ${assignment.rescuedByRoommateName} rescued it.`;
      }

      return `Yes — ${roommate.name} finished ${assignment.choreTitle} ${scopeLabel}.`;
    }

    return [
      `${roommate.name}'s completions ${scopeLabel}:`,
      ...assignments.map((assignment) => {
        if (
          assignment.resolutionType === "rescued" &&
          assignment.rescuedByRoommateName &&
          normalizeMatchText(assignment.rescuedByRoommateName) !==
            normalizeMatchText(roommate.name)
        ) {
          return `• ${assignment.choreTitle} was rescued by ${assignment.rescuedByRoommateName}`;
        }
        return `• ${assignment.choreTitle}`;
      })
    ].join("\n");
  }

  if (contextType === "TASK_OWNER") {
    if (!effectiveChoreTitle) {
      return null;
    }
    const ownerAssignments =
      effectiveScope === "NEXT_WEEK"
        ? snapshot.derived.dueNextWeek
        : effectiveScope === "TODAY"
          ? snapshot.derived.dueToday
          : effectiveScope === "TOMORROW"
            ? snapshot.derived.dueTomorrow
            : effectiveScope === "THIS_MONTH"
              ? snapshot.derived.dueThisMonth
              : effectiveScope === "UPCOMING"
                ? snapshot.derived.dueUpcoming
                : snapshot.derived.dueThisWeek;

    const currentWeekMatch = ownerAssignments.find(
      (assignment) =>
        normalizeMatchText(assignment.choreTitle) ===
          normalizeMatchText(effectiveChoreTitle)
    );
    if (currentWeekMatch) {
      if (
        currentWeekMatch.resolutionType === "rescued" &&
        currentWeekMatch.rescuedByRoommateName
      ) {
        return `${currentWeekMatch.choreTitle} ${scopeLabel} was assigned to ${currentWeekMatch.roommateName}, and ${currentWeekMatch.rescuedByRoommateName} ended up doing it.`;
      }

      return `${currentWeekMatch.choreTitle} ${scopeLabel} is ${currentWeekMatch.roommateName}'s task.`;
    }

    const upcomingMatch = snapshot.assignments.find(
      (assignment) =>
        normalizeMatchText(assignment.choreTitle) ===
          normalizeMatchText(effectiveChoreTitle) &&
        assignment.status === "pending"
    );

    if (upcomingMatch) {
      return `${upcomingMatch.choreTitle} is next on ${upcomingMatch.roommateName}, due ${formatShortDueDate(upcomingMatch.dueDate)}.`;
    }
  }

  return null;
}

async function getPendingAssignmentsForInterpretationAsync(
  actorRoommateId: number | null,
  trustedProxy: boolean,
  body: string
) {
  const allPendingAssignments = await listAllPendingAssignmentsAsync();
  const aliasTitle = resolveAssignmentAliasTitle(body);
  const mentionedBody = normalizeMatchText(body);
  const scopedAssignments = trustedProxy
    ? allPendingAssignments
    : actorRoommateId
      ? await listPendingAssignmentsForRoommateAsync(actorRoommateId)
      : [];

  const selectedAssignments = new Map<number, Assignment>();
  for (const assignment of scopedAssignments) {
    selectedAssignments.set(assignment.id, assignment);
  }

  if (!trustedProxy) {
    if (aliasTitle) {
      for (const assignment of allPendingAssignments) {
        if (
          normalizeMatchText(assignment.choreTitle) ===
          normalizeMatchText(aliasTitle)
        ) {
          selectedAssignments.set(assignment.id, assignment);
        }
      }
    }

    const roommates = await listRoommatesAsync();
    const mentionedIds = new Set(
      roommates
        .filter((roommate) => mentionedBody.includes(normalizeMatchText(roommate.name)))
        .map((roommate) => roommate.id)
    );

    if (mentionedIds.size > 0 || looksLikeRescueLanguage(body)) {
      for (const assignment of allPendingAssignments) {
        if (
          mentionedIds.has(assignment.roommateId) ||
          (
            looksLikeRescueLanguage(body) &&
            aliasTitle &&
            normalizeMatchText(assignment.choreTitle) === normalizeMatchText(aliasTitle)
          )
        ) {
          selectedAssignments.set(assignment.id, assignment);
        }
      }
    }

    if (scopedAssignments.length === 0 && looksLikeCompletionLanguage(body)) {
      for (const assignment of allPendingAssignments) {
        selectedAssignments.set(assignment.id, assignment);
      }
    }
  }

  return Array.from(selectedAssignments.values()).map((assignment) => ({
    id: assignment.id,
    choreTitle: assignment.choreTitle,
    roommateName: assignment.roommateName,
    dueDate: assignment.dueDate,
    status: assignment.status
  }));
}

async function resolveAssignmentIdAsync(
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

  const assignment = await getOldestPendingAssignmentAsync(roommateId);
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

async function notifyAssignmentHandoffAsync(reassigned: Assignment) {
  const outboundTo = resolveOutboundWhatsappNumber(reassigned.whatsappNumber);
  const composed = await composeWhatsappConversationMessage({
    kind: "handoff_notice",
    roommateName: reassigned.roommateName,
    choreTitle: reassigned.choreTitle,
    dueDate: reassigned.dueDate,
    contextNote: reassigned.statusNote
  });

  try {
    await sendWhatsappMessage(reassigned.whatsappNumber, composed.text);
    rememberLastOutboundAssignment(outboundTo, reassigned.id);
    await addEventLogAsync({
      roommateId: reassigned.roommateId,
      assignmentId: reassigned.id,
      eventType: "HANDOFF_MESSAGE_SENT",
      payload: JSON.stringify({
        originalTo: reassigned.whatsappNumber,
        effectiveTo: outboundTo
      })
    });
    await addEventLogAsync({
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
    await addEventLogAsync({
      roommateId: reassigned.roommateId,
      assignmentId: reassigned.id,
      eventType: "HANDOFF_MESSAGE_FAILED",
      payload: JSON.stringify({
        error: error instanceof Error ? error.message : "unknown"
      })
    });
  }
}

async function sendRescueRequestToHouseAsync(assignment: Assignment, reason: string | null) {
  const candidates = await listRescueCandidatesForAssignmentAsync(assignment.id);
  if (candidates.length === 0) {
    return 0;
  }

  await addEventLogAsync({
    roommateId: assignment.roommateId,
    assignmentId: assignment.id,
    eventType: "RESCUE_REQUEST_OPENED",
    payload: JSON.stringify({
      reason,
      candidateRoommateIds: candidates.map((candidate) => candidate.id)
    })
  });

  for (const candidate of candidates) {
    const outboundTo = resolveOutboundWhatsappNumber(candidate.whatsappNumber);
    const composed = await composeWhatsappConversationMessage({
      kind: "rescue_request",
      roommateName: candidate.name,
      choreTitle: assignment.choreTitle,
      dueDate: assignment.dueDate,
      contextNote: reason ?? `${assignment.roommateName} can’t take it this week`
    });

    try {
      await sendWhatsappMessage(candidate.whatsappNumber, composed.text);
      rememberLastOutboundAssignment(outboundTo, assignment.id);
      await addEventLogAsync({
        roommateId: candidate.id,
        assignmentId: assignment.id,
        eventType: "CONVERSATION_MESSAGE_SENT",
        payload: JSON.stringify({
          promptType: "rescue_request",
          originalTo: candidate.whatsappNumber,
          effectiveTo: outboundTo,
          source: composed.source,
          model: composed.model,
          requestedByRoommateId: assignment.roommateId
        })
      });
    } catch (error) {
      await addEventLogAsync({
        roommateId: candidate.id,
        assignmentId: assignment.id,
        eventType: "RESCUE_REQUEST_FAILED",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }

  return candidates.length;
}

async function sendConversationalReplyAsync(params: {
  to: string;
  roommateId: number | null;
  assignmentId: number | null;
  promptType:
    | "done_confirmation"
    | "skip_confirmation"
    | "rescue_confirmation"
    | "postpone_confirmation"
    | "resolution_options"
    | "escalation_nudge"
    | "rescue_request";
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
  await addEventLogAsync({
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

async function handleDoneAsync(
  actor: { whatsappNumber: string; roommateId: number | null; trustedProxy: boolean },
  assignmentIdInput?: string,
  fallbackAssignmentId?: number | null
): Promise<CommandResult> {
  const assignmentId = await resolveAssignmentIdAsync(
    actor.roommateId,
    assignmentIdInput,
    fallbackAssignmentId
  );
  if (!assignmentId) {
    return { message: "No pending chore found to mark as done." };
  }

  const assignment = await getAssignmentByIdAsync(assignmentId);
  if (!assignment || !canOperateOnAssignment(assignment, actor.roommateId, actor.trustedProxy)) {
    return { message: `Assignment #${assignmentId} is not available for this sender.` };
  }

  if (assignment.status !== "pending") {
    return { message: `Assignment #${assignmentId} is already ${assignment.status}.` };
  }

  await updateAssignmentStatusAsync(assignmentId, "done", null);
  await addEventLogAsync({
    roommateId: actor.roommateId,
    assignmentId,
    eventType: "DONE",
    payload: JSON.stringify({
      source: "whatsapp",
      trustedProxy: actor.trustedProxy
    })
  });

  await shiftNextWeeklyWindowAfterSundayCompletionAsync(
    assignmentId,
    "shifted because this week's completion happened over the weekend"
  );

  const streak = await getRoommateStreakSummaryAsync(assignment.roommateId);
  const streakMessage =
    streak.currentStreak >= 5
      ? ` 🔥 Huge win. You kept a ${streak.currentStreak} task streak alive.`
      : streak.currentStreak >= 2
        ? ` 🔥 Nice, that keeps your streak alive at ${streak.currentStreak}.`
        : "";

  return {
    message: `✅ Nice, I marked ${assignment.choreTitle} as done.${streakMessage}`,
    assignmentId
  };
}

async function handleSkipAsync(
  actor: { whatsappNumber: string; roommateId: number | null; trustedProxy: boolean },
  assignmentIdInput?: string,
  reason?: string,
  reassignToNext = false,
  fallbackAssignmentId?: number | null
): Promise<CommandResult> {
  const assignmentId = await resolveAssignmentIdAsync(
    actor.roommateId,
    assignmentIdInput,
    fallbackAssignmentId
  );
  if (!assignmentId) {
    return { message: "No pending chore found to skip." };
  }

  const assignment = await getAssignmentByIdAsync(assignmentId);
  if (!assignment || !canOperateOnAssignment(assignment, actor.roommateId, actor.trustedProxy)) {
    return { message: `Assignment #${assignmentId} is not available for this sender.` };
  }

  if (assignment.status !== "pending") {
    return { message: `Assignment #${assignmentId} is already ${assignment.status}.` };
  }

  await updateAssignmentStatusAsync(assignmentId, "skipped", reason ?? null, {
    resolutionType: "skipped",
    responsibleRoommateId: assignment.roommateId,
    strikeApplied: 0
  });
  await addEventLogAsync({
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

  if (assignment.taskMode === "fixed_schedule") {
    const askedCount = await sendRescueRequestToHouseAsync(assignment, reason ?? null);
    if (askedCount > 0) {
      return {
        message: `🙂 Okay, I marked ${assignment.choreTitle} as skipped for you and asked the house if someone can pick it up. If nobody answers, I’ll move it to the next free person.`,
        assignmentId
      };
    }
  }

  const reassigned = await handoffAssignmentToNextRoommateAsync(assignmentId, reason ?? null);
  if (!reassigned) {
    return {
      message: `🙂 Okay, ${assignment.choreTitle} is skipped for this week. I put it at the front of next week's list because nobody was free to swap in.`,
      assignmentId
    };
  }

  await notifyAssignmentHandoffAsync(reassigned);
  return {
    message: `🔁 Okay, I switched ${assignment.choreTitle} over to ${reassigned.roommateName} for this week.`,
    assignmentId
  };
}

async function handleRescheduleAsync(
  actor: { whatsappNumber: string; roommateId: number | null; trustedProxy: boolean },
  assignmentIdInput: string | undefined,
  targetDateInput: string | null,
  reason: string | null,
  fallbackAssignmentId?: number | null
): Promise<CommandResult> {
  const assignmentId = await resolveAssignmentIdAsync(
    actor.roommateId,
    assignmentIdInput,
    fallbackAssignmentId
  );
  if (!assignmentId) {
    return { message: "No pending chore found to reschedule." };
  }

  const assignment = await getAssignmentByIdAsync(assignmentId);
  if (!assignment || !canOperateOnAssignment(assignment, actor.roommateId, actor.trustedProxy)) {
    return { message: `Assignment #${assignmentId} is not available for this sender.` };
  }

  if (assignment.status !== "pending") {
    return { message: `Assignment #${assignmentId} is already ${assignment.status}.` };
  }

  const settings = await getHouseSettingsAsync();
  const timezone = settings.timezone || "Europe/Berlin";
  const parsedTargetDate =
    targetDateInput ?? parseRequestedDueDate(reason ?? "", timezone);

  if (!parsedTargetDate) {
    return {
      message: "Tell me the exact day/date and I will move it. Example: \"Move this to Sunday\"."
    };
  }

  if (toUtcDay(parsedTargetDate) <= toUtcDay(assignment.dueDate)) {
    return {
      message: `I can only move ${assignment.choreTitle} to a later date than ${assignment.dueDate}.`
    };
  }

  const weekEndDate = getSundayWeekEndForIsoDate(assignment.dueDate);
  if (toUtcDay(parsedTargetDate) > toUtcDay(weekEndDate)) {
    return {
      message: `I can move ${assignment.choreTitle} later in the same week, but not into next week. Try Saturday or Sunday.`
    };
  }

  const previousDueDate = assignment.dueDate;
  const rescheduled = await rescheduleAssignmentToDateAsync(
    assignmentId,
    parsedTargetDate,
    reason ?? "rescheduled from WhatsApp"
  );
  if (!rescheduled) {
    return {
      message: `I couldn't move ${assignment.choreTitle} right now.`
    };
  }

  await addEventLogAsync({
    roommateId: actor.roommateId,
    assignmentId,
    eventType: "ASSIGNMENT_RESCHEDULED",
    payload: JSON.stringify({
      source: "whatsapp",
      previousDueDate: assignment.dueDate,
      dueDate: parsedTargetDate,
      reason: reason ?? null
    })
  });

  const targetWeekday = parseIsoDate(parsedTargetDate).getUTCDay();
  const shifted = await shiftNextWeeklyWindowAfterWeekendDelayAsync(
    assignmentId,
    previousDueDate,
    "shifted because this week was delayed to the weekend"
  );
  const weekendShiftNote =
    (targetWeekday === 6 || targetWeekday === 0) && shifted
      ? " I also adjusted next week’s window in the app so spacing stays fair."
      : "";

  return {
    message: `🙂 Done. I moved ${assignment.choreTitle} to ${parsedTargetDate}.${weekendShiftNote}`,
    assignmentId
  };
}

async function handleRescueAsync(
  actor: { whatsappNumber: string; roommateId: number | null; trustedProxy: boolean },
  assignmentIdInput?: string,
  fallbackAssignmentId?: number | null
): Promise<CommandResult> {
  if (!actor.roommateId && !actor.trustedProxy) {
    return {
      message: "Your number is not registered yet. Ask the admin to add you first."
    };
  }

  const assignmentId = await resolveAssignmentIdAsync(
    actor.roommateId,
    assignmentIdInput,
    fallbackAssignmentId
  );
  if (!assignmentId || !Number.isInteger(assignmentId)) {
    return { message: "Use RESCUE [id] to rescue a specific chore." };
  }

  const assignment = await getAssignmentByIdAsync(assignmentId);
  if (!assignment) {
    return { message: `Assignment #${assignmentId} was not found.` };
  }

  if (assignment.status !== "pending") {
    return { message: `Assignment #${assignmentId} is already ${assignment.status}.` };
  }

  const rescuerRoommateId = actor.roommateId ?? assignment.roommateId;
  const rescued = await rescueAssignmentAsync(assignmentId, rescuerRoommateId, "rescued via WhatsApp");
  if (!rescued) {
    return { message: `Unable to rescue assignment #${assignmentId} right now.` };
  }

  await addEventLogAsync({
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

async function handleConversationalReplyAsync(actor: {
  whatsappNumber: string;
  roommateId: number | null;
  trustedProxy: boolean;
}, replyType: AiWhatsappRoute["replyType"], body: string, targetDate: string | null) {
  const latestPrompt = await getLatestConversationPromptForWhatsappAsync(actor.whatsappNumber);
  const assignmentId =
    latestPrompt?.assignmentId ?? getLastReferencedAssignmentId(actor.whatsappNumber);

  if (!latestPrompt?.promptType || !assignmentId || !replyType) {
    return null;
  }

  const assignment = await getAssignmentByIdAsync(assignmentId);

  if (
    latestPrompt.promptType === "rescue_request" &&
    assignment &&
    assignment.status === "skipped"
  ) {
    if (!actor.roommateId) {
      return {
        message: "I need a registered roommate number before I can hand a task over."
      };
    }

    if (replyType === "AFFIRMATIVE") {
      const existingPickup = (await listAllPendingAssignmentsAsync()).find(
        (pending) =>
          pending.choreId === assignment.choreId &&
          pending.dueDate === assignment.dueDate &&
          pending.roommateId !== assignment.roommateId
      );

      if (existingPickup) {
        return {
          message: `${existingPickup.roommateName} already picked up ${assignment.choreTitle} for this week 🙂`,
          assignmentId
        };
      }

      const reassigned = await handoffAssignmentToRoommateAsync(
        assignmentId,
        actor.roommateId,
        "accepted in WhatsApp rescue request"
      );

      if (!reassigned) {
        return {
          message: `I couldn't place ${assignment.choreTitle} on you right now.`
        };
      }

      await addEventLogAsync({
        roommateId: actor.roommateId,
        assignmentId,
        eventType: "RESCUE_REQUEST_RESOLVED",
        payload: JSON.stringify({
          resolution: "accepted",
          acceptedByRoommateId: actor.roommateId
        })
      });

      return {
        message: `😍 Thank you. I put ${assignment.choreTitle} on you for this week.`,
        assignmentId: reassigned.id
      };
    }

    if (replyType === "NEGATIVE") {
      return {
        message: "No worries 🙂 I’ll keep checking with the house.",
        assignmentId
      };
    }

    return null;
  }

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
    if (replyType === "AFFIRMATIVE") {
      await handleDoneAsync(actor, String(assignmentId), assignmentId);
      const streak = await getRoommateStreakSummaryAsync(assignment.roommateId);
      const streakContext =
        streak.currentStreak >= 2
          ? `They are on a ${streak.currentStreak} task streak right now. Congratulate them for keeping it alive in a playful Duolingo or Snapchat streak style.`
          : null;
      const message = await sendConversationalReplyAsync({
        to: actor.whatsappNumber,
        roommateId: assignment.roommateId,
        assignmentId,
        promptType: "done_confirmation",
        roommateName: assignment.roommateName,
        choreTitle: assignment.choreTitle,
        dueDate: assignment.dueDate,
        contextNote: streakContext,
        deliver: false
      });
      return { message, assignmentId };
    }

    if (
      replyType === "NEGATIVE" &&
      (
        latestPrompt.promptType === "day_of_reminder" ||
        latestPrompt.promptType === "assignment_reminder" ||
        latestPrompt.promptType === "completion_check" ||
        latestPrompt.promptType === "escalation_nudge"
      )
    ) {
      const message = await sendConversationalReplyAsync({
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
    const settings = await getHouseSettingsAsync();
    const requestedDate = targetDate ?? parseRequestedDueDate(body, settings.timezone || "Europe/Berlin");

    if (requestedDate) {
      return await handleRescheduleAsync(
        actor,
        assignmentId ? String(assignmentId) : undefined,
        requestedDate,
        "rescheduled in WhatsApp conversation",
        assignmentId
      );
    }

    if (replyType === "TOMORROW") {
      const postponed = await postponeAssignmentToTomorrowAsync(
        assignmentId,
        "postponed in WhatsApp conversation"
      );
      if (!postponed) {
        return {
          message: `I can only postpone ${assignment.choreTitle} within this same week, not into next week.`
        };
      }

      const message = await sendConversationalReplyAsync({
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

    if (replyType === "REASSIGN") {
      return await handleSkipAsync(
        actor,
        String(assignmentId),
        "reassigned in WhatsApp conversation",
        true,
        assignmentId
      );
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
  const actorRoommate = await findRoommateByWhatsappNumberAsync(params.from);
  const actor = {
    whatsappNumber: params.from,
    roommateId: actorRoommate?.id ?? null,
    trustedProxy
  };

  if (
    actorRoommate &&
    !trustedProxy &&
    !(await hasRoommateReceivedWhatsappWelcomeAsync(actorRoommate.id))
  ) {
    await addEventLogAsync({
      roommateId: actorRoommate.id,
      assignmentId: null,
      eventType: "WHATSAPP_WELCOME_SENT",
      payload: JSON.stringify({
        source: "first_inbound",
        from: params.from
      })
    });

    return {
      message: await buildWhatsappWelcomeMessageAsync(actorRoommate.id)
    };
  }

  if (!actorRoommate && !trustedProxy) {
    return {
      message: "Your number is not registered yet. Ask the admin to add you first."
    };
  }

  const latestPrompt = await getLatestConversationPromptForWhatsappAsync(params.from);
  const pendingAssignments = await getPendingAssignmentsForInterpretationAsync(
    actor.roommateId,
    trustedProxy,
    normalized
  );
  const householdSnapshot = await buildHouseholdQuestionSnapshotAsync();
  const latestHouseQuestionContext =
    lastHouseQuestionContextByWhatsapp.get(params.from) ?? null;
  const routed = await routeWhatsappMessageWithAi({
    body: normalized,
    senderName: actorRoommate?.name ?? (trustedProxy ? "Trusted proxy" : null),
    trustedProxy,
    lastReferencedAssignmentId: getLastReferencedAssignmentId(params.from),
    latestPromptType: latestPrompt?.promptType ?? null,
    latestHouseQuestionContext,
    candidateAssignments: pendingAssignments.map((assignment) => ({
      id: assignment.id,
      choreTitle: assignment.choreTitle,
      roommateName: assignment.roommateName,
      dueDate: assignment.dueDate,
      status: assignment.status
    })),
    snapshot: householdSnapshot
  });
  const route = routed.route;

  const resolveAssignmentCandidate = () => {
    if (route.assignmentId) {
      return {
        assignmentId: route.assignmentId,
        ambiguous: false
      };
    }

    if (
      route.action !== "DONE" &&
      route.action !== "SKIP" &&
      route.action !== "SKIP_REASSIGN" &&
      route.action !== "RESCHEDULE" &&
      route.action !== "RESCUE"
    ) {
      return {
        assignmentId: null,
        ambiguous: false
      };
    }

    const contextualBody = [normalized, route.roommateName, route.choreTitle].filter(Boolean).join(" ");
    return resolveAssignmentFromContext({
      body: contextualBody,
      action: route.action,
      pendingAssignments: pendingAssignments.map((assignment) => ({
        id: assignment.id,
        choreTitle: assignment.choreTitle,
        roommateName: assignment.roommateName,
        dueDate: assignment.dueDate
      })),
      lastReferencedAssignmentId: getLastReferencedAssignmentId(params.from)
    });
  };

  const resolvedAssignment =
    route.kind === "ACTION" ? resolveAssignmentCandidate() : { assignmentId: route.assignmentId, ambiguous: false };
  const finalAssignmentId = route.assignmentId ?? resolvedAssignment.assignmentId ?? null;
  const assignmentIdInput = finalAssignmentId ? String(finalAssignmentId) : undefined;
  const resolutionSuggestions =
    "suggestions" in resolvedAssignment ? resolvedAssignment.suggestions : undefined;
  const missingAliasTitle =
    "missingAliasTitle" in resolvedAssignment ? resolvedAssignment.missingAliasTitle : null;

  await addEventLogAsync({
    roommateId: actor.roommateId,
    assignmentId: finalAssignmentId,
    eventType: "WHATSAPP_ROUTE_INTERPRETED",
    payload: JSON.stringify({
      source: routed.source,
      model: routed.model,
      kind: route.kind,
      command: route.command,
      action: route.action,
      targetDate: route.targetDate,
      resolvedAssignmentId: finalAssignmentId,
      trustedProxy
    })
  });

  if (route.kind === "HELP") {
    return { message: buildHelpMessage() };
  }

  if (route.kind === "COMMAND") {
    if (route.command === "STATUS") {
      return { message: await buildStatusMessageAsync() };
    }

    if (route.command === "MONTH") {
      return { message: await buildTasksMessageAsync(params.from, "month") };
    }

    return {
      message: trustedProxy ? await buildStatusMessageAsync() : await buildTasksMessageAsync(params.from, "week")
    };
  }

  if (route.kind === "QUESTION") {
    rememberHouseQuestionContext(params.from, normalized, route, householdSnapshot);
    const structuredAnswer = buildStructuredQuestionAnswer({
      body: normalized,
      route,
      snapshot: householdSnapshot,
      latestContext: latestHouseQuestionContext
    });
    if (structuredAnswer) {
      return { message: structuredAnswer };
    }
    if (route.answer) {
      return { message: route.answer };
    }
    return {
      message: "I couldn't answer that clearly from the current house data. Try asking it in a slightly different way."
    };
  }

  if (route.kind === "EXPENSE") {
    if (!actorRoommate || !route.expenseTitle || !route.amountCents) {
      return { message: "I need the item and amount to log that expense." };
    }

    const activeRoommates = householdSnapshot.roommates.filter((roommate) => roommate.isActive);
    const excludedIds = new Set(
      activeRoommates
        .filter((roommate) =>
          route.excludedRoommateNames.some(
            (name) => normalizeMatchText(name) === normalizeMatchText(roommate.name)
          )
        )
        .map((roommate) => roommate.id)
    );
    const includedRoommateIds = activeRoommates
      .map((roommate) => roommate.id)
      .filter((roommateId) => !excludedIds.has(roommateId));

    const expense = await createExpenseAsync({
      title: route.expenseTitle,
      amountCents: route.amountCents,
      paidByRoommateId: actorRoommate.id,
      note: excludedIds.size > 0 ? `Excluded ${excludedIds.size} roommate(s)` : null,
      includedRoommateIds
    });

    if (!expense) {
      return { message: "I couldn't log that expense right now." };
    }

    await notifyHouseExpenseAddedAsync(expense, { excludeRoommateIds: [actorRoommate.id] });

    const splitCount = expense.shares.length;
    const perPerson = expense.shares[0]?.shareCents ?? 0;
    return {
      message:
        expense.excludedRoommateNames.length > 0
          ? `😍 Logged ${expense.title} for ${(expense.amountCents / 100).toFixed(2)} EUR. Split between ${splitCount} people, ${(perPerson / 100).toFixed(2)} EUR each, excluding ${expense.excludedRoommateNames.join(", ")} ♥️`
          : `😍 Logged ${expense.title} for ${(expense.amountCents / 100).toFixed(2)} EUR. Split between ${splitCount} people, ${(perPerson / 100).toFixed(2)} EUR each ♥️`
    };
  }

  if (route.kind === "SETTLEMENT") {
    if (!actorRoommate || !route.settlementToRoommateName || !route.amountCents) {
      return { message: "I need who you paid and the amount to log that payment." };
    }

    const counterparty = householdSnapshot.roommates.find(
      (roommate) =>
        normalizeMatchText(roommate.name) === normalizeMatchText(route.settlementToRoommateName ?? "") &&
        roommate.id !== actorRoommate.id
    );
    if (!counterparty) {
      return { message: `I couldn't find ${route.settlementToRoommateName}.` };
    }

    const balance = householdSnapshot.balances.find(
      (entry) =>
        normalizeMatchText(entry.fromRoommateName) === normalizeMatchText(actorRoommate.name) &&
        normalizeMatchText(entry.toRoommateName) === normalizeMatchText(counterparty.name)
    );

    const amountCents = Math.min(route.amountCents, balance?.amountCents ?? route.amountCents);
    const settlement = await createSettlementAsync({
      fromRoommateId: actorRoommate.id,
      toRoommateId: counterparty.id,
      amountCents,
      note: "Logged from chat"
    });

    if (!settlement) {
      return { message: "I couldn't record that payment right now." };
    }

    await notifyHouseSettlementAddedAsync(settlement, { excludeRoommateIds: [actorRoommate.id] });

    return {
      message: `😃 Logged your payment of ${(settlement.amountCents / 100).toFixed(2)} EUR to ${settlement.toRoommateName}. The dashboard balances are updated.`
    };
  }

  if (route.kind === "CONVERSATION_REPLY") {
    const conversationalResult = await handleConversationalReplyAsync(
      actor,
      route.replyType,
      normalized,
      route.targetDate
    );
    if (conversationalResult) {
      return conversationalResult;
    }
  }

  if (route.kind === "ACTION" && route.action) {
    if (!assignmentIdInput) {
      if (missingAliasTitle) {
        return {
          message: buildNoOpenAssignmentMessage(route.action, missingAliasTitle)
        };
      }
      return {
        message: buildClarifyAssignmentMessage({
          action: route.action,
          trustedProxy,
          pendingAssignments: pendingAssignments.map((assignment) => ({
            id: assignment.id,
            choreTitle: assignment.choreTitle,
            roommateName: assignment.roommateName,
            dueDate: assignment.dueDate
          })),
          suggestions: resolutionSuggestions
        })
      };
    }

    if (route.action === "DONE") {
      if (!trustedProxy && actor.roommateId) {
        const candidateAssignment = await getAssignmentByIdAsync(finalAssignmentId ?? Number(assignmentIdInput));
        if (
          candidateAssignment &&
          candidateAssignment.roommateId !== actor.roommateId &&
          candidateAssignment.status === "pending"
        ) {
          return await handleRescueAsync(actor, assignmentIdInput, finalAssignmentId);
        }
      }

      return await handleDoneAsync(actor, assignmentIdInput, finalAssignmentId);
    }

    if (route.action === "SKIP") {
      return await handleSkipAsync(
        actor,
        assignmentIdInput,
        route.reason ?? undefined,
        false,
        finalAssignmentId
      );
    }

    if (route.action === "SKIP_REASSIGN") {
      return await handleSkipAsync(
        actor,
        assignmentIdInput,
        route.reason ?? undefined,
        true,
        finalAssignmentId
      );
    }

    if (route.action === "RESCHEDULE") {
      return await handleRescheduleAsync(
        actor,
        assignmentIdInput,
        route.targetDate,
        route.reason ?? normalized,
        finalAssignmentId
      );
    }

    if (route.action === "RESCUE") {
      return await handleRescueAsync(actor, assignmentIdInput, finalAssignmentId);
    }
  }

  if (
    (route.kind === "UNKNOWN" || (route.kind === "ACTION" && !route.action)) &&
    actor.roommateId
  ) {
    const settings = await getHouseSettingsAsync();
    const fallbackTargetDate = parseRequestedDueDate(normalized, settings.timezone || "Europe/Berlin");
    if (fallbackTargetDate) {
      const fallbackAssignmentId =
        finalAssignmentId ?? (await getOldestPendingAssignmentAsync(actor.roommateId))?.id ?? null;
      if (fallbackAssignmentId) {
        return await handleRescheduleAsync(
          actor,
          String(fallbackAssignmentId),
          fallbackTargetDate,
          normalized,
          fallbackAssignmentId
        );
      }
    }
  }

  return {
    message: `I did not understand "${normalized}".\n\n${buildHelpMessage()}`
  };
}
