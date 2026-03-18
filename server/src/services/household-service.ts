import { config, hasTwilioCredentials } from "../config.js";
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
  addEventLog,
  createExpense,
  createAssignment,
  createChore,
  createPenalty,
  createPenaltyRule,
  createRoommate,
  createSettlement,
  getHouseSettings,
  getOldestPendingAssignment,
  getRoommateById,
  listAssignments,
  listBalances,
  listChores,
  listExpenses,
  listPenalties,
  listPenaltyRules,
  listRecentEvents,
  listRoommates,
  listSettlements,
  rescueAssignment,
  updateAssignment,
  updateChore,
  updateHouseSettings,
  updatePenalty,
  updatePenaltyRule,
  updateRoommate
} from "./task-service.js";
import { rememberLastOutboundAssignment } from "./message-service.js";
import {
  resolveOutboundWhatsappNumber,
  sendWhatsappMessage
} from "./twilio-service.js";

export function getHouseholdSnapshot(): HouseholdSnapshot {
  return {
    settings: getHouseSettings(),
    roommates: listRoommates(),
    chores: listChores(),
    assignments: listAssignments(),
    events: listRecentEvents(50),
    penaltyRules: listPenaltyRules(),
    penalties: listPenalties(),
    expenses: listExpenses(),
    settlements: listSettlements(),
    balances: listBalances()
  };
}

export function createRoommateRecord(input: {
  name: string;
  whatsappNumber: string;
  isActive?: number;
  sortOrder?: number;
  reminderEnabled?: number;
  reminderHour?: number;
  reminderLeadMinutes?: number;
  notes?: string | null;
}) {
  const roommate = createRoommate(input);
  if (roommate) {
    addEventLog({
      roommateId: roommate.id,
      assignmentId: null,
      eventType: "ROOMMATE_CREATED",
      payload: JSON.stringify({ name: roommate.name })
    });
  }
  return roommate;
}

export function updateRoommateRecord(
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
  const roommate = updateRoommate(id, input);
  if (roommate) {
    addEventLog({
      roommateId: roommate.id,
      assignmentId: null,
      eventType: "ROOMMATE_UPDATED",
      payload: JSON.stringify(input)
    });
  }
  return roommate;
}

export function createChoreRecord(input: {
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
  const chore = createChore(input);
  if (chore) {
    addEventLog({
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
  return chore;
}

export function updateChoreRecord(
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
  const chore = updateChore(id, input);
  if (chore) {
    addEventLog({
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
  return chore;
}

export function createAssignmentRecord(input: {
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
  return createAssignment(input);
}

export function updateAssignmentRecord(
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
    return rescueAssignment(id, input.rescuedByRoommateId, input.statusNote ?? null);
  }

  return updateAssignment(id, input);
}

export function updateHouseSettingsRecord(input: Partial<HouseSettings>) {
  const settings = updateHouseSettings(input);
  addEventLog({
    roommateId: null,
    assignmentId: null,
    eventType: "SETTINGS_UPDATED",
    payload: JSON.stringify(input)
  });
  return settings;
}

export function createPenaltyRuleRecord(input: {
  title: string;
  description?: string | null;
  triggerType?: PenaltyTrigger;
  amountCents: number;
  isActive?: number;
}) {
  const rule = createPenaltyRule(input);
  addEventLog({
    roommateId: null,
    assignmentId: null,
    eventType: "PENALTY_RULE_CREATED",
    payload: JSON.stringify({ title: rule?.title, amountCents: rule?.amountCents })
  });
  return rule;
}

export function updatePenaltyRuleRecord(
  id: number,
  input: {
    title?: string;
    description?: string | null;
    triggerType?: PenaltyTrigger;
    amountCents?: number;
    isActive?: number;
  }
) {
  const rule = updatePenaltyRule(id, input);
  addEventLog({
    roommateId: null,
    assignmentId: null,
    eventType: "PENALTY_RULE_UPDATED",
    payload: JSON.stringify({ id, ...input })
  });
  return rule;
}

export function createPenaltyRecord(input: {
  roommateId: number;
  assignmentId?: number | null;
  ruleId?: number | null;
  reason?: string | null;
  amountCents?: number;
  status?: PenaltyStatus;
}) {
  const penalty = createPenalty(input);
  if (penalty) {
    addEventLog({
      roommateId: penalty.roommateId,
      assignmentId: penalty.assignmentId,
      eventType: "PENALTY_MANUAL_CREATED",
      payload: JSON.stringify({ amountCents: penalty.amountCents, reason: penalty.reason })
    });
  }
  return penalty;
}

export function createExpenseRecord(input: {
  title: string;
  amountCents: number;
  paidByRoommateId: number;
  note?: string | null;
  includedRoommateIds: number[];
}) {
  return createExpense(input);
}

export function createSettlementRecord(input: {
  fromRoommateId: number;
  toRoommateId: number;
  amountCents: number;
  note?: string | null;
}) {
  return createSettlement(input);
}

export function updatePenaltyRecord(
  id: number,
  input: {
    reason?: string | null;
    amountCents?: number;
    status?: PenaltyStatus;
  }
) {
  const penalty = updatePenalty(id, input);
  if (penalty) {
    addEventLog({
      roommateId: penalty.roommateId,
      assignmentId: penalty.assignmentId,
      eventType: "PENALTY_UPDATED",
      payload: JSON.stringify({ id, ...input })
    });
  }
  return penalty;
}

export async function sendTestReminder(input: {
  roommateId?: number;
  to?: string;
  message?: string;
}) {
  const roommate = input.roommateId ? getRoommateById(input.roommateId) : null;
  const to = input.to ?? roommate?.whatsappNumber;

  if (!to) {
    throw new Error("A roommateId or WhatsApp number is required.");
  }

  const settings = getHouseSettings();
  const rememberedAssignment = roommate?.id
    ? getOldestPendingAssignment(roommate.id)
    : null;
  const message =
    input.message ??
    (rememberedAssignment
      ? [
          `Test reminder from ${settings.houseName}: ${rememberedAssignment.choreTitle} is on ${roommate?.name}.`,
          `Due date: ${rememberedAssignment.dueDate}`,
          `Reply DONE ${rememberedAssignment.id} when finished.`,
          `If you cannot do it, reply "I can't do it today, skip".`
        ].join("\n")
      : `Test reminder from ${settings.houseName}. Reply TASKS to see your current chores.`);
  const outboundTo = resolveOutboundWhatsappNumber(to);

  if (!hasTwilioCredentials()) {
    return {
      delivered: false,
      transport: "stub",
      to,
      message
    };
  }

  const result = await sendWhatsappMessage(to, message);
  if (rememberedAssignment) {
    rememberLastOutboundAssignment(outboundTo, rememberedAssignment.id);
  }
  addEventLog({
    roommateId: roommate?.id ?? null,
    assignmentId: null,
    eventType: "TEST_REMINDER_SENT",
    payload: JSON.stringify({
      originalTo: to,
      effectiveTo: outboundTo,
      rememberedAssignmentId: rememberedAssignment?.id ?? null,
      sid: result.sid,
      viaSandbox: config.twilioWhatsappNumber
    })
  });

  return {
    delivered: true,
    transport: "twilio",
    to,
    message,
    sid: result.sid
  };
}
