import type {
  AccountabilityState,
  FrequencyUnit,
  HouseholdSnapshot,
  ResolutionType,
  TaskMode,
  UiActivityEntry,
  UiBalanceEntry,
  UiChore,
  UiExpenseEntry,
  UiRoommate,
  UiSettlementEntry,
  UiTaskTemplate
} from "./types";
import { fetchBackendJson } from "./backend";

interface BackendHouseSettings {
  id: number;
  houseName: string;
  timezone: string;
  autoRemindersEnabled: number;
  weeklySummaryEnabled: number;
  summaryDay: string;
  summaryHour: number;
  defaultPenaltyAmountCents: number;
  defaultReminderLeadMinutes: number;
  penaltyLabel: string;
  weeklyAchievementLabel: string;
  monthlyAchievementLabel: string;
  updatedAt: string;
}

interface BackendRoommate {
  id: number;
  name: string;
  whatsappNumber: string;
  isActive: number;
  sortOrder: number;
  reminderEnabled: number;
  reminderHour: number;
  reminderLeadMinutes: number;
  notes: string | null;
  penaltyBalanceCents: number;
  pendingCount: number;
  completedCount: number;
  skippedCount: number;
  openPenaltyCount: number;
}

interface BackendAssignment {
  id: number;
  choreId: number;
  roommateId: number;
  dueDate: string;
  windowStartDate: string | null;
  windowEndDate: string | null;
  status: "pending" | "done" | "skipped";
  statusNote: string | null;
  resolutionType: ResolutionType;
  responsibleRoommateId: number;
  rescuedByRoommateId: number | null;
  escalationLevel: number;
  strikeApplied: number;
  rescueCreditApplied: number;
  accountabilityState: AccountabilityState;
  createdAt: string;
  completedAt: string | null;
  reminderSentAt: string | null;
  penaltyAppliedAt: string | null;
  choreTitle: string;
  choreDescription: string | null;
  cadence: string;
  area: string;
  points: number;
  frequencyInterval: number;
  frequencyUnit: FrequencyUnit;
  taskMode: TaskMode;
  softReminderAfterHours: number;
  repeatReminderEveryHours: number;
  escalateAfterHours: number;
  advanceRotationOn: string;
  isOptional: number;
  parentChoreId: number | null;
  defaultDueHour: number;
  reminderLeadMinutes: number;
  penaltyRuleId: number | null;
  penaltyRuleTitle: string | null;
  parentChoreTitle: string | null;
  roommateName: string;
  responsibleRoommateName: string;
  rescuedByRoommateName: string | null;
  whatsappNumber: string;
  roommateReminderEnabled: number;
  roommateReminderHour: number;
  roommateReminderLeadMinutes: number;
}

interface BackendEvent {
  id: number;
  assignmentId: number | null;
  eventType: string;
  payloadJson: string | null;
  createdAt: string;
  roommateName: string | null;
}

interface BackendExpenseShare {
  expenseId: number;
  roommateId: number;
  roommateName: string;
  shareCents: number;
}

interface BackendExpense {
  id: number;
  title: string;
  amountCents: number;
  currency: string;
  paidByRoommateId: number;
  paidByRoommateName: string;
  note: string | null;
  createdAt: string;
  excludedRoommateIds: number[];
  excludedRoommateNames: string[];
  shares: BackendExpenseShare[];
}

interface BackendBalance {
  fromRoommateId: number;
  fromRoommateName: string;
  toRoommateId: number;
  toRoommateName: string;
  amountCents: number;
  currency: string;
}

interface BackendSettlement {
  id: number;
  fromRoommateId: number;
  fromRoommateName: string;
  toRoommateId: number;
  toRoommateName: string;
  amountCents: number;
  currency: string;
  note: string | null;
  createdAt: string;
}

interface BackendHouseholdSnapshot {
  settings: BackendHouseSettings;
  roommates: BackendRoommate[];
  chores: Array<{
    id: number;
    title: string;
    description: string | null;
    cadence: string;
    area: string;
    points: number;
    frequencyInterval: number;
    frequencyUnit: FrequencyUnit;
    taskMode: TaskMode;
    softReminderAfterHours: number;
    repeatReminderEveryHours: number;
    escalateAfterHours: number;
    advanceRotationOn: string;
    isOptional: number;
    parentChoreId: number | null;
    defaultDueHour: number;
    defaultAssigneeId: number | null;
    isActive: number;
    reminderLeadMinutes: number;
    penaltyRuleId: number | null;
    createdAt: string;
    updatedAt: string;
    defaultAssigneeName: string | null;
    parentChoreTitle: string | null;
    penaltyRuleTitle: string | null;
  }>;
  assignments: BackendAssignment[];
  events: BackendEvent[];
  expenses: BackendExpense[];
  settlements: BackendSettlement[];
  balances: BackendBalance[];
}

const SNAPSHOT_CACHE_TTL_MS = 15_000;

let snapshotCache:
  | {
      value: HouseholdSnapshot;
      expiresAt: number;
    }
  | null = null;
let snapshotRefreshInFlight: Promise<HouseholdSnapshot> | null = null;

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR"
  }).format(amount);
}

function formatDateLabel(dateInput: string, status: UiChore["status"]) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);

  if (status === "done") return `Completed ${formatted}`;
  if (status === "skipped") return `Skipped ${formatted}`;
  if (status === "rescued") return `Rescued ${formatted}`;
  return `Due ${formatted}`;
}

function formatShortRelative(dateInput: string) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function inferArea(title: string, description: string | null) {
  const value = `${title} ${description ?? ""}`.toLowerCase();
  if (value.includes("bathroom")) return "Bathroom";
  if (value.includes("kitchen")) return "Kitchen";
  if (value.includes("trash") || value.includes("bin")) return "Utilities";
  if (value.includes("hall")) return "Hallway";
  if (value.includes("living")) return "Living Room";
  return "Shared space";
}

function formatFrequencyLabel(interval: number, unit: FrequencyUnit) {
  if (interval === 1) return `Every ${unit}`;
  return `Every ${interval} ${unit}s`;
}

function mapAssignmentStatus(assignment: BackendAssignment): UiChore["status"] {
  if (assignment.resolutionType === "rescued") return "rescued";
  if (assignment.status === "done" || assignment.status === "skipped") return assignment.status;

  const dueAt = new Date(
    `${assignment.dueDate}T${String(assignment.defaultDueHour).padStart(2, "0")}:00:00`
  );

  if (!Number.isNaN(dueAt.getTime()) && dueAt < new Date()) {
    return "overdue";
  }

  return "pending";
}

function mapRoommates(roommates: BackendRoommate[]): UiRoommate[] {
  return roommates.map((roommate) => {
    const totalTracked = roommate.completedCount + roommate.skippedCount;
    const reliability =
      totalTracked === 0 ? null : Math.round((roommate.completedCount / totalTracked) * 100);

    return {
      id: String(roommate.id),
      name: roommate.name,
      whatsappNumber: roommate.whatsappNumber,
      isActive: Boolean(roommate.isActive),
      sortOrder: roommate.sortOrder,
      reliability,
      pendingCount: roommate.pendingCount,
      completedCount: roommate.completedCount,
      missedCount: roommate.skippedCount,
      strikeCount: roommate.skippedCount,
      rescueCount: 0
    };
  });
}

function mapAssignments(assignments: BackendAssignment[], roommates: UiRoommate[]): UiChore[] {
  return assignments.map((assignment) => {
    const status = mapAssignmentStatus(assignment);
    const dueAt =
      assignment.completedAt ??
      `${assignment.dueDate}T${String(assignment.defaultDueHour).padStart(2, "0")}:00:00`;
    const windowStartAt = assignment.windowStartDate
      ? `${assignment.windowStartDate}T00:00:00`
      : null;
    const windowEndAt = assignment.windowEndDate
      ? `${assignment.windowEndDate}T23:59:59`
      : null;
    const assignee = roommates.find((roommate) => roommate.id === String(assignment.roommateId));

    return {
      id: String(assignment.id),
      title: assignment.choreTitle,
      description: assignment.choreDescription ?? "Shared apartment task",
      assigneeId: String(assignment.roommateId),
      assignee: assignee?.name ?? assignment.roommateName,
      dueAt,
      windowStartAt,
      windowEndAt,
      dueLabel: formatDateLabel(dueAt, status),
      cadence: assignment.cadence,
      area: assignment.area || inferArea(assignment.choreTitle, assignment.choreDescription),
      points: assignment.points,
      reminderEnabled: Boolean(assignment.roommateReminderEnabled),
      taskMode: assignment.taskMode,
      accountabilityState: assignment.accountabilityState,
      resolutionType: assignment.resolutionType,
      responsibleRoommateId: String(assignment.responsibleRoommateId),
      responsibleRoommate: assignment.responsibleRoommateName,
      rescuedByRoommateId: assignment.rescuedByRoommateId
        ? String(assignment.rescuedByRoommateId)
        : null,
      rescuedByRoommate: assignment.rescuedByRoommateName,
      escalationLevel: assignment.escalationLevel,
      strikeApplied: Boolean(assignment.strikeApplied),
      rescueCreditApplied: Boolean(assignment.rescueCreditApplied),
      status
    };
  });
}

function mapTaskTemplates(
  chores: BackendHouseholdSnapshot["chores"],
  assignments: BackendAssignment[],
  roommates: UiRoommate[]
): UiTaskTemplate[] {
  const nextAssignmentByChoreId = new Map<number, BackendAssignment>();
  const sortedAssignments = [...assignments].sort((left, right) => {
    const leftKey = `${left.dueDate}T${String(left.defaultDueHour).padStart(2, "0")}:00:00`;
    const rightKey = `${right.dueDate}T${String(right.defaultDueHour).padStart(2, "0")}:00:00`;
    return leftKey.localeCompare(rightKey) || left.id - right.id;
  });

  for (const assignment of sortedAssignments) {
    if (assignment.status !== "pending") continue;
    if (!nextAssignmentByChoreId.has(assignment.choreId)) {
      nextAssignmentByChoreId.set(assignment.choreId, assignment);
    }
  }

  return chores.map((chore) => {
    const nextAssignment = nextAssignmentByChoreId.get(chore.id);
    const assignee =
      roommates.find((roommate) => roommate.id === String(nextAssignment?.roommateId ?? chore.defaultAssigneeId)) ??
      roommates[0];
    const nextDueAt = nextAssignment
      ? `${nextAssignment.dueDate}T${String(nextAssignment.defaultDueHour).padStart(2, "0")}:00:00`
      : null;

    return {
      id: String(chore.id),
      title: chore.title,
      description: chore.description ?? "Recurring household task",
      area: chore.area || inferArea(chore.title, chore.description),
      assigneeId: assignee?.id ?? "",
      assignee: nextAssignment?.roommateName ?? assignee?.name ?? chore.defaultAssigneeName ?? "Unassigned",
      frequencyInterval: chore.frequencyInterval || 1,
      frequencyUnit: chore.frequencyUnit || "week",
      taskMode: chore.taskMode,
      cadenceLabel: formatFrequencyLabel(chore.frequencyInterval || 1, chore.frequencyUnit || "week"),
      reminderEnabled: Boolean(chore.reminderLeadMinutes),
      isActive: Boolean(chore.isActive),
      points: chore.points || 0,
      nextDueAt,
      nextDueLabel: nextDueAt ? formatDateLabel(nextDueAt, "pending") : null
    };
  });
}

function toSentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatIsoDayLabel(value: string | null | undefined) {
  if (!value) return null;
  const hasTime = value.includes("T");
  const date = hasTime ? new Date(value) : new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short"
  }).format(date);
}

function formatEuroFromCents(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return null;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    (value as number) / 100
  );
}

function humanizeEventTitle(event: BackendEvent, assignment?: BackendAssignment, payload?: Record<string, unknown> | null) {
  const actor = event.roommateName ?? "House";
  const choreTitle = assignment?.choreTitle ?? (typeof payload?.title === "string" ? payload.title : null);
  const ownerName = assignment?.responsibleRoommateName ?? actor;
  const rescuedBy = assignment?.rescuedByRoommateName ?? null;
  const reason = typeof payload?.reason === "string" ? payload.reason : null;

  switch (event.eventType.toUpperCase()) {
    case "DONE":
      return choreTitle ? `${actor} finished ${choreTitle} cleaning` : `${actor} finished a chore`;
    case "SKIP":
      return choreTitle ? `${actor} skipped ${choreTitle}` : `${actor} skipped a chore`;
    case "RESCUE":
    case "CHORE_RESCUED":
      if (choreTitle && rescuedBy && ownerName && rescuedBy !== ownerName) {
        return `${rescuedBy} rescued ${choreTitle} for ${ownerName}`;
      }
      return choreTitle ? `${actor} rescued ${choreTitle}` : `${actor} rescued a chore`;
    case "REMINDER_SENT":
      return choreTitle ? `Reminder sent for ${choreTitle}` : "Reminder sent";
    case "ESCALATION_SENT":
    case "TASK_ESCALATED":
      return choreTitle ? `${choreTitle} was escalated` : "Task escalated";
    case "RESCUE_REQUEST_OPENED":
      return choreTitle
        ? `${actor} asked the house to cover ${choreTitle}`
        : `${actor} opened a rescue request`;
    case "RESCUE_REQUEST_ACCEPTED":
      return choreTitle && rescuedBy
        ? `${rescuedBy} picked up ${choreTitle}`
        : "A rescue request was accepted";
    case "ASSIGNMENT_POSTPONED":
    case "ASSIGNMENT_RESCHEDULED": {
      const movedTo = formatIsoDayLabel(
        typeof payload?.dueDate === "string" ? payload.dueDate : null
      );
      if (choreTitle && movedTo) {
        return `${actor} moved ${choreTitle} to ${movedTo}`;
      }
      return choreTitle ? `${actor} moved ${choreTitle}` : `${actor} rescheduled a chore`;
    }
    case "ASSIGNMENT_WINDOW_SHIFTED": {
      const start = formatIsoDayLabel(
        typeof payload?.shiftedWindowStartDate === "string" ? payload.shiftedWindowStartDate : null
      );
      const end = formatIsoDayLabel(
        typeof payload?.shiftedWindowEndDate === "string" ? payload.shiftedWindowEndDate : null
      );
      if (choreTitle && start && end) {
        return `Next ${choreTitle} window adjusted to ${start}–${end}`;
      }
      return choreTitle ? `Next ${choreTitle} window was adjusted` : "Next week's window was adjusted";
    }
    case "CONVERSATION_MESSAGE_SENT":
    case "HANDOFF_MESSAGE_SENT":
      return choreTitle ? `Message sent about ${choreTitle}` : "Message sent";
    case "EXPENSE_ADDED": {
      const expenseTitle =
        typeof payload?.title === "string" && payload.title.trim().length > 0
          ? payload.title.trim()
          : "an expense";
      const amountLabel = formatEuroFromCents(
        typeof payload?.amountCents === "number" ? payload.amountCents : null
      );
      return amountLabel
        ? `${actor} added ${expenseTitle} (${amountLabel})`
        : `${actor} added ${expenseTitle}`;
    }
    case "SETTLEMENT_ADDED": {
      const amountLabel = formatEuroFromCents(
        typeof payload?.amountCents === "number" ? payload.amountCents : null
      );
      return amountLabel
        ? `${actor} logged a settlement (${amountLabel})`
        : `${actor} logged a settlement`;
    }
    case "PENALTY_CREATED":
      return choreTitle ? `${ownerName} missed ${choreTitle}` : `${ownerName} received a penalty`;
    case "WHATSAPP_WELCOME_SENT":
      return `${actor} received the welcome message`;
    default: {
      const label = event.eventType.toLowerCase().replaceAll("_", " ");
      return choreTitle ? `${actor} ${label} for ${choreTitle}` : `${actor} ${label}`;
    }
  }
}

function mapEvents(events: BackendEvent[], assignments: BackendAssignment[]): UiActivityEntry[] {
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]));

  return events.map((event) => {
    const normalized = event.eventType.toUpperCase();
    let payload: Record<string, unknown> | null = null;

    if (event.payloadJson) {
      try {
        payload = JSON.parse(event.payloadJson) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }

    const type: UiActivityEntry["type"] =
      normalized === "DONE"
        ? "completed"
        : normalized.includes("RESCUE")
          ? "rescue"
          : normalized.includes("ESCALAT")
            ? "escalation"
            : normalized === "SKIP" || normalized.includes("PENALTY")
              ? "missed"
              : normalized.includes("REMINDER")
              ? "reminder"
                : "system";

    const assignment = event.assignmentId ? assignmentsById.get(event.assignmentId) : undefined;
    const title = humanizeEventTitle(event, assignment, payload);
    const actor =
      type === "reminder"
        ? "WhatsApp bot"
        : assignment?.responsibleRoommateName ?? event.roommateName ?? "House log";

    return {
      id: String(event.id),
      type,
      eventType: event.eventType,
      assignmentId: event.assignmentId ? String(event.assignmentId) : null,
      title,
      actor,
      timestamp: formatShortRelative(event.createdAt),
      payload
    };
  });
}

function mapExpenses(expenses: BackendExpense[]): UiExpenseEntry[] {
  return expenses.map((expense) => ({
    id: String(expense.id),
    title: expense.title,
    amount: expense.amountCents / 100,
    amountLabel: formatCurrency(expense.amountCents / 100),
    paidByRoommateId: String(expense.paidByRoommateId),
    paidByRoommateName: expense.paidByRoommateName,
    note: expense.note ?? "",
    createdAt: expense.createdAt,
    createdLabel: formatShortRelative(expense.createdAt),
    excludedRoommateIds: expense.excludedRoommateIds.map(String),
    excludedRoommateNames: expense.excludedRoommateNames,
    shares: expense.shares.map((share) => ({
      roommateId: String(share.roommateId),
      roommateName: share.roommateName,
      share: share.shareCents / 100,
      shareLabel: formatCurrency(share.shareCents / 100)
    }))
  }));
}

function mapBalances(balances: BackendBalance[]): UiBalanceEntry[] {
  return balances.map((balance) => ({
    fromRoommateId: String(balance.fromRoommateId),
    fromRoommateName: balance.fromRoommateName,
    toRoommateId: String(balance.toRoommateId),
    toRoommateName: balance.toRoommateName,
    amount: balance.amountCents / 100,
    amountLabel: formatCurrency(balance.amountCents / 100)
  }));
}

function mapSettlements(settlements: BackendSettlement[]): UiSettlementEntry[] {
  return settlements.map((settlement) => ({
    id: String(settlement.id),
    fromRoommateId: String(settlement.fromRoommateId),
    fromRoommateName: settlement.fromRoommateName,
    toRoommateId: String(settlement.toRoommateId),
    toRoommateName: settlement.toRoommateName,
    amount: settlement.amountCents / 100,
    amountLabel: formatCurrency(settlement.amountCents / 100),
    note: settlement.note ?? "",
    createdAt: settlement.createdAt,
    createdLabel: formatShortRelative(settlement.createdAt)
  }));
}

function mapBackendSnapshot(raw: BackendHouseholdSnapshot): HouseholdSnapshot {
  let roommates = mapRoommates(raw.roommates);
  const rescueCounts = new Map<string, number>();
  const strikeCounts = new Map<string, number>();

  for (const assignment of raw.assignments) {
    if (assignment.rescuedByRoommateId) {
      const rescueKey = String(assignment.rescuedByRoommateId);
      rescueCounts.set(rescueKey, (rescueCounts.get(rescueKey) ?? 0) + Number(assignment.rescueCreditApplied || 1));
    }
    if (assignment.strikeApplied) {
      const strikeKey = String(assignment.responsibleRoommateId);
      strikeCounts.set(strikeKey, (strikeCounts.get(strikeKey) ?? 0) + Number(assignment.strikeApplied));
    }
  }

  roommates = roommates.map((roommate) => ({
    ...roommate,
    strikeCount: strikeCounts.get(roommate.id) ?? roommate.strikeCount,
    rescueCount: rescueCounts.get(roommate.id) ?? roommate.rescueCount
  }));

  return {
    houseName: raw.settings.houseName,
    activeRoommateId: roommates[0]?.id ?? "",
    roommates,
    taskTemplates: mapTaskTemplates(raw.chores, raw.assignments, roommates),
    chores: mapAssignments(raw.assignments, roommates),
    activity: mapEvents(raw.events, raw.assignments),
    expenses: mapExpenses(raw.expenses),
    settlements: mapSettlements(raw.settlements),
    balances: mapBalances(raw.balances),
    lastSyncLabel: `Synced ${formatShortRelative(raw.settings.updatedAt)}`
  };
}

async function refreshSnapshot() {
  const raw = await fetchBackendJson<BackendHouseholdSnapshot>("/api/household");
  const value = mapBackendSnapshot(raw);
  snapshotCache = {
    value,
    expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS
  };
  return value;
}

export async function getHouseholdSnapshotCached() {
  const now = Date.now();
  if (snapshotCache && snapshotCache.expiresAt > now) {
    return snapshotCache.value;
  }

  if (snapshotCache && snapshotCache.expiresAt <= now) {
    if (!snapshotRefreshInFlight) {
      snapshotRefreshInFlight = refreshSnapshot().finally(() => {
        snapshotRefreshInFlight = null;
      });
    }
    return snapshotCache.value;
  }

  if (!snapshotRefreshInFlight) {
    snapshotRefreshInFlight = refreshSnapshot().finally(() => {
      snapshotRefreshInFlight = null;
    });
  }

  return snapshotRefreshInFlight;
}

export function invalidateHouseholdSnapshotCache() {
  snapshotCache = null;
}
