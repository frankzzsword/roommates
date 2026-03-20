export type AssignmentStatus = "pending" | "done" | "skipped";
export type TaskMode = "fixed_schedule" | "rolling_until_done";
export type AdvanceRotationOn = "completed_only" | "rescue_keeps_owner";
export type AssignmentResolutionType = "done" | "rescued" | "skipped";
export type AccountabilityState =
  | "on_track"
  | "reminder_sent"
  | "escalated"
  | "rescued"
  | "owner_owes_repeat_turn";
export type PenaltyStatus = "open" | "waived" | "paid";
export type PenaltyTrigger = "missed" | "skipped" | "manual";
export type FrequencyUnit = "day" | "week" | "month";
export type CurrencyCode = "EUR";

export interface HouseSettings {
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

export interface Roommate {
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
  createdAt: string;
  updatedAt: string;
}

export interface RoommateSummary extends Roommate {
  pendingCount: number;
  completedCount: number;
  skippedCount: number;
  openPenaltyCount: number;
}

export interface PenaltyRule {
  id: number;
  title: string;
  description: string | null;
  triggerType: PenaltyTrigger;
  amountCents: number;
  isActive: number;
  createdAt: string;
  updatedAt: string;
}

export interface Penalty {
  id: number;
  roommateId: number;
  assignmentId: number | null;
  ruleId: number | null;
  reason: string | null;
  amountCents: number;
  status: PenaltyStatus;
  createdAt: string;
  settledAt: string | null;
  roommateName: string;
  ruleTitle: string | null;
}

export interface ExpenseShare {
  expenseId: number;
  roommateId: number;
  roommateName: string;
  shareCents: number;
}

export interface Expense {
  id: number;
  title: string;
  amountCents: number;
  currency: CurrencyCode;
  paidByRoommateId: number;
  paidByRoommateName: string;
  note: string | null;
  createdAt: string;
  excludedRoommateIds: number[];
  excludedRoommateNames: string[];
  shares: ExpenseShare[];
}

export interface Settlement {
  id: number;
  fromRoommateId: number;
  fromRoommateName: string;
  toRoommateId: number;
  toRoommateName: string;
  amountCents: number;
  currency: CurrencyCode;
  note: string | null;
  createdAt: string;
}

export interface BalanceEntry {
  fromRoommateId: number;
  fromRoommateName: string;
  toRoommateId: number;
  toRoommateName: string;
  amountCents: number;
  currency: CurrencyCode;
}

export interface Chore {
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
  penaltyRuleTitle: string | null;
  parentChoreTitle: string | null;
}

export interface Assignment {
  id: number;
  choreId: number;
  roommateId: number;
  dueDate: string;
  windowStartDate: string | null;
  windowEndDate: string | null;
  status: AssignmentStatus;
  statusNote: string | null;
  resolutionType: AssignmentResolutionType | null;
  responsibleRoommateId: number;
  rescuedByRoommateId: number | null;
  escalationLevel: number;
  strikeApplied: number;
  rescueCreditApplied: number;
  createdAt: string;
  completedAt: string | null;
  reminderSentAt: string | null;
  penaltyAppliedAt: string | null;
  accountabilityState: AccountabilityState;
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
  parentChoreTitle: string | null;
  defaultDueHour: number;
  reminderLeadMinutes: number;
  penaltyRuleId: number | null;
  penaltyRuleTitle: string | null;
  roommateName: string;
  responsibleRoommateName: string;
  rescuedByRoommateName: string | null;
  whatsappNumber: string;
  roommateReminderEnabled: number;
  roommateReminderHour: number;
  roommateReminderLeadMinutes: number;
}

export interface EventLogEntry {
  id: number;
  assignmentId: number | null;
  eventType: string;
  payloadJson: string | null;
  createdAt: string;
  roommateName: string | null;
}

export interface HouseholdSnapshot {
  settings: HouseSettings;
  roommates: RoommateSummary[];
  chores: Chore[];
  assignments: Assignment[];
  events: EventLogEntry[];
  penaltyRules: PenaltyRule[];
  penalties: Penalty[];
  expenses: Expense[];
  settlements: Settlement[];
  balances: BalanceEntry[];
}

export interface CommandResult {
  message: string;
  assignmentId?: number;
}
