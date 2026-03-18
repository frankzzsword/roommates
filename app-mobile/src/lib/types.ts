export type ChoreStatus = "pending" | "overdue" | "done" | "skipped" | "rescued";
export type PenaltyStatus = "owed" | "paid" | "waived";
export type DataMode = "preview" | "live" | "hybrid";
export type FrequencyUnit = "day" | "week" | "month";
export type TaskMode = "fixed_schedule" | "rolling_until_done";
export type AdvanceRotationOn = "completed_only" | "rescue_keeps_owner";
export type AccountabilityState =
  | "on_track"
  | "reminder_sent"
  | "escalated"
  | "rescued"
  | "owner_owes_repeat_turn";
export type ResolutionType = "done" | "rescued" | "skipped" | null;

export interface ReminderPreferences {
  personalEnabled: boolean;
  dayBefore: boolean;
  dayOf: boolean;
  escalationEnabled: boolean;
  escalationHours: number;
  reminderHour: number;
  reminderLeadHours: number;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface UiRoommate {
  id: string;
  name: string;
  whatsappNumber: string;
  role: string;
  note: string;
  isActive: boolean;
  sortOrder: number;
  reliability: number;
  pendingCount: number;
  completedCount: number;
  missedCount: number;
  strikeCount: number;
  rescueCount: number;
  reminderPreferences: ReminderPreferences;
}

export interface UiChore {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  assignee: string;
  dueAt: string;
  dueLabel: string;
  cadence: string;
  area: string;
  points: number;
  reminderEnabled: boolean;
  taskMode: TaskMode;
  accountabilityState: AccountabilityState;
  resolutionType: ResolutionType;
  responsibleRoommateId: string;
  responsibleRoommate: string;
  rescuedByRoommateId: string | null;
  rescuedByRoommate: string | null;
  escalationLevel: number;
  strikeApplied: boolean;
  rescueCreditApplied: boolean;
  status: ChoreStatus;
}

export interface UiTaskTemplate {
  id: string;
  title: string;
  description: string;
  area: string;
  assigneeId: string;
  assignee: string;
  frequencyInterval: number;
  frequencyUnit: FrequencyUnit;
  taskMode: TaskMode;
  softReminderAfterHours: number;
  repeatReminderEveryHours: number;
  escalateAfterHours: number;
  advanceRotationOn: AdvanceRotationOn;
  cadenceLabel: string;
  reminderEnabled: boolean;
  isOptionalSubtask: boolean;
  parentTemplateId: string | null;
  parentTemplateTitle: string | null;
  isActive: boolean;
}

export interface UiActivityEntry {
  id: string;
  type: "completed" | "missed" | "reminder" | "rescue" | "escalation" | "system";
  title: string;
  actor: string;
  timestamp: string;
}

export interface UiPenaltyRule {
  id: string;
  enabled: boolean;
  label: string;
  amount: number;
  currency: string;
  graceHours: number;
  strikeThreshold: number;
}

export interface UiPenaltyEntry {
  id: string;
  roommateId: string;
  roommateName: string;
  reason: string;
  amount: number;
  amountLabel: string;
  status: PenaltyStatus;
  createdAt: string;
  createdLabel: string;
  dueLabel: string;
}

export interface UiExpenseShare {
  roommateId: string;
  roommateName: string;
  share: number;
  shareLabel: string;
}

export interface UiExpenseEntry {
  id: string;
  title: string;
  amount: number;
  amountLabel: string;
  paidByRoommateId: string;
  paidByRoommateName: string;
  note: string;
  createdAt: string;
  createdLabel: string;
  excludedRoommateIds: string[];
  excludedRoommateNames: string[];
  shares: UiExpenseShare[];
}

export interface UiBalanceEntry {
  fromRoommateId: string;
  fromRoommateName: string;
  toRoommateId: string;
  toRoommateName: string;
  amount: number;
  amountLabel: string;
}

export interface UiHouseSettings {
  autoReminders: boolean;
  weeklySummary: boolean;
  escalationEnabled: boolean;
  summaryDay: string;
  groupChatName: string;
  weeklyAchievementLabel: string;
  monthlyAchievementLabel: string;
}

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

export interface UiHouseSummary {
  completionRate: number;
  overdueCount: number;
  pendingCount: number;
  upcomingCount: number;
  rescuedCount: number;
  strikeCount: number;
  topPerformerName: string;
  topPerformerScore: number;
  weeklyChampion: string;
  monthlyChampion: string;
}

export interface UiScoreboardEntry {
  roommateId: string;
  roommateName: string;
  weeklyScore: number;
  monthlyScore: number;
  totalScore: number;
  reliability: number;
  completedCount: number;
  missedCount: number;
  rescueCount: number;
  strikeCount: number;
  streak: number;
  achievementTone: "success" | "warning" | "neutral";
  achievementSummary: string;
}

export interface RoommateDraft {
  name: string;
  whatsappNumber: string;
  note: string;
  isActive: boolean;
  sortOrder?: number;
  reminderPreferences: ReminderPreferences;
}

export interface HouseholdSnapshot {
  houseName: string;
  activeRoommateId: string;
  roommates: UiRoommate[];
  taskTemplates: UiTaskTemplate[];
  chores: UiChore[];
  activity: UiActivityEntry[];
  penalties: UiPenaltyEntry[];
  expenses: UiExpenseEntry[];
  balances: UiBalanceEntry[];
  penaltyRule: UiPenaltyRule;
  settings: UiHouseSettings;
  lastSyncLabel: string;
}

export interface HouseholdState {
  snapshot: HouseholdSnapshot;
  loading: boolean;
  mode: DataMode;
  error: string | null;
  syncNotice: string | null;
}

export interface SaveResult {
  synced: boolean;
  notice?: string;
}
