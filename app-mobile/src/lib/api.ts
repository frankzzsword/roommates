import { buildPreviewSnapshot, cloneSnapshot, formatCurrency } from "@/src/data/mock";
import type {
  AiHouseInsight,
  AiSubtaskSuggestion,
  AccountabilityState,
  AdvanceRotationOn,
  ChoreStatus,
  FrequencyUnit,
  UiBalanceEntry,
  UiExpenseEntry,
  HouseholdSnapshot,
  RoommateDraft,
  ReminderPreferences,
  ResolutionType,
  SaveResult,
  TaskMode,
  UiActivityEntry,
  UiChore,
  UiPenaltyEntry,
  UiPenaltyRule,
  UiRoommate,
  UiTaskTemplate
} from "@/src/lib/types";

const defaultApiBaseUrl = "https://roommates-yoh0.onrender.com";
const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? defaultApiBaseUrl;
const currency = "EUR";

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

interface BackendLoginResponse {
  roommate: BackendRoommate;
}

interface BackendAssignment {
  id: number;
  choreId: number;
  roommateId: number;
  dueDate: string;
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
  advanceRotationOn: AdvanceRotationOn;
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
  eventType: string;
  payloadJson: string | null;
  createdAt: string;
  roommateName: string | null;
}

interface BackendPenaltyRule {
  id: number;
  title: string;
  description: string | null;
  triggerType: "missed" | "skipped" | "manual";
  amountCents: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

interface BackendPenalty {
  id: number;
  roommateId: number;
  assignmentId: number | null;
  ruleId: number | null;
  reason: string | null;
  amountCents: number;
  status: "open" | "waived" | "paid";
  createdAt: string;
  settledAt: string | null;
  roommateName: string;
  ruleTitle: string | null;
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
    advanceRotationOn: AdvanceRotationOn;
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
  penaltyRules: BackendPenaltyRule[];
  penalties: BackendPenalty[];
  expenses: BackendExpense[];
  balances: BackendBalance[];
}

interface BackendAiSubtaskResponse {
  source: "openai" | "heuristic";
  model: string | null;
  suggestions: AiSubtaskSuggestion[];
}

interface BackendAiHouseAnalysisResponse {
  source: "openai" | "heuristic";
  model: string | null;
  insights: AiHouseInsight[];
}

function formatFrequencyLabel(interval: number, unit: FrequencyUnit) {
  if (interval === 1) {
    return `Every ${unit}`;
  }

  return `Every ${interval} ${unit}s`;
}

function formatDateLabel(dateInput: string, status: ChoreStatus) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  const formatted = new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);

  if (status === "done") {
    return `completed ${formatted}`;
  }

  if (status === "skipped") {
    return `skipped ${formatted}`;
  }

  if (status === "rescued") {
    return `rescued ${formatted}`;
  }

  return `due ${formatted}`;
}

function formatShortRelative(dateInput: string) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function inferArea(title: string, description: string | null) {
  const value = `${title} ${description ?? ""}`.toLowerCase();
  if (value.includes("bathroom")) {
    return "Bathroom";
  }
  if (value.includes("kitchen")) {
    return "Kitchen";
  }
  if (value.includes("trash") || value.includes("bin")) {
    return "Utilities";
  }
  if (value.includes("hall")) {
    return "Hallway";
  }
  return "Shared space";
}

function inferFrequency(cadence: string): { interval: number; unit: FrequencyUnit } {
  const normalized = cadence.toLowerCase();
  const numberMatch = normalized.match(/every\s+(\d+)/);
  const interval = numberMatch ? Math.max(1, Number(numberMatch[1])) : 1;

  if (normalized.includes("month")) {
    return { interval, unit: "month" };
  }

  if (normalized.includes("week") || /monday|tuesday|wednesday|thursday|friday|saturday|sunday/.test(normalized)) {
    return { interval, unit: "week" };
  }

  return { interval, unit: "day" };
}

function toReminderPreferences(
  roommate: BackendRoommate,
  fallback: ReminderPreferences
): ReminderPreferences {
  const leadMinutes = roommate.reminderLeadMinutes || 120;
  const reminderLeadHours = Math.max(1, Math.round(leadMinutes / 60));

  return {
    personalEnabled: Boolean(roommate.reminderEnabled),
    dayBefore: leadMinutes >= 720,
    dayOf: leadMinutes < 720,
    escalationEnabled: fallback.escalationEnabled,
    escalationHours: Math.max(1, Math.round(leadMinutes / 60)),
    reminderHour: roommate.reminderHour || fallback.reminderHour,
    reminderLeadHours,
    quietHoursStart: fallback.quietHoursStart,
    quietHoursEnd: fallback.quietHoursEnd
  };
}

function mapRoommates(
  roommates: BackendRoommate[],
  preview: HouseholdSnapshot
): UiRoommate[] {
  return roommates.map((roommate, index) => {
    const fallback = preview.roommates[index] ?? preview.roommates[0];
    const totalTracked =
      roommate.pendingCount + roommate.completedCount + roommate.skippedCount;
    const reliability =
      totalTracked === 0
        ? fallback.reliability
        : Math.round((roommate.completedCount / totalTracked) * 100);

    return {
      id: String(roommate.id),
      name: roommate.name,
      whatsappNumber: roommate.whatsappNumber,
      role:
        roommate.notes ??
        `${roommate.pendingCount} open chore${roommate.pendingCount === 1 ? "" : "s"}`,
      note: roommate.notes ?? fallback.note,
      isActive: Boolean(roommate.isActive),
      sortOrder: roommate.sortOrder || fallback.sortOrder,
      reliability: Math.max(35, Math.min(100, reliability)),
      pendingCount: roommate.pendingCount,
      completedCount: roommate.completedCount,
      missedCount: roommate.skippedCount,
      strikeCount: roommate.skippedCount,
      rescueCount: 0,
      reminderPreferences: toReminderPreferences(roommate, fallback.reminderPreferences)
    };
  });
}

function mapAssignmentStatus(assignment: BackendAssignment): ChoreStatus {
  if (assignment.resolutionType === "rescued") {
    return "rescued";
  }

  if (assignment.status === "done" || assignment.status === "skipped") {
    return assignment.status;
  }

  const dueAt = new Date(
    `${assignment.dueDate}T${String(assignment.defaultDueHour).padStart(2, "0")}:00:00`
  );

  if (!Number.isNaN(dueAt.getTime()) && dueAt < new Date()) {
    return "overdue";
  }

  return "pending";
}

function mapAssignments(
  assignments: BackendAssignment[],
  roommates: UiRoommate[]
): UiChore[] {
  return assignments.map((assignment) => {
    const status = mapAssignmentStatus(assignment);
    const assignee =
      roommates.find((roommate) => roommate.id === String(assignment.roommateId)) ??
      roommates[0];
    const dueAt =
      assignment.completedAt ??
      `${assignment.dueDate}T${String(assignment.defaultDueHour).padStart(2, "0")}:00:00`;

    return {
      id: String(assignment.id),
      title: assignment.choreTitle,
      description: assignment.statusNote
        ? `${assignment.choreDescription ?? "Shared apartment chore"} • ${assignment.statusNote}`
        : assignment.choreDescription ?? "Shared apartment chore",
      assigneeId: assignee?.id ?? String(assignment.roommateId),
      assignee: assignment.roommateName,
      dueAt,
      dueLabel: formatDateLabel(dueAt, status),
      cadence: assignment.cadence,
      area: assignment.area || inferArea(assignment.choreTitle, assignment.choreDescription),
      points: assignment.points || (assignment.choreDescription ? 16 : 10),
      reminderEnabled: Boolean(assignment.roommateReminderEnabled),
      taskMode: assignment.taskMode,
      accountabilityState: assignment.accountabilityState,
      resolutionType: assignment.resolutionType,
      responsibleRoommateId: String(assignment.responsibleRoommateId),
      responsibleRoommate: assignment.responsibleRoommateName,
      rescuedByRoommateId: assignment.rescuedByRoommateId
        ? String(assignment.rescuedByRoommateId)
        : null,
      rescuedByRoommate: assignment.rescuedByRoommateName ?? null,
      escalationLevel: assignment.escalationLevel,
      strikeApplied: Boolean(assignment.strikeApplied),
      rescueCreditApplied: Boolean(assignment.rescueCreditApplied),
      status
    };
  });
}

function mapTaskTemplates(
  chores: BackendHouseholdSnapshot["chores"],
  roommates: UiRoommate[],
  preview: HouseholdSnapshot
): UiTaskTemplate[] {
  return chores.map((chore) => {
    const assignee =
      roommates.find((roommate) => roommate.id === String(chore.defaultAssigneeId)) ??
      roommates[0];
    const cadence = {
      interval: chore.frequencyInterval || inferFrequency(chore.cadence).interval,
      unit: chore.frequencyUnit || inferFrequency(chore.cadence).unit
    };

    return {
      id: String(chore.id),
      title: chore.title,
      description: chore.description ?? "Recurring household chore",
      area: chore.area || inferArea(chore.title, chore.description),
      assigneeId: assignee?.id ?? preview.activeRoommateId,
      assignee: assignee?.name ?? chore.defaultAssigneeName ?? preview.roommates[0].name,
      frequencyInterval: cadence.interval,
      frequencyUnit: cadence.unit,
      taskMode: chore.taskMode,
      softReminderAfterHours: chore.softReminderAfterHours || 24,
      repeatReminderEveryHours: chore.repeatReminderEveryHours || 24,
      escalateAfterHours: chore.escalateAfterHours || 48,
      advanceRotationOn: chore.advanceRotationOn || "completed_only",
      cadenceLabel: formatFrequencyLabel(cadence.interval, cadence.unit),
      reminderEnabled: Boolean(chore.reminderLeadMinutes),
      isOptionalSubtask: Boolean(chore.isOptional),
      parentTemplateId: chore.parentChoreId ? String(chore.parentChoreId) : null,
      parentTemplateTitle: chore.parentChoreTitle ?? null,
      isActive: Boolean(chore.isActive)
    };
  });
}

function mapEvents(events: BackendEvent[]): UiActivityEntry[] {
  return events.map((event) => {
    const normalized = event.eventType.toUpperCase();
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

    return {
      id: String(event.id),
      type,
      title: `${event.roommateName ?? "System"} ${event.eventType.toLowerCase().replaceAll("_", " ")}`,
      actor: type === "reminder" ? "WhatsApp bot" : "House log",
      timestamp: formatShortRelative(event.createdAt)
    };
  });
}

function mapPenaltyStatus(status: BackendPenalty["status"]) {
  if (status === "open") {
    return "owed";
  }

  return status;
}

function mapPenalties(penalties: BackendPenalty[]): UiPenaltyEntry[] {
  return penalties.map((penalty) => {
    const amount = penalty.amountCents / 100;

    return {
      id: String(penalty.id),
      roommateId: String(penalty.roommateId),
      roommateName: penalty.roommateName,
      reason: penalty.reason ?? penalty.ruleTitle ?? "House penalty",
      amount,
      amountLabel: formatCurrency(amount, currency),
      status: mapPenaltyStatus(penalty.status),
      createdAt: penalty.createdAt,
      createdLabel: formatShortRelative(penalty.createdAt),
      dueLabel: penalty.status === "open" ? "open now" : "settled"
    };
  });
}

function mapPenaltyRule(
  penaltyRules: BackendPenaltyRule[],
  settings: BackendHouseSettings,
  preview: HouseholdSnapshot
): UiPenaltyRule {
  const activeRule =
    penaltyRules.find((rule) => rule.isActive) ?? penaltyRules[0];

  if (!activeRule) {
    return preview.penaltyRule;
  }

  return {
    id: String(activeRule.id),
    enabled: Boolean(activeRule.isActive),
    label: activeRule.title || settings.penaltyLabel,
    amount: activeRule.amountCents / 100,
    currency,
    graceHours: Math.max(1, Math.round(settings.defaultReminderLeadMinutes / 60)),
    strikeThreshold: 1
  };
}

function mapExpenses(expenses: BackendExpense[]): UiExpenseEntry[] {
  return expenses.map((expense) => ({
    id: String(expense.id),
    title: expense.title,
    amount: expense.amountCents / 100,
    amountLabel: formatCurrency(expense.amountCents / 100, currency),
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
      shareLabel: formatCurrency(share.shareCents / 100, currency)
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
    amountLabel: formatCurrency(balance.amountCents / 100, currency)
  }));
}

function mapSettings(
  settings: BackendHouseSettings,
  _penaltyRules: BackendPenaltyRule[],
  preview: HouseholdSnapshot
) {
  return {
    autoReminders: Boolean(settings.autoRemindersEnabled),
    weeklySummary: Boolean(settings.weeklySummaryEnabled),
    escalationEnabled: preview.settings.escalationEnabled,
    summaryDay: settings.summaryDay,
    groupChatName: `${settings.houseName} house`,
    weeklyAchievementLabel:
      settings.weeklyAchievementLabel || preview.settings.weeklyAchievementLabel,
    monthlyAchievementLabel:
      settings.monthlyAchievementLabel || preview.settings.monthlyAchievementLabel
  };
}

function mapBackendSnapshot(raw: BackendHouseholdSnapshot): HouseholdSnapshot {
  const preview = buildPreviewSnapshot();
  let roommates = mapRoommates(raw.roommates, preview);
  const rescueCounts = new Map<string, number>();
  const strikeCounts = new Map<string, number>();
  for (const assignment of raw.assignments) {
    if (assignment.rescuedByRoommateId) {
      const rescueKey = String(assignment.rescuedByRoommateId);
      rescueCounts.set(rescueKey, (rescueCounts.get(rescueKey) ?? 0) + Number(assignment.rescueCreditApplied || 1));
    }

    const strikeKey = String(assignment.responsibleRoommateId);
    if (assignment.strikeApplied) {
      strikeCounts.set(strikeKey, (strikeCounts.get(strikeKey) ?? 0) + Number(assignment.strikeApplied));
    }
  }

  roommates = roommates.map((roommate) => ({
    ...roommate,
    strikeCount: strikeCounts.get(roommate.id) ?? roommate.strikeCount,
    rescueCount: rescueCounts.get(roommate.id) ?? roommate.rescueCount
  }));
  const penalties = mapPenalties(raw.penalties);
  const expenses = mapExpenses(raw.expenses);
  const balances = mapBalances(raw.balances);
  const penaltyRule = mapPenaltyRule(raw.penaltyRules, raw.settings, preview);

  return {
    houseName: raw.settings.houseName,
    activeRoommateId: roommates[0]?.id ?? preview.activeRoommateId,
    roommates,
    taskTemplates: mapTaskTemplates(raw.chores, roommates, preview),
    chores: mapAssignments(raw.assignments, roommates),
    activity: mapEvents(raw.events),
    penalties,
    expenses,
    balances,
    penaltyRule,
    settings: mapSettings(raw.settings, raw.penaltyRules, preview),
    lastSyncLabel: `Synced ${formatShortRelative(raw.settings.updatedAt)}`
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json"
    },
    ...init
  });

  if (!response.ok) {
    let detail = "";

    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        detail = ` - ${payload.error}`;
      }
    } catch {
      // ignore non-JSON error payloads
    }

    throw new Error(`Request failed for ${path}: ${response.status}${detail}`);
  }

  return (await response.json()) as T;
}

async function tryRequest<T>(path: string, init?: RequestInit) {
  if (!apiBaseUrl) {
    return null;
  }

  try {
    return await requestJson<T>(path, init);
  } catch (error) {
    if (error instanceof Error && /: 404$/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export function hasApiBaseUrl() {
  return Boolean(apiBaseUrl);
}

export function getApiBaseUrl() {
  return apiBaseUrl;
}

export function getPreviewSnapshot() {
  return cloneSnapshot(buildPreviewSnapshot());
}

export async function fetchHouseholdSnapshot(): Promise<{
  snapshot: HouseholdSnapshot;
  mode: "preview" | "live" | "hybrid";
}> {
  const preview = buildPreviewSnapshot();
  if (!apiBaseUrl) {
    return {
      snapshot: preview,
      mode: "preview"
    };
  }

  const rawSnapshot = await requestJson<BackendHouseholdSnapshot>("/api/household");

  return {
    snapshot: mapBackendSnapshot(rawSnapshot),
    mode: "live"
  };
}

export async function loginRoommate(name: string, password: string): Promise<{ roommateId: string }> {
  const result = await requestJson<BackendLoginResponse>("/api/login", {
    method: "POST",
    body: JSON.stringify({ name, password })
  });

  return {
    roommateId: String(result.roommate.id)
  };
}

export async function createExpenseEntry(payload: {
  title: string;
  amount: number;
  paidByRoommateId: string;
  includedRoommateIds: string[];
  note?: string;
}): Promise<SaveResult> {
  const result = await tryRequest("/api/expenses", {
    method: "POST",
    body: JSON.stringify({
      title: payload.title,
      amountCents: Math.round(payload.amount * 100),
      paidByRoommateId: Number(payload.paidByRoommateId),
      includedRoommateIds: payload.includedRoommateIds.map(Number),
      note: payload.note ?? null
    })
  });

  return result ? { synced: true, notice: "Expense added to the house ledger." } : withLocalNotice("Expense saved locally only.");
}

export async function createSettlementEntry(payload: {
  fromRoommateId: string;
  toRoommateId: string;
  amount: number;
  note?: string;
}): Promise<SaveResult> {
  const result = await tryRequest("/api/settlements", {
    method: "POST",
    body: JSON.stringify({
      fromRoommateId: Number(payload.fromRoommateId),
      toRoommateId: Number(payload.toRoommateId),
      amountCents: Math.round(payload.amount * 100),
      note: payload.note ?? null
    })
  });

  return result ? { synced: true, notice: "Settlement recorded." } : withLocalNotice("Settlement saved locally only.");
}

function withLocalNotice(message: string): SaveResult {
  return {
    synced: false,
    notice: message
  };
}

export async function saveRoommate(
  roommateId: string,
  payload: Partial<UiRoommate>
): Promise<SaveResult> {
  const reminderPreferences = payload.reminderPreferences;
  const body = {
    name: payload.name,
    whatsappNumber: payload.whatsappNumber,
    notes: payload.note,
    isActive: payload.isActive === undefined ? undefined : payload.isActive ? 1 : 0,
    sortOrder: payload.sortOrder,
    reminderEnabled:
      reminderPreferences?.personalEnabled === undefined
        ? undefined
        : reminderPreferences.personalEnabled
          ? 1
          : 0,
    reminderHour: reminderPreferences?.reminderHour,
    reminderLeadMinutes:
      reminderPreferences?.reminderLeadHours === undefined
        ? undefined
        : Math.max(1, reminderPreferences.reminderLeadHours) * 60
  };

  const result = await tryRequest(`/api/roommates/${roommateId}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });

  return result ? { synced: true } : withLocalNotice("Roommate saved locally only.");
}

export async function createRoommate(payload: RoommateDraft): Promise<SaveResult> {
  const result = await tryRequest("/api/roommates", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      whatsappNumber: payload.whatsappNumber,
      notes: payload.note,
      isActive: payload.isActive ? 1 : 0,
      sortOrder: payload.sortOrder,
      reminderEnabled: payload.reminderPreferences.personalEnabled ? 1 : 0,
      reminderHour: payload.reminderPreferences.reminderHour,
      reminderLeadMinutes: Math.max(1, payload.reminderPreferences.reminderLeadHours) * 60
    })
  });

  return result ? { synced: true, notice: "Roommate added to the house roster." } : withLocalNotice("Roommate saved locally only.");
}

function reminderPatchFromPreferences(payload: ReminderPreferences) {
  const reminderLeadMinutes = Math.max(1, payload.reminderLeadHours) * 60;

  return {
    reminderEnabled: payload.personalEnabled ? 1 : 0,
    reminderHour: payload.reminderHour,
    reminderLeadMinutes
  };
}

export async function saveReminderPreferences(
  roommateId: string,
  payload: ReminderPreferences
): Promise<SaveResult> {
  const result = await tryRequest(`/api/roommates/${roommateId}`, {
    method: "PATCH",
    body: JSON.stringify(reminderPatchFromPreferences(payload))
  });

  if (!result) {
    return withLocalNotice("Detailed reminder preferences are local until backend sync is available.");
  }

  return {
    synced: true,
    notice: "Personal reminder toggles synced. Quiet hours remain app-only for now."
  };
}

export async function saveHouseSettings(
  payload: HouseholdSnapshot["settings"]
): Promise<SaveResult> {
  const result = await tryRequest("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({
      autoRemindersEnabled: payload.autoReminders ? 1 : 0,
      weeklySummaryEnabled: payload.weeklySummary ? 1 : 0,
      summaryDay: payload.summaryDay.slice(0, 3).toUpperCase(),
      weeklyAchievementLabel: payload.weeklyAchievementLabel,
      monthlyAchievementLabel: payload.monthlyAchievementLabel
    })
  });

  if (!result) {
    return withLocalNotice("House settings saved locally only.");
  }

  return {
    synced: true,
    notice: "Core automation settings synced. Group chat naming stays local for now."
  };
}

export async function savePenaltyRule(payload: UiPenaltyRule): Promise<SaveResult> {
  const result = await tryRequest(`/api/penalty-rules/${payload.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: payload.label,
      amountCents: Math.round(payload.amount * 100),
      isActive: payload.enabled ? 1 : 0
    })
  });

  return result
    ? { synced: true }
    : withLocalNotice("Penalty rule saved locally only.");
}

export async function saveChore(chore: UiChore): Promise<SaveResult> {
  if (!apiBaseUrl) {
    return withLocalNotice("Chore saved in preview mode only.");
  }

  if (chore.id.startsWith("local-") || chore.id === "") {
    const choreResult = await requestJson<{ chore: { id: number } }>("/api/chores", {
      method: "POST",
      body: JSON.stringify({
        title: chore.title,
        description: chore.description,
        cadence: chore.cadence,
        defaultDueHour: new Date(chore.dueAt).getHours() || 18,
        defaultAssigneeId: Number(chore.assigneeId),
        reminderLeadMinutes: chore.reminderEnabled ? 120 : 0
      })
    });

    await requestJson("/api/assignments", {
      method: "POST",
      body: JSON.stringify({
        choreId: choreResult.chore.id,
        roommateId: Number(chore.assigneeId),
        dueDate: chore.dueAt.slice(0, 10),
        status: chore.status === "overdue" ? "pending" : chore.status
      })
    });

    return { synced: true };
  }

  const result = await requestJson(`/api/assignments/${chore.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      roommateId: Number(chore.assigneeId),
      dueDate: chore.dueAt.slice(0, 10),
      status: chore.status === "overdue" ? "pending" : chore.status
    })
  });

  return result ? { synced: true } : withLocalNotice("Assignment saved locally only.");
}

export async function saveTaskTemplate(template: UiTaskTemplate): Promise<SaveResult> {
  if (!apiBaseUrl) {
    return withLocalNotice("Template saved in preview mode only.");
  }

  const body = {
    title: template.title,
    description: template.description,
    cadence: formatFrequencyLabel(template.frequencyInterval, template.frequencyUnit),
    area: template.area,
    frequencyInterval: template.frequencyInterval,
    frequencyUnit: template.frequencyUnit,
    taskMode: template.taskMode,
    softReminderAfterHours: template.softReminderAfterHours,
    repeatReminderEveryHours: template.repeatReminderEveryHours,
    escalateAfterHours: template.escalateAfterHours,
    advanceRotationOn: template.advanceRotationOn,
    isOptional: template.isOptionalSubtask ? 1 : 0,
    parentChoreId: template.parentTemplateId ? Number(template.parentTemplateId) : null,
    defaultAssigneeId: Number(template.assigneeId),
    isActive: template.isActive ? 1 : 0,
    reminderLeadMinutes: template.reminderEnabled ? 120 : 0
  };

  if (template.id.startsWith("local-template-")) {
    await requestJson<{ chore: { id: number } }>("/api/chores", {
      method: "POST",
      body: JSON.stringify(body)
    });

    return {
      synced: true,
      notice: "Template synced to the backend chores list."
    };
  }

  await requestJson(`/api/chores/${template.id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });

  return {
    synced: true,
    notice: "Template synced to the backend chores list."
  };
}

export async function createPenalty(
  penalty: Pick<UiPenaltyEntry, "roommateId" | "roommateName" | "reason" | "amount">
): Promise<SaveResult> {
  const result = await tryRequest("/api/penalties", {
    method: "POST",
    body: JSON.stringify({
      roommateId: Number(penalty.roommateId),
      reason: penalty.reason,
      amountCents: Math.round(penalty.amount * 100),
      status: "open"
    })
  });

  return result ? { synced: true } : withLocalNotice("Penalty saved locally only.");
}

export async function suggestAiSubtasks(input: {
  title: string;
  description: string;
  area: string;
  taskMode: TaskMode;
}) {
  const result = await tryRequest<BackendAiSubtaskResponse>("/api/ai/subtasks/suggest", {
    method: "POST",
    body: JSON.stringify(input)
  });

  if (!result) {
    return {
      source: "heuristic" as const,
      model: null,
      suggestions: [
        {
          title: `Deep clean ${input.title.toLowerCase()}`,
          description: "Create a less frequent deep-clean companion for the main task.",
          area: input.area,
          frequencyInterval: 1,
          frequencyUnit: "month" as const,
          isOptionalSubtask: true,
          rationale: "Fallback suggestion because the AI endpoint is not reachable."
        }
      ]
    };
  }

  return result;
}

export async function analyzeHouseWithAi() {
  const result = await tryRequest<BackendAiHouseAnalysisResponse>("/api/ai/house-analysis", {
    method: "POST",
    body: JSON.stringify({})
  });

  if (!result) {
    return {
      source: "heuristic" as const,
      model: null,
      insights: [
        {
          title: "Inline editing is the right default",
          impact: "high" as const,
          recommendation: "Keep repetitive task changes inside the admin card and reserve full-screen screens for deeper setup."
        }
      ]
    };
  }

  return result;
}

export async function sendTestReminder(roommate: UiRoommate): Promise<SaveResult> {
  const result = await tryRequest<{ result: { transport: string; to: string } }>(
    "/api/reminders/test",
    {
      method: "POST",
      body: JSON.stringify({
        roommateId: Number(roommate.id)
      })
    }
  );

  return result
    ? {
        synced: true,
        notice: `Reminder sent to ${roommate.name}.`
      }
    : {
        synced: false,
        notice: `Preview mode: a reminder to ${roommate.name} would be queued now.`
      };
}

export async function sendAppMessage(
  roommateId: string,
  body: string
): Promise<SaveResult & { message: string }> {
  const result = await requestJson<{ result: { message: string } }>("/api/app-message", {
    method: "POST",
    body: JSON.stringify({
      roommateId: Number(roommateId),
      body
    })
  });

  return {
    synced: true,
    notice: result.result.message,
    message: result.result.message
  };
}

export function buildLocalPenalty(
  roommate: UiRoommate,
  amount: number,
  nextCurrency: string,
  reason: string
): UiPenaltyEntry {
  const now = new Date().toISOString();

  return {
    id: `local-penalty-${Date.now()}`,
    roommateId: roommate.id,
    roommateName: roommate.name,
    reason,
    amount,
    amountLabel: formatCurrency(amount, nextCurrency),
    status: "owed",
    createdAt: now,
    createdLabel: "just now",
    dueLabel: "due in 48h"
  };
}
