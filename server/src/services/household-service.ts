import { config } from "../config.js";
import type {
  AdvanceRotationOn,
  AssignmentStatus,
  AssignmentResolutionType,
  HouseholdSnapshot,
  FrequencyUnit,
  HouseSettings,
  PenaltyStatus,
  PenaltyTrigger,
  TaskMode
} from "../lib/types.js";
import {
  addEventLogAsync,
  createAssignmentAsync as createAssignment,
  createChoreAsync as createChore,
  createExpenseAsync as createExpense,
  createPenaltyAsync as createPenalty,
  createPenaltyRuleAsync as createPenaltyRule,
  createRoommateAsync as createRoommate,
  createSettlementAsync as createSettlement,
  getHouseSettingsAsync,
  getOldestPendingAssignmentAsync as getOldestPendingAssignment,
  getRoommateByIdAsync as getRoommateById,
  listAssignmentsAsync,
  listBalancesAsync,
  listChoresAsync,
  listExpensesAsync,
  listPenaltiesAsync,
  listPenaltyRulesAsync,
  listRecentEventsAsync,
  listRoommatesAsync,
  listSettlementsAsync,
  rescueAssignmentAsync as rescueAssignment,
  updateAssignmentAsync as updateAssignment,
  updateChoreAsync as updateChore,
  updateHouseSettingsAsync as updateHouseSettings,
  updatePenaltyAsync as updatePenalty,
  updatePenaltyRuleAsync as updatePenaltyRule,
  updateRoommateAsync as updateRoommate
} from "./task-service-async.js";
import { rememberLastOutboundAssignment } from "./message-service.js";
import { composeWhatsappConversationMessage } from "./ai-service.js";
import {
  resolveOutboundWhatsappNumber,
  getWhatsappClientStatus,
  sendWhatsappMessage
} from "./whatsapp-service.js";

async function buildHouseholdSnapshotAsync(): Promise<HouseholdSnapshot> {
  const [
    settings,
    roommates,
    chores,
    assignments,
    events,
    penaltyRules,
    penalties,
    expenses,
    settlements,
    balances
  ] = await Promise.all([
    getHouseSettingsAsync(),
    listRoommatesAsync(),
    listChoresAsync(),
    listAssignmentsAsync(),
    listRecentEventsAsync(50),
    listPenaltyRulesAsync(),
    listPenaltiesAsync(),
    listExpensesAsync(),
    listSettlementsAsync(),
    listBalancesAsync()
  ]);

  return {
    settings,
    roommates,
    chores,
    assignments,
    events,
    penaltyRules,
    penalties,
    expenses,
    settlements,
    balances
  };
}

function invalidateHouseholdSnapshotCache() {
  // Snapshot caching was removed to avoid stale household state after writes.
}

export async function getHouseholdSnapshotAsync(): Promise<HouseholdSnapshot> {
  return await buildHouseholdSnapshotAsync();
}

export function primeHouseholdSnapshotCacheAsync() {
  // No-op now that the snapshot is built directly per request.
}

export async function createRoommateRecord(input: {
  name: string;
  whatsappNumber: string;
  isActive?: number;
  sortOrder?: number;
  reminderEnabled?: number;
  reminderHour?: number;
  reminderLeadMinutes?: number;
  notes?: string | null;
}) {
  const roommate = await createRoommate(input);
  if (roommate) {
    await addEventLogAsync({
      roommateId: roommate.id,
      assignmentId: null,
      eventType: "ROOMMATE_CREATED",
      payload: JSON.stringify({ name: roommate.name })
    });
  }
  invalidateHouseholdSnapshotCache();
  return roommate;
}

export async function updateRoommateRecord(
  id: number,
  input: {
    name?: string;
    whatsappNumber?: string;
    isActive?: number;
    sortOrder?: number;
    reminderEnabled?: number;
    reminderHour?: number;
    reminderLeadMinutes?: number;
    notes?: string | null;
  }
) {
  const roommate = await updateRoommate(id, input);
  if (roommate) {
    await addEventLogAsync({
      roommateId: roommate.id,
      assignmentId: null,
      eventType: "ROOMMATE_UPDATED",
      payload: JSON.stringify(input)
    });
  }
  invalidateHouseholdSnapshotCache();
  return roommate;
}

export async function createChoreRecord(input: {
  title: string;
  description?: string | null;
  cadence: string;
  area?: string;
  points?: number;
  frequencyInterval?: number;
  frequencyUnit?: FrequencyUnit;
  taskMode?: TaskMode;
  softReminderAfterHours?: number;
  repeatReminderEveryHours?: number;
  escalateAfterHours?: number;
  advanceRotationOn?: AdvanceRotationOn;
  isOptional?: number;
  parentChoreId?: number | null;
  defaultDueHour?: number;
  defaultAssigneeId?: number | null;
  isActive?: number;
  reminderLeadMinutes?: number;
  penaltyRuleId?: number | null;
}) {
  const chore = await createChore(input);
  if (chore) {
    await addEventLogAsync({
      roommateId: input.defaultAssigneeId ?? null,
      assignmentId: null,
      eventType: "CHORE_CREATED",
      payload: JSON.stringify({
        title: chore.title,
        area: chore.area,
        frequencyUnit: chore.frequencyUnit,
        frequencyInterval: chore.frequencyInterval,
        taskMode: chore.taskMode,
        parentChoreId: chore.parentChoreId
      })
    });
  }
  invalidateHouseholdSnapshotCache();
  return chore;
}

export async function updateChoreRecord(
  id: number,
  input: {
    title?: string;
    description?: string | null;
    cadence?: string;
    area?: string;
    points?: number;
    frequencyInterval?: number;
    frequencyUnit?: FrequencyUnit;
    taskMode?: TaskMode;
    softReminderAfterHours?: number;
    repeatReminderEveryHours?: number;
    escalateAfterHours?: number;
    advanceRotationOn?: AdvanceRotationOn;
    isOptional?: number;
    parentChoreId?: number | null;
    defaultDueHour?: number;
    defaultAssigneeId?: number | null;
    isActive?: number;
    reminderLeadMinutes?: number;
    penaltyRuleId?: number | null;
  }
) {
  const chore = await updateChore(id, input);
  if (chore) {
    await addEventLogAsync({
      roommateId: input.defaultAssigneeId ?? null,
      assignmentId: null,
      eventType: "CHORE_UPDATED",
      payload: JSON.stringify({
        ...input,
        frequencyUnit: input.frequencyUnit,
        taskMode: input.taskMode,
        parentChoreId: input.parentChoreId
      })
    });
  }
  invalidateHouseholdSnapshotCache();
  return chore;
}

export async function createAssignmentRecord(input: {
  choreId: number;
  roommateId: number;
  dueDate: string;
  status?: AssignmentStatus;
  statusNote?: string | null;
  resolutionType?: AssignmentResolutionType | null;
  responsibleRoommateId?: number;
  rescuedByRoommateId?: number | null;
  escalationLevel?: number;
  strikeApplied?: number;
  rescueCreditApplied?: number;
}) {
  const assignment = await createAssignment(input);
  invalidateHouseholdSnapshotCache();
  return assignment;
}

export async function updateAssignmentRecord(
  id: number,
  input: {
    choreId?: number;
    roommateId?: number;
    dueDate?: string;
    status?: AssignmentStatus;
    statusNote?: string | null;
    resolutionType?: AssignmentResolutionType | null;
    responsibleRoommateId?: number;
    rescuedByRoommateId?: number | null;
    escalationLevel?: number;
    strikeApplied?: number;
    rescueCreditApplied?: number;
  }
) {
  if (input.resolutionType === "rescued" && input.rescuedByRoommateId) {
    const assignment = await rescueAssignment(
      id,
      input.rescuedByRoommateId,
      input.statusNote ?? null
    );
    invalidateHouseholdSnapshotCache();
    return assignment;
  }

  const assignment = await updateAssignment(id, input);
  invalidateHouseholdSnapshotCache();
  return assignment;
}

export async function updateHouseSettingsRecord(input: Partial<HouseSettings>) {
  const settings = await updateHouseSettings(input);
  await addEventLogAsync({
    roommateId: null,
    assignmentId: null,
    eventType: "SETTINGS_UPDATED",
    payload: JSON.stringify(input)
  });
  invalidateHouseholdSnapshotCache();
  return settings;
}

export async function createPenaltyRuleRecord(input: {
  title: string;
  description?: string | null;
  triggerType?: PenaltyTrigger;
  amountCents: number;
  isActive?: number;
}) {
  const rule = await createPenaltyRule(input);
  await addEventLogAsync({
    roommateId: null,
    assignmentId: null,
    eventType: "PENALTY_RULE_CREATED",
    payload: JSON.stringify({ title: rule?.title, amountCents: rule?.amountCents })
  });
  invalidateHouseholdSnapshotCache();
  return rule;
}

export async function updatePenaltyRuleRecord(
  id: number,
  input: {
    title?: string;
    description?: string | null;
    triggerType?: PenaltyTrigger;
    amountCents?: number;
    isActive?: number;
  }
) {
  const rule = await updatePenaltyRule(id, input);
  await addEventLogAsync({
    roommateId: null,
    assignmentId: null,
    eventType: "PENALTY_RULE_UPDATED",
    payload: JSON.stringify({ id, ...input })
  });
  invalidateHouseholdSnapshotCache();
  return rule;
}

export async function createPenaltyRecord(input: {
  roommateId: number;
  assignmentId?: number | null;
  ruleId?: number | null;
  reason?: string | null;
  amountCents?: number;
  status?: PenaltyStatus;
}) {
  const penalty = await createPenalty(input);
  if (penalty) {
    await addEventLogAsync({
      roommateId: penalty.roommateId,
      assignmentId: penalty.assignmentId,
      eventType: "PENALTY_MANUAL_CREATED",
      payload: JSON.stringify({ amountCents: penalty.amountCents, reason: penalty.reason })
    });
  }
  invalidateHouseholdSnapshotCache();
  return penalty;
}

export async function createExpenseRecord(input: {
  title: string;
  amountCents: number;
  paidByRoommateId: number;
  note?: string | null;
  includedRoommateIds: number[];
}) {
  const expense = await createExpense(input);
  invalidateHouseholdSnapshotCache();
  return expense;
}

export async function createSettlementRecord(input: {
  fromRoommateId: number;
  toRoommateId: number;
  amountCents: number;
  note?: string | null;
}) {
  const settlement = await createSettlement(input);
  invalidateHouseholdSnapshotCache();
  return settlement;
}

export async function updatePenaltyRecord(
  id: number,
  input: {
    reason?: string | null;
    amountCents?: number;
    status?: PenaltyStatus;
  }
) {
  const penalty = await updatePenalty(id, input);
  if (penalty) {
    await addEventLogAsync({
      roommateId: penalty.roommateId,
      assignmentId: penalty.assignmentId,
      eventType: "PENALTY_UPDATED",
      payload: JSON.stringify({ id, ...input })
    });
  }
  invalidateHouseholdSnapshotCache();
  return penalty;
}

export async function sendTestReminder(input: {
  roommateId?: number;
  to?: string;
  message?: string;
}) {
  const roommate = input.roommateId ? await getRoommateById(input.roommateId) : null;
  const to = input.to ?? roommate?.whatsappNumber;

  if (!to) {
    throw new Error("A roommateId or WhatsApp number is required.");
  }

  const settings = await getHouseSettingsAsync();
  const rememberedAssignment = roommate?.id
    ? await getOldestPendingAssignment(roommate.id)
    : null;
  const generatedMessage =
    rememberedAssignment && roommate
      ? (
          await composeWhatsappConversationMessage({
            kind: "assignment_reminder",
            roommateName: roommate.name,
            choreTitle: rememberedAssignment.choreTitle,
            dueDate: rememberedAssignment.dueDate
          })
        ).text
      : `😃 Hey, here’s a quick reminder from ${settings.houseName}. Open the app or message me if you want to see what’s on your list.`;
  const message = input.message ?? generatedMessage;
  const outboundTo = resolveOutboundWhatsappNumber(to);

  const whatsappStatus = getWhatsappClientStatus();
  if (!whatsappStatus.ready && !config.whatsappProxySendEnabled) {
    return {
      delivered: false,
      transport: "stub",
      to,
      message
    };
  }

  const result = await sendWhatsappMessage(to, message);
  if (rememberedAssignment) {
    rememberLastOutboundAssignment(to, rememberedAssignment.id);
  }
  const { addEventLogAsync } = await import("./task-service-async.js");
  await addEventLogAsync({
    roommateId: roommate?.id ?? null,
    assignmentId: null,
    eventType: "TEST_REMINDER_SENT",
    payload: JSON.stringify({
      originalTo: to,
      effectiveTo: outboundTo,
      rememberedAssignmentId: rememberedAssignment?.id ?? null,
      messageId: result.id,
      transport: "whatsapp-web.js"
    })
  });

  return {
    delivered: true,
    transport: "whatsapp-web.js",
    to,
    message,
    messageId: result.id
  };
}
