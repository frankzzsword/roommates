import { db } from "../db/client.js";
import type {
  AccountabilityState,
  AdvanceRotationOn,
  Assignment,
  AssignmentResolutionType,
  AssignmentStatus,
  BalanceEntry,
  Chore,
  Expense,
  ExpenseShare,
  EventLogEntry,
  FrequencyUnit,
  HouseSettings,
  Penalty,
  PenaltyRule,
  PenaltyStatus,
  Roommate,
  RoommateSummary,
  Settlement,
  TaskMode
} from "../lib/types.js";

const assignmentBaseQuery = `
  SELECT
    assignments.id,
    assignments.chore_id as choreId,
    assignments.roommate_id as roommateId,
    assignments.due_date as dueDate,
    assignments.status as status,
    assignments.status_note as statusNote,
    assignments.resolution_type as resolutionType,
    assignments.responsible_roommate_id as responsibleRoommateId,
    assignments.rescued_by_roommate_id as rescuedByRoommateId,
    assignments.escalation_level as escalationLevel,
    assignments.strike_applied as strikeApplied,
    assignments.rescue_credit_applied as rescueCreditApplied,
    assignments.created_at as createdAt,
    assignments.completed_at as completedAt,
    assignments.reminder_sent_at as reminderSentAt,
    assignments.penalty_applied_at as penaltyAppliedAt,
    chores.title as choreTitle,
    chores.description as choreDescription,
    chores.cadence as cadence,
    chores.area as area,
    chores.points as points,
    chores.frequency_interval as frequencyInterval,
    chores.frequency_unit as frequencyUnit,
    chores.task_mode as taskMode,
    chores.soft_reminder_after_hours as softReminderAfterHours,
    chores.repeat_reminder_every_hours as repeatReminderEveryHours,
    chores.escalate_after_hours as escalateAfterHours,
    chores.advance_rotation_on as advanceRotationOn,
    chores.is_optional as isOptional,
    chores.parent_chore_id as parentChoreId,
    chores.default_due_hour as defaultDueHour,
    chores.reminder_lead_minutes as reminderLeadMinutes,
    chores.penalty_rule_id as penaltyRuleId,
    penalty_rules.title as penaltyRuleTitle,
    parent_chore.title as parentChoreTitle,
    roommates.name as roommateName,
    responsible_roommates.name as responsibleRoommateName,
    rescued_by_roommates.name as rescuedByRoommateName,
    roommates.whatsapp_number as whatsappNumber,
    roommates.reminder_enabled as roommateReminderEnabled,
    roommates.reminder_hour as roommateReminderHour,
    roommates.reminder_lead_minutes as roommateReminderLeadMinutes
  FROM assignments
  INNER JOIN chores ON chores.id = assignments.chore_id
  INNER JOIN roommates ON roommates.id = assignments.roommate_id
  LEFT JOIN roommates AS responsible_roommates
    ON responsible_roommates.id = assignments.responsible_roommate_id
  LEFT JOIN roommates AS rescued_by_roommates
    ON rescued_by_roommates.id = assignments.rescued_by_roommate_id
  LEFT JOIN penalty_rules ON penalty_rules.id = chores.penalty_rule_id
  LEFT JOIN chores AS parent_chore ON parent_chore.id = chores.parent_chore_id
`;

function nowIso() {
  return new Date().toISOString();
}

function patchRecord(tableName: string, id: number, values: Record<string, unknown>) {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return;
  }

  const setClause = entries.map(([key]) => `${key} = @${key}`).join(", ");
  db.prepare(
    `
      UPDATE ${tableName}
      SET ${setClause}
      WHERE id = @id
    `
  ).run({ id, ...Object.fromEntries(entries) });
}

function normalizeFrequencyUnit(value?: string | null): FrequencyUnit {
  if (value === "day" || value === "week" || value === "month") {
    return value;
  }

  return "week";
}

function normalizeTaskMode(value?: string | null): TaskMode {
  if (value === "fixed_schedule" || value === "rolling_until_done") {
    return value;
  }

  return "fixed_schedule";
}

function normalizeAdvanceRotationOn(value?: string | null): AdvanceRotationOn {
  if (value === "completed_only" || value === "rescue_keeps_owner") {
    return value;
  }

  return "completed_only";
}

function deriveAssignmentResolutionType(
  status: AssignmentStatus,
  resolutionType?: AssignmentResolutionType | null
) {
  if (resolutionType) {
    return resolutionType;
  }

  if (status === "done") {
    return "done";
  }

  if (status === "skipped") {
    return "skipped";
  }

  return null;
}

function deriveAccountabilityState(assignment: Omit<Assignment, "accountabilityState">): AccountabilityState {
  if (
    assignment.taskMode === "rolling_until_done" &&
    assignment.resolutionType === "rescued" &&
    assignment.advanceRotationOn === "rescue_keeps_owner"
  ) {
    return "owner_owes_repeat_turn";
  }

  if (assignment.resolutionType === "rescued") {
    return "rescued";
  }

  if (assignment.status === "pending" && assignment.escalationLevel >= 2) {
    return "escalated";
  }

  if (assignment.status === "pending" && (assignment.escalationLevel >= 1 || assignment.reminderSentAt)) {
    return "reminder_sent";
  }

  return "on_track";
}

function withAccountabilityState(assignment: Assignment | null): Assignment | null {
  if (!assignment) {
    return null;
  }

  return {
    ...assignment,
    accountabilityState: deriveAccountabilityState(assignment)
  };
}

function deriveCadenceLabel(interval: number, unit: FrequencyUnit) {
  const cleanInterval = Number.isFinite(interval) && interval > 0 ? interval : 1;
  if (cleanInterval === 1) {
    return `Every ${unit}`;
  }

  const suffix = unit === "month" ? "months" : `${unit}s`;

  return `Every ${cleanInterval} ${suffix}`;
}

export function getHouseSettings(): HouseSettings {
  return db.prepare(
    `
      SELECT
        id,
        house_name as houseName,
        timezone,
        auto_reminders_enabled as autoRemindersEnabled,
        weekly_summary_enabled as weeklySummaryEnabled,
        summary_day as summaryDay,
        summary_hour as summaryHour,
        default_penalty_amount_cents as defaultPenaltyAmountCents,
        default_reminder_lead_minutes as defaultReminderLeadMinutes,
        penalty_label as penaltyLabel,
        weekly_achievement_label as weeklyAchievementLabel,
        monthly_achievement_label as monthlyAchievementLabel,
        updated_at as updatedAt
      FROM house_settings
      WHERE id = 1
    `
  ).get() as HouseSettings;
}

export function updateHouseSettings(input: Partial<HouseSettings>) {
  patchRecord("house_settings", 1, {
    house_name: input.houseName,
    timezone: input.timezone,
    auto_reminders_enabled: input.autoRemindersEnabled,
    weekly_summary_enabled: input.weeklySummaryEnabled,
    summary_day: input.summaryDay,
    summary_hour: input.summaryHour,
    default_penalty_amount_cents: input.defaultPenaltyAmountCents,
    default_reminder_lead_minutes: input.defaultReminderLeadMinutes,
    penalty_label: input.penaltyLabel,
    weekly_achievement_label: input.weeklyAchievementLabel,
    monthly_achievement_label: input.monthlyAchievementLabel,
    updated_at: nowIso()
  });

  return getHouseSettings();
}

export function findRoommateByWhatsappNumber(
  whatsappNumber: string
): Roommate | null {
  const row = db
    .prepare(
      `
      SELECT
        id,
        name,
        whatsapp_number as whatsappNumber,
        is_active as isActive,
        sort_order as sortOrder,
        reminder_enabled as reminderEnabled,
        reminder_hour as reminderHour,
        reminder_lead_minutes as reminderLeadMinutes,
        notes,
        penalty_balance_cents as penaltyBalanceCents,
        created_at as createdAt,
        updated_at as updatedAt
      FROM roommates
      WHERE whatsapp_number = ?
      LIMIT 1
    `
    )
    .get(whatsappNumber) as Roommate | undefined;

  return row ?? null;
}

export function findRoommateByCredentials(name: string, loginPassword: string) {
  const row = db
    .prepare(
      `
      SELECT
        id,
        name,
        whatsapp_number as whatsappNumber,
        is_active as isActive,
        sort_order as sortOrder,
        reminder_enabled as reminderEnabled,
        reminder_hour as reminderHour,
        reminder_lead_minutes as reminderLeadMinutes,
        notes,
        penalty_balance_cents as penaltyBalanceCents,
        created_at as createdAt,
        updated_at as updatedAt
      FROM roommates
      WHERE LOWER(name) = LOWER(?)
        AND login_password = ?
      LIMIT 1
    `
    )
    .get(name, loginPassword) as Roommate | undefined;

  return row ?? null;
}

export function getRoommateById(id: number) {
  const row = db
    .prepare(
      `
      SELECT
        id,
        name,
        whatsapp_number as whatsappNumber,
        is_active as isActive,
        sort_order as sortOrder,
        reminder_enabled as reminderEnabled,
        reminder_hour as reminderHour,
        reminder_lead_minutes as reminderLeadMinutes,
        notes,
        penalty_balance_cents as penaltyBalanceCents,
        created_at as createdAt,
        updated_at as updatedAt
      FROM roommates
      WHERE id = ?
    `
    )
    .get(id) as Roommate | undefined;

  return row ?? null;
}

export function listRoommates(): RoommateSummary[] {
  return db
    .prepare(
      `
      SELECT
        roommates.id,
        roommates.name,
        roommates.whatsapp_number as whatsappNumber,
        roommates.is_active as isActive,
        roommates.sort_order as sortOrder,
        roommates.reminder_enabled as reminderEnabled,
        roommates.reminder_hour as reminderHour,
        roommates.reminder_lead_minutes as reminderLeadMinutes,
        roommates.notes as notes,
        roommates.penalty_balance_cents as penaltyBalanceCents,
        roommates.created_at as createdAt,
        roommates.updated_at as updatedAt,
        COUNT(DISTINCT CASE WHEN assignments.status = 'pending' THEN assignments.id END) as pendingCount,
        COUNT(DISTINCT CASE WHEN assignments.status = 'done' THEN assignments.id END) as completedCount,
        COUNT(
          DISTINCT CASE
            WHEN assignments.status = 'skipped' AND COALESCE(assignments.strike_applied, 0) > 0
              THEN assignments.id
          END
        ) as skippedCount,
        COUNT(DISTINCT CASE WHEN penalties.status = 'open' THEN penalties.id END) as openPenaltyCount
      FROM roommates
      LEFT JOIN assignments ON assignments.roommate_id = roommates.id
      LEFT JOIN penalties ON penalties.roommate_id = roommates.id
      GROUP BY roommates.id
      ORDER BY roommates.sort_order ASC, roommates.name ASC
    `
    )
    .all() as RoommateSummary[];
}

export function createRoommate(input: {
  name: string;
  whatsappNumber: string;
  loginPassword?: string;
  isActive?: number;
  sortOrder?: number;
  reminderEnabled?: number;
  reminderHour?: number;
  reminderLeadMinutes?: number;
  notes?: string | null;
}) {
  const maxSortOrderRow = db
    .prepare("SELECT COALESCE(MAX(sort_order), 0) as maxSortOrder FROM roommates")
    .get() as { maxSortOrder: number };
  const result = db
    .prepare(
      `
      INSERT INTO roommates (
        name,
        whatsapp_number,
        login_password,
        is_active,
        sort_order,
        reminder_enabled,
        reminder_hour,
        reminder_lead_minutes,
        notes,
        created_at,
        updated_at
      )
      VALUES (
        @name,
        @whatsappNumber,
        @loginPassword,
        @isActive,
        @sortOrder,
        @reminderEnabled,
        @reminderHour,
        @reminderLeadMinutes,
        @notes,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `
    )
    .run({
      name: input.name,
      whatsappNumber: input.whatsappNumber,
      loginPassword: input.loginPassword ?? `${input.name.toLowerCase()}123`,
      isActive: input.isActive ?? 1,
      sortOrder: input.sortOrder ?? maxSortOrderRow.maxSortOrder + 1,
      reminderEnabled: input.reminderEnabled ?? 1,
      reminderHour: input.reminderHour ?? 18,
      reminderLeadMinutes: input.reminderLeadMinutes ?? 120,
      notes: input.notes ?? null
    });

  return getRoommateById(Number(result.lastInsertRowid));
}

export function updateRoommate(
  id: number,
  input: {
    name?: string;
    whatsappNumber?: string;
    loginPassword?: string;
    isActive?: number;
    sortOrder?: number;
    reminderEnabled?: number;
    reminderHour?: number;
    reminderLeadMinutes?: number;
    notes?: string | null;
  }
) {
  patchRecord("roommates", id, {
    name: input.name,
    whatsapp_number: input.whatsappNumber,
    login_password: input.loginPassword,
    is_active: input.isActive,
    sort_order: input.sortOrder,
    reminder_enabled: input.reminderEnabled,
    reminder_hour: input.reminderHour,
    reminder_lead_minutes: input.reminderLeadMinutes,
    notes: input.notes,
    updated_at: nowIso()
  });

  return getRoommateById(id);
}

export function listPenaltyRules(): PenaltyRule[] {
  return db
    .prepare(
      `
      SELECT
        id,
        title,
        description,
        trigger_type as triggerType,
        amount_cents as amountCents,
        is_active as isActive,
        created_at as createdAt,
        updated_at as updatedAt
      FROM penalty_rules
      ORDER BY is_active DESC, amount_cents DESC, id ASC
    `
    )
    .all() as PenaltyRule[];
}

export function getPenaltyRuleById(id: number) {
  const row = db
    .prepare(
      `
      SELECT
        id,
        title,
        description,
        trigger_type as triggerType,
        amount_cents as amountCents,
        is_active as isActive,
        created_at as createdAt,
        updated_at as updatedAt
      FROM penalty_rules
      WHERE id = ?
    `
    )
    .get(id) as PenaltyRule | undefined;

  return row ?? null;
}

export function createPenaltyRule(input: {
  title: string;
  description?: string | null;
  triggerType?: PenaltyRule["triggerType"];
  amountCents: number;
  isActive?: number;
}) {
  const result = db
    .prepare(
      `
      INSERT INTO penalty_rules (
        title,
        description,
        trigger_type,
        amount_cents,
        is_active,
        created_at,
        updated_at
      )
      VALUES (
        @title,
        @description,
        @triggerType,
        @amountCents,
        @isActive,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `
    )
    .run({
      title: input.title,
      description: input.description ?? null,
      triggerType: input.triggerType ?? "manual",
      amountCents: input.amountCents,
      isActive: input.isActive ?? 1
    });

  return getPenaltyRuleById(Number(result.lastInsertRowid));
}

export function updatePenaltyRule(
  id: number,
  input: {
    title?: string;
    description?: string | null;
    triggerType?: PenaltyRule["triggerType"];
    amountCents?: number;
    isActive?: number;
  }
) {
  patchRecord("penalty_rules", id, {
    title: input.title,
    description: input.description,
    trigger_type: input.triggerType,
    amount_cents: input.amountCents,
    is_active: input.isActive,
    updated_at: nowIso()
  });

  return getPenaltyRuleById(id);
}

export function listChores(): Chore[] {
  return db
    .prepare(
      `
      SELECT
        chores.id,
        chores.title,
        chores.description,
        chores.cadence,
        chores.area,
        chores.points,
        chores.frequency_interval as frequencyInterval,
        chores.frequency_unit as frequencyUnit,
        chores.task_mode as taskMode,
        chores.soft_reminder_after_hours as softReminderAfterHours,
        chores.repeat_reminder_every_hours as repeatReminderEveryHours,
        chores.escalate_after_hours as escalateAfterHours,
        chores.advance_rotation_on as advanceRotationOn,
        chores.is_optional as isOptional,
        chores.parent_chore_id as parentChoreId,
        chores.default_due_hour as defaultDueHour,
        chores.default_assignee_id as defaultAssigneeId,
        chores.is_active as isActive,
        chores.reminder_lead_minutes as reminderLeadMinutes,
        chores.penalty_rule_id as penaltyRuleId,
        chores.created_at as createdAt,
        chores.updated_at as updatedAt,
        roommates.name as defaultAssigneeName,
        penalty_rules.title as penaltyRuleTitle,
        parent_chore.title as parentChoreTitle
      FROM chores
      LEFT JOIN roommates ON roommates.id = chores.default_assignee_id
      LEFT JOIN penalty_rules ON penalty_rules.id = chores.penalty_rule_id
      LEFT JOIN chores AS parent_chore ON parent_chore.id = chores.parent_chore_id
      ORDER BY
        chores.is_active DESC,
        CASE WHEN chores.parent_chore_id IS NULL THEN 0 ELSE 1 END,
        COALESCE(parent_chore.title, chores.title) ASC,
        chores.title ASC
    `
    )
    .all() as Chore[];
}

export function getChoreById(id: number) {
  const row = db
    .prepare(
      `
      SELECT
        chores.id,
        chores.title,
        chores.description,
        chores.cadence,
        chores.area,
        chores.points,
        chores.frequency_interval as frequencyInterval,
        chores.frequency_unit as frequencyUnit,
        chores.task_mode as taskMode,
        chores.soft_reminder_after_hours as softReminderAfterHours,
        chores.repeat_reminder_every_hours as repeatReminderEveryHours,
        chores.escalate_after_hours as escalateAfterHours,
        chores.advance_rotation_on as advanceRotationOn,
        chores.is_optional as isOptional,
        chores.parent_chore_id as parentChoreId,
        chores.default_due_hour as defaultDueHour,
        chores.default_assignee_id as defaultAssigneeId,
        chores.is_active as isActive,
        chores.reminder_lead_minutes as reminderLeadMinutes,
        chores.penalty_rule_id as penaltyRuleId,
        chores.created_at as createdAt,
        chores.updated_at as updatedAt,
        roommates.name as defaultAssigneeName,
        penalty_rules.title as penaltyRuleTitle,
        parent_chore.title as parentChoreTitle
      FROM chores
      LEFT JOIN roommates ON roommates.id = chores.default_assignee_id
      LEFT JOIN penalty_rules ON penalty_rules.id = chores.penalty_rule_id
      LEFT JOIN chores AS parent_chore ON parent_chore.id = chores.parent_chore_id
      WHERE chores.id = ?
    `
    )
    .get(id) as Chore | undefined;

  return row ?? null;
}

export function createChore(input: {
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
  const frequencyInterval = input.frequencyInterval ?? 1;
  const frequencyUnit = normalizeFrequencyUnit(input.frequencyUnit);
  const taskMode = normalizeTaskMode(input.taskMode);
  const softReminderAfterHours = Math.max(1, input.softReminderAfterHours ?? 24);
  const repeatReminderEveryHours = Math.max(1, input.repeatReminderEveryHours ?? 24);
  const escalateAfterHours = Math.max(
    softReminderAfterHours,
    input.escalateAfterHours ?? 48
  );
  const advanceRotationOn =
    taskMode === "rolling_until_done"
      ? normalizeAdvanceRotationOn(input.advanceRotationOn ?? "rescue_keeps_owner")
      : normalizeAdvanceRotationOn(input.advanceRotationOn ?? "completed_only");
  const cadence = input.cadence || deriveCadenceLabel(frequencyInterval, frequencyUnit);
  const result = db
    .prepare(
      `
      INSERT INTO chores (
        title,
        description,
        cadence,
        area,
        points,
        frequency_interval,
        frequency_unit,
        task_mode,
        soft_reminder_after_hours,
        repeat_reminder_every_hours,
        escalate_after_hours,
        advance_rotation_on,
        is_optional,
        parent_chore_id,
        default_due_hour,
        default_assignee_id,
        is_active,
        reminder_lead_minutes,
        penalty_rule_id,
        created_at,
        updated_at
      )
      VALUES (
        @title,
        @description,
        @cadence,
        @area,
        @points,
        @frequencyInterval,
        @frequencyUnit,
        @taskMode,
        @softReminderAfterHours,
        @repeatReminderEveryHours,
        @escalateAfterHours,
        @advanceRotationOn,
        @isOptional,
        @parentChoreId,
        @defaultDueHour,
        @defaultAssigneeId,
        @isActive,
        @reminderLeadMinutes,
        @penaltyRuleId,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `
    )
    .run({
      title: input.title,
      description: input.description ?? null,
      cadence,
      area: input.area ?? "Shared space",
      points: input.points ?? 10,
      frequencyInterval,
      frequencyUnit,
      taskMode,
      softReminderAfterHours,
      repeatReminderEveryHours,
      escalateAfterHours,
      advanceRotationOn,
      isOptional: input.isOptional ?? 0,
      parentChoreId: input.parentChoreId ?? null,
      defaultDueHour: input.defaultDueHour ?? 18,
      defaultAssigneeId: input.defaultAssigneeId ?? null,
      isActive: input.isActive ?? 1,
      reminderLeadMinutes: input.reminderLeadMinutes ?? 120,
      penaltyRuleId: input.penaltyRuleId ?? null
    });

  return getChoreById(Number(result.lastInsertRowid));
}

export function updateChore(
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
  const current = getChoreById(id);
  const frequencyInterval = input.frequencyInterval ?? current?.frequencyInterval ?? 1;
  const frequencyUnit = normalizeFrequencyUnit(input.frequencyUnit ?? current?.frequencyUnit);
  const taskMode = normalizeTaskMode(input.taskMode ?? current?.taskMode);
  const cadence =
    input.cadence ??
    (input.frequencyInterval !== undefined || input.frequencyUnit !== undefined
      ? deriveCadenceLabel(frequencyInterval, frequencyUnit)
      : undefined);
  const softReminderAfterHours =
    input.softReminderAfterHours === undefined
      ? undefined
      : Math.max(1, input.softReminderAfterHours);
  const repeatReminderEveryHours =
    input.repeatReminderEveryHours === undefined
      ? undefined
      : Math.max(1, input.repeatReminderEveryHours);
  const escalateAfterHours =
    input.escalateAfterHours === undefined
      ? undefined
      : Math.max(1, input.escalateAfterHours);
  patchRecord("chores", id, {
    title: input.title,
    description: input.description,
    cadence,
    area: input.area,
    points: input.points,
    frequency_interval: input.frequencyInterval,
    frequency_unit: input.frequencyUnit,
    task_mode: taskMode,
    soft_reminder_after_hours: softReminderAfterHours,
    repeat_reminder_every_hours: repeatReminderEveryHours,
    escalate_after_hours: escalateAfterHours,
    advance_rotation_on:
      input.advanceRotationOn === undefined
        ? undefined
        : normalizeAdvanceRotationOn(input.advanceRotationOn),
    is_optional: input.isOptional,
    parent_chore_id: input.parentChoreId,
    default_due_hour: input.defaultDueHour,
    default_assignee_id: input.defaultAssigneeId,
    is_active: input.isActive,
    reminder_lead_minutes: input.reminderLeadMinutes,
    penalty_rule_id: input.penaltyRuleId,
    updated_at: nowIso()
  });

  return getChoreById(id);
}

export function listAssignments(): Assignment[] {
  const rows = db
    .prepare(
      `
      ${assignmentBaseQuery}
      ORDER BY
        CASE assignments.status
          WHEN 'pending' THEN 0
          WHEN 'done' THEN 1
          ELSE 2
        END,
        assignments.due_date ASC,
        assignments.id ASC
    `
    )
    .all() as Assignment[];

  return rows
    .map((assignment) => withAccountabilityState(assignment))
    .filter(Boolean) as Assignment[];
}

export function getAssignmentById(assignmentId: number): Assignment | null {
  const row = db
    .prepare(
      `
      ${assignmentBaseQuery}
      WHERE assignments.id = ?
      LIMIT 1
    `
    )
    .get(assignmentId) as Assignment | undefined;

  return withAccountabilityState(row ?? null);
}

export function listPendingAssignmentsForRoommate(roommateId: number): Assignment[] {
  const rows = db
    .prepare(
      `
      ${assignmentBaseQuery}
      WHERE assignments.roommate_id = ?
        AND assignments.status = 'pending'
      ORDER BY assignments.due_date ASC, assignments.id ASC
    `
    )
    .all(roommateId) as Assignment[];

  return rows
    .map((assignment) => withAccountabilityState(assignment))
    .filter(Boolean) as Assignment[];
}

export function listAllPendingAssignments(): Assignment[] {
  const rows = db
    .prepare(
      `
      ${assignmentBaseQuery}
      WHERE assignments.status = 'pending'
      ORDER BY assignments.due_date ASC, assignments.id ASC
    `
    )
    .all() as Assignment[];

  return rows
    .map((assignment) => withAccountabilityState(assignment))
    .filter(Boolean) as Assignment[];
}

export function getOldestPendingAssignment(roommateId: number): Assignment | null {
  const row = db
    .prepare(
      `
      ${assignmentBaseQuery}
      WHERE assignments.roommate_id = ?
        AND assignments.status = 'pending'
      ORDER BY assignments.due_date ASC, assignments.id ASC
      LIMIT 1
    `
    )
    .get(roommateId) as Assignment | undefined;

  return withAccountabilityState(row ?? null);
}

export function markReminderSent(assignmentId: number) {
  db.prepare(
    `
      UPDATE assignments
      SET reminder_sent_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(assignmentId);

  const assignment = getAssignmentById(assignmentId);
  if (!assignment) {
    return;
  }

  const nextLevel =
    assignment.escalationLevel >= 2
      ? assignment.escalationLevel
      : assignment.escalationLevel === 0
        ? 1
        : assignment.escalationLevel;

  if (nextLevel !== assignment.escalationLevel) {
    patchRecord("assignments", assignmentId, {
      escalation_level: nextLevel
    });
  }

  addEventLog({
    roommateId: assignment.roommateId,
    assignmentId,
    eventType: "TASK_REMINDER_SENT",
    payload: JSON.stringify({ escalationLevel: nextLevel })
  });
}

export function createAssignment(input: {
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
  const status = input.status ?? "pending";
  const resolutionType = deriveAssignmentResolutionType(status, input.resolutionType);
  const result = db
    .prepare(
      `
      INSERT INTO assignments (
        chore_id,
        roommate_id,
        due_date,
        status,
        status_note,
        resolution_type,
        responsible_roommate_id,
        rescued_by_roommate_id,
        escalation_level,
        strike_applied,
        rescue_credit_applied,
        created_at
      )
      VALUES (
        @choreId,
        @roommateId,
        @dueDate,
        @status,
        @statusNote,
        @resolutionType,
        @responsibleRoommateId,
        @rescuedByRoommateId,
        @escalationLevel,
        @strikeApplied,
        @rescueCreditApplied,
        CURRENT_TIMESTAMP
      )
    `
    )
    .run({
      choreId: input.choreId,
      roommateId: input.roommateId,
      dueDate: input.dueDate,
      status,
      statusNote: input.statusNote ?? null,
      resolutionType,
      responsibleRoommateId: input.responsibleRoommateId ?? input.roommateId,
      rescuedByRoommateId: input.rescuedByRoommateId ?? null,
      escalationLevel: input.escalationLevel ?? 0,
      strikeApplied: input.strikeApplied ?? 0,
      rescueCreditApplied: input.rescueCreditApplied ?? 0
    });

  const assignmentId = Number(result.lastInsertRowid);
  addEventLog({
    roommateId: input.roommateId,
    assignmentId,
    eventType: "ASSIGNMENT_CREATED",
    payload: JSON.stringify({ dueDate: input.dueDate })
  });

  return getAssignmentById(assignmentId);
}

function getExistingPenaltyForAssignment(assignmentId: number) {
  const row = db
    .prepare(
      `
      SELECT id
      FROM penalties
      WHERE assignment_id = ?
        AND status = 'open'
      LIMIT 1
    `
    )
    .get(assignmentId) as { id: number } | undefined;

  return row ?? null;
}

export function recalculatePenaltyBalance(roommateId: number) {
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(amount_cents), 0) as amount
      FROM penalties
      WHERE roommate_id = ?
        AND status = 'open'
    `
    )
    .get(roommateId) as { amount: number };

  db.prepare(
    `
      UPDATE roommates
      SET penalty_balance_cents = @amount,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @roommateId
    `
  ).run({ roommateId, amount: row.amount });
}

function maybeCreatePenaltyForAssignment(assignment: Assignment, reason: string | null) {
  if (
    assignment.status !== "skipped" ||
    assignment.penaltyRuleId === null ||
    assignment.strikeApplied <= 0
  ) {
    return;
  }

  if (getExistingPenaltyForAssignment(assignment.id)) {
    return;
  }

  const rule = getPenaltyRuleById(assignment.penaltyRuleId);
  if (!rule || !rule.isActive) {
    return;
  }

  db.prepare(
    `
      INSERT INTO penalties (
        roommate_id,
        assignment_id,
        rule_id,
        reason,
        amount_cents,
        status,
        created_at
      )
      VALUES (
        @roommateId,
        @assignmentId,
        @ruleId,
        @reason,
        @amountCents,
        'open',
        CURRENT_TIMESTAMP
      )
    `
  ).run({
    roommateId: assignment.roommateId,
    assignmentId: assignment.id,
    ruleId: rule.id,
    reason: reason ?? `Penalty triggered for ${assignment.choreTitle}`,
    amountCents: rule.amountCents
  });

  db.prepare(
    `
      UPDATE assignments
      SET penalty_applied_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
  ).run(assignment.id);

  addEventLog({
    roommateId: assignment.roommateId,
    assignmentId: assignment.id,
    eventType: "PENALTY_CREATED",
    payload: JSON.stringify({ ruleId: rule.id, amountCents: rule.amountCents })
  });

  recalculatePenaltyBalance(assignment.roommateId);
}

function getRotationRoommates() {
  return listRoommates().filter((roommate) => roommate.isActive);
}

function getNextRoommateInRotation(roommateId: number) {
  const rotationRoommates = getRotationRoommates();
  if (rotationRoommates.length === 0) {
    return null;
  }

  const currentIndex = rotationRoommates.findIndex((roommate) => roommate.id === roommateId);
  return currentIndex === -1
    ? rotationRoommates[0]
    : rotationRoommates[(currentIndex + 1) % rotationRoommates.length];
}

export function getNextRoommateForAssignment(assignment: Pick<Assignment, "roommateId">) {
  return getNextRoommateInRotation(assignment.roommateId);
}

function setChoreDefaultAssignee(choreId: number, roommateId: number) {
  db.prepare(
    `
      UPDATE chores
      SET default_assignee_id = @roommateId,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @choreId
    `
  ).run({
    choreId,
    roommateId
  });
}

function findStandbyRoommateForFixedAssignment(assignment: Assignment) {
  const row = db
    .prepare(
      `
      SELECT
        roommates.id,
        roommates.name,
        roommates.whatsapp_number as whatsappNumber,
        roommates.is_active as isActive,
        roommates.sort_order as sortOrder,
        roommates.reminder_enabled as reminderEnabled,
        roommates.reminder_hour as reminderHour,
        roommates.reminder_lead_minutes as reminderLeadMinutes,
        roommates.notes,
        roommates.penalty_balance_cents as penaltyBalanceCents,
        roommates.created_at as createdAt,
        roommates.updated_at as updatedAt
      FROM roommates
      WHERE roommates.is_active = 1
        AND roommates.id <> @currentRoommateId
        AND NOT EXISTS (
          SELECT 1
          FROM assignments
          INNER JOIN chores ON chores.id = assignments.chore_id
          WHERE assignments.roommate_id = roommates.id
            AND assignments.due_date = @dueDate
            AND chores.task_mode = 'fixed_schedule'
        )
      ORDER BY roommates.sort_order ASC, roommates.name ASC
      LIMIT 1
    `
    )
    .get({
      currentRoommateId: assignment.roommateId,
      dueDate: assignment.dueDate
    }) as Roommate | undefined;

  return row ?? null;
}

function markNextFixedAssignmentPriority(assignment: Assignment) {
  const nextAssignment = db
    .prepare(
      `
      SELECT id
      FROM assignments
      WHERE chore_id = ?
        AND due_date > ?
        AND status = 'pending'
      ORDER BY due_date ASC, id ASC
      LIMIT 1
    `
    )
    .get(assignment.choreId, assignment.dueDate) as { id: number } | undefined;

  if (!nextAssignment?.id) {
    return;
  }

  const existing = getAssignmentById(nextAssignment.id);
  const carryOverNote = `carry over priority from ${assignment.roommateName}`;
  const mergedNote = existing?.statusNote
    ? `${existing.statusNote}; ${carryOverNote}`
    : carryOverNote;

  patchRecord("assignments", nextAssignment.id, {
    status_note: mergedNote
  });

  addEventLog({
    roommateId: existing?.roommateId ?? null,
    assignmentId: nextAssignment.id,
    eventType: "CARRY_OVER_PRIORITY_SET",
    payload: JSON.stringify({
      sourceAssignmentId: assignment.id,
      choreId: assignment.choreId,
      missedByRoommateId: assignment.roommateId,
      missedByRoommateName: assignment.roommateName
    })
  });
}

function advanceChoreRotation(assignment: Assignment) {
  if (assignment.status !== "done" && assignment.status !== "skipped") {
    return;
  }

  const chore = getChoreById(assignment.choreId);
  if (!chore) {
    return;
  }

  if (chore.taskMode === "fixed_schedule") {
    return;
  }

  if (
    chore.taskMode === "rolling_until_done" &&
    (assignment.status === "skipped" ||
      (assignment.resolutionType === "rescued" &&
        chore.advanceRotationOn === "rescue_keeps_owner"))
  ) {
    setChoreDefaultAssignee(assignment.choreId, assignment.responsibleRoommateId);

    addEventLog({
      roommateId: assignment.responsibleRoommateId,
      assignmentId: assignment.id,
      eventType: "OWNER_REPEATED_IN_ROTATION",
      payload: JSON.stringify({
        choreId: assignment.choreId,
        responsibleRoommateId: assignment.responsibleRoommateId
      })
    });

    return;
  }

  const nextRoommate = getNextRoommateInRotation(assignment.responsibleRoommateId);
  if (!nextRoommate) {
    return;
  }

  setChoreDefaultAssignee(assignment.choreId, nextRoommate.id);

  addEventLog({
    roommateId: nextRoommate.id,
    assignmentId: assignment.id,
    eventType: "CHORE_ROTATED",
    payload: JSON.stringify({
      choreId: assignment.choreId,
      fromRoommateId: assignment.responsibleRoommateId,
      toRoommateId: nextRoommate.id
    })
  });
}

export function updateAssignmentStatus(
  assignmentId: number,
  status: AssignmentStatus,
  note: string | null,
  options?: {
    resolutionType?: AssignmentResolutionType | null;
    rescuedByRoommateId?: number | null;
    responsibleRoommateId?: number;
    escalationLevel?: number;
    strikeApplied?: number;
    rescueCreditApplied?: number;
  }
) {
  const previous = getAssignmentById(assignmentId);
  const resolutionType = deriveAssignmentResolutionType(status, options?.resolutionType);
  db.prepare(
    `
      UPDATE assignments
      SET
        status = @status,
        status_note = @note,
        resolution_type = @resolutionType,
        responsible_roommate_id = @responsibleRoommateId,
        rescued_by_roommate_id = @rescuedByRoommateId,
        escalation_level = @escalationLevel,
        strike_applied = @strikeApplied,
        rescue_credit_applied = @rescueCreditApplied,
        completed_at = CASE
          WHEN @status IN ('done', 'skipped') THEN CURRENT_TIMESTAMP
          ELSE NULL
        END
      WHERE id = @assignmentId
    `
  ).run({
    assignmentId,
    status,
    note,
    resolutionType,
    responsibleRoommateId:
      options?.responsibleRoommateId ?? previous?.responsibleRoommateId ?? previous?.roommateId,
    rescuedByRoommateId: options?.rescuedByRoommateId ?? null,
    escalationLevel: options?.escalationLevel ?? previous?.escalationLevel ?? 0,
    strikeApplied: options?.strikeApplied ?? previous?.strikeApplied ?? 0,
    rescueCreditApplied: options?.rescueCreditApplied ?? previous?.rescueCreditApplied ?? 0
  });

  const updated = getAssignmentById(assignmentId);
  if (updated) {
    const movedIntoResolvedState =
      (updated.status === "done" || updated.status === "skipped") &&
      previous?.status !== updated.status;

    if (movedIntoResolvedState) {
      advanceChoreRotation(updated);
    }
    maybeCreatePenaltyForAssignment(updated, note);
  }
}

export function rescueAssignment(
  assignmentId: number,
  rescuedByRoommateId: number,
  note: string | null
) {
  const assignment = getAssignmentById(assignmentId);
  if (!assignment) {
    return null;
  }

  if (assignment.status !== "pending") {
    return assignment;
  }

  if (assignment.roommateId === rescuedByRoommateId) {
    updateAssignmentStatus(assignmentId, "done", note, {
      resolutionType: "done",
      responsibleRoommateId: assignment.roommateId,
      rescuedByRoommateId: null
    });
    return getAssignmentById(assignmentId);
  }

  updateAssignmentStatus(assignmentId, "done", note, {
    resolutionType: "rescued",
    responsibleRoommateId: assignment.roommateId,
    rescuedByRoommateId,
    strikeApplied: 1,
    rescueCreditApplied: 1,
    escalationLevel: Math.max(assignment.escalationLevel, 2)
  });

  addEventLog({
    roommateId: rescuedByRoommateId,
    assignmentId,
    eventType: "TASK_RESCUED",
    payload: JSON.stringify({
      choreId: assignment.choreId,
      responsibleRoommateId: assignment.roommateId,
      rescuedByRoommateId
    })
  });
  addEventLog({
    roommateId: assignment.roommateId,
    assignmentId,
    eventType: "RESPONSIBILITY_STRIKE_APPLIED",
    payload: JSON.stringify({ choreId: assignment.choreId, rescuedByRoommateId })
  });
  addEventLog({
    roommateId: rescuedByRoommateId,
    assignmentId,
    eventType: "RESCUE_CREDIT_APPLIED",
    payload: JSON.stringify({ choreId: assignment.choreId, responsibleRoommateId: assignment.roommateId })
  });

  return getAssignmentById(assignmentId);
}

export function handoffAssignmentToNextRoommate(
  assignmentId: number,
  reason: string | null
) {
  const assignment = getAssignmentById(assignmentId);
  if (!assignment || (assignment.status !== "pending" && assignment.status !== "skipped")) {
    return null;
  }

  const chore = getChoreById(assignment.choreId);
  const nextRoommate =
    chore?.taskMode === "fixed_schedule"
      ? findStandbyRoommateForFixedAssignment(assignment)
      : getNextRoommateInRotation(assignment.roommateId);

  if (!nextRoommate || nextRoommate.id === assignment.roommateId) {
    if (chore?.taskMode === "fixed_schedule") {
      markNextFixedAssignmentPriority(assignment);
      addEventLog({
        roommateId: assignment.roommateId,
        assignmentId,
        eventType: "ASSIGNMENT_CARRY_OVER",
        payload: JSON.stringify({
          choreId: assignment.choreId,
          dueDate: assignment.dueDate,
          reason
        })
      });
    }
    return null;
  }

  const existingPending = db
    .prepare(
      `
      SELECT id
      FROM assignments
      WHERE chore_id = ?
        AND roommate_id = ?
        AND due_date = ?
        AND status = 'pending'
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(assignment.choreId, nextRoommate.id, assignment.dueDate) as { id: number } | undefined;

  const reassigned =
    existingPending?.id
      ? getAssignmentById(existingPending.id)
      : createAssignment({
          choreId: assignment.choreId,
          roommateId: nextRoommate.id,
          dueDate: assignment.dueDate,
          status: "pending",
          statusNote: reason ? `handoff: ${reason}` : "handoff from WhatsApp"
        });

  addEventLog({
    roommateId: nextRoommate.id,
    assignmentId: reassigned?.id ?? null,
    eventType:
      chore?.taskMode === "fixed_schedule"
        ? "ASSIGNMENT_SWAPPED_TO_STANDBY"
        : "ASSIGNMENT_HANDOFF_CREATED",
    payload: JSON.stringify({
      originalAssignmentId: assignmentId,
      choreId: assignment.choreId,
      fromRoommateId: assignment.roommateId,
      toRoommateId: nextRoommate.id,
      reason
    })
  });

  return reassigned;
}

export function getAssignmentsDueForAutoStrike(now: Date): Assignment[] {
  return listAllPendingAssignments().filter((assignment) => {
    if (assignment.taskMode !== "fixed_schedule") {
      return false;
    }

    const dueHour = assignment.roommateReminderHour || assignment.defaultDueHour || 20;
    const dueAt = new Date(`${assignment.dueDate}T${String(dueHour).padStart(2, "0")}:00:00`);
    const strikeAt = new Date(dueAt.getTime() + 12 * 60 * 60 * 1000);

    return now >= strikeAt;
  });
}

export function applyMissedWeeklyStrike(assignmentId: number, note?: string | null) {
  const assignment = getAssignmentById(assignmentId);
  if (!assignment || assignment.status !== "pending" || assignment.taskMode !== "fixed_schedule") {
    return null;
  }

  updateAssignmentStatus(assignmentId, "skipped", note ?? "missed weekly cleaning window", {
    resolutionType: "skipped",
    responsibleRoommateId: assignment.roommateId,
    strikeApplied: 1,
    escalationLevel: Math.max(assignment.escalationLevel, 2)
  });

  const updated = getAssignmentById(assignmentId);
  if (updated) {
    markNextFixedAssignmentPriority(updated);
    addEventLog({
      roommateId: updated.roommateId,
      assignmentId,
      eventType: "WEEKLY_STRIKE_APPLIED",
      payload: JSON.stringify({
        choreId: updated.choreId,
        dueDate: updated.dueDate
      })
    });
  }

  return updated;
}

export function updateAssignment(
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
  patchRecord("assignments", id, {
    chore_id: input.choreId,
    roommate_id: input.roommateId,
    due_date: input.dueDate,
    status_note: input.status === undefined ? input.statusNote : undefined,
    resolution_type: input.status === undefined ? input.resolutionType : undefined,
    responsible_roommate_id:
      input.status === undefined ? input.responsibleRoommateId : undefined,
    rescued_by_roommate_id:
      input.status === undefined ? input.rescuedByRoommateId : undefined,
    escalation_level: input.status === undefined ? input.escalationLevel : undefined,
    strike_applied: input.status === undefined ? input.strikeApplied : undefined,
    rescue_credit_applied:
      input.status === undefined ? input.rescueCreditApplied : undefined
  });

  if (input.status !== undefined) {
    updateAssignmentStatus(id, input.status, input.statusNote ?? null, {
      resolutionType: input.resolutionType,
      responsibleRoommateId: input.responsibleRoommateId,
      rescuedByRoommateId: input.rescuedByRoommateId,
      escalationLevel: input.escalationLevel,
      strikeApplied: input.strikeApplied,
      rescueCreditApplied: input.rescueCreditApplied
    });
  }

  const assignment = getAssignmentById(id);
  if (assignment) {
    addEventLog({
      roommateId: assignment.roommateId,
      assignmentId: id,
      eventType: "ASSIGNMENT_UPDATED",
      payload: JSON.stringify({
        dueDate: input.dueDate,
        status: input.status,
        roommateId: input.roommateId
      })
    });
  }

  return assignment;
}

export function listPenalties(): Penalty[] {
  return db
    .prepare(
      `
      SELECT
        penalties.id,
        penalties.roommate_id as roommateId,
        penalties.assignment_id as assignmentId,
        penalties.rule_id as ruleId,
        penalties.reason,
        penalties.amount_cents as amountCents,
        penalties.status,
        penalties.created_at as createdAt,
        penalties.settled_at as settledAt,
        roommates.name as roommateName,
        penalty_rules.title as ruleTitle
      FROM penalties
      INNER JOIN roommates ON roommates.id = penalties.roommate_id
      LEFT JOIN penalty_rules ON penalty_rules.id = penalties.rule_id
      ORDER BY penalties.status = 'open' DESC, penalties.created_at DESC, penalties.id DESC
    `
    )
    .all() as Penalty[];
}

export function getPenaltyById(id: number) {
  const row = db
    .prepare(
      `
      SELECT
        penalties.id,
        penalties.roommate_id as roommateId,
        penalties.assignment_id as assignmentId,
        penalties.rule_id as ruleId,
        penalties.reason,
        penalties.amount_cents as amountCents,
        penalties.status,
        penalties.created_at as createdAt,
        penalties.settled_at as settledAt,
        roommates.name as roommateName,
        penalty_rules.title as ruleTitle
      FROM penalties
      INNER JOIN roommates ON roommates.id = penalties.roommate_id
      LEFT JOIN penalty_rules ON penalty_rules.id = penalties.rule_id
      WHERE penalties.id = ?
    `
    )
    .get(id) as Penalty | undefined;

  return row ?? null;
}

export function createPenalty(input: {
  roommateId: number;
  assignmentId?: number | null;
  ruleId?: number | null;
  reason?: string | null;
  amountCents?: number;
  status?: PenaltyStatus;
}) {
  const amountCents =
    input.amountCents ??
    (input.ruleId ? getPenaltyRuleById(input.ruleId)?.amountCents : undefined) ??
    getHouseSettings().defaultPenaltyAmountCents;

  const result = db
    .prepare(
      `
      INSERT INTO penalties (
        roommate_id,
        assignment_id,
        rule_id,
        reason,
        amount_cents,
        status,
        created_at,
        settled_at
      )
      VALUES (
        @roommateId,
        @assignmentId,
        @ruleId,
        @reason,
        @amountCents,
        @status,
        CURRENT_TIMESTAMP,
        CASE WHEN @status IN ('waived', 'paid') THEN CURRENT_TIMESTAMP ELSE NULL END
      )
    `
    )
    .run({
      roommateId: input.roommateId,
      assignmentId: input.assignmentId ?? null,
      ruleId: input.ruleId ?? null,
      reason: input.reason ?? null,
      amountCents,
      status: input.status ?? "open"
    });

  recalculatePenaltyBalance(input.roommateId);
  return getPenaltyById(Number(result.lastInsertRowid));
}

export function updatePenalty(
  id: number,
  input: {
    reason?: string | null;
    amountCents?: number;
    status?: PenaltyStatus;
  }
) {
  const existing = getPenaltyById(id);
  if (!existing) {
    return null;
  }

  patchRecord("penalties", id, {
    reason: input.reason,
    amount_cents: input.amountCents,
    status: input.status,
    settled_at:
      input.status === "open"
        ? null
        : input.status === undefined
          ? undefined
          : nowIso()
  });

  recalculatePenaltyBalance(existing.roommateId);
  return getPenaltyById(id);
}

function distributeExpenseShares(amountCents: number, roommateIds: number[]) {
  const included = [...new Set(roommateIds)].sort((left, right) => left - right);
  if (included.length === 0) {
    throw new Error("At least one roommate must be included.");
  }

  const baseShare = Math.floor(amountCents / included.length);
  let remainder = amountCents - baseShare * included.length;

  return included.map((roommateId) => {
    const shareCents = baseShare + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return { roommateId, shareCents };
  });
}

export function getExpenseById(id: number) {
  const expenseRow = db
    .prepare(
      `
      SELECT
        expenses.id,
        expenses.title,
        expenses.amount_cents as amountCents,
        expenses.currency,
        expenses.paid_by_roommate_id as paidByRoommateId,
        payer.name as paidByRoommateName,
        expenses.note,
        expenses.created_at as createdAt
      FROM expenses
      INNER JOIN roommates AS payer ON payer.id = expenses.paid_by_roommate_id
      WHERE expenses.id = ?
      LIMIT 1
    `
    )
    .get(id) as
    | {
        id: number;
        title: string;
        amountCents: number;
        currency: "EUR";
        paidByRoommateId: number;
        paidByRoommateName: string;
        note: string | null;
        createdAt: string;
      }
    | undefined;

  if (!expenseRow) {
    return null;
  }

  const shares = db
    .prepare(
      `
      SELECT
        expense_shares.expense_id as expenseId,
        expense_shares.roommate_id as roommateId,
        roommates.name as roommateName,
        expense_shares.share_cents as shareCents
      FROM expense_shares
      INNER JOIN roommates ON roommates.id = expense_shares.roommate_id
      WHERE expense_shares.expense_id = ?
      ORDER BY roommates.sort_order, roommates.id
    `
    )
    .all(id) as ExpenseShare[];

  const includedIds = new Set(shares.map((share) => share.roommateId));
  const excludedRows = db
    .prepare(
      `
      SELECT id, name
      FROM roommates
      WHERE is_active = 1
        AND id NOT IN (
          SELECT roommate_id
          FROM expense_shares
          WHERE expense_id = ?
        )
      ORDER BY sort_order, id
    `
    )
    .all(id) as Array<{ id: number; name: string }>;

  return {
    ...expenseRow,
    excludedRoommateIds: excludedRows
      .map((roommate) => roommate.id)
      .filter((roommateId) => !includedIds.has(roommateId)),
    excludedRoommateNames: excludedRows.map((roommate) => roommate.name),
    shares
  } satisfies Expense;
}

export function listExpenses(): Expense[] {
  const expenseIds = db
    .prepare(
      `
      SELECT id
      FROM expenses
      ORDER BY created_at DESC, id DESC
    `
    )
    .all() as Array<{ id: number }>;

  return expenseIds
    .map((row) => getExpenseById(row.id))
    .filter((expense): expense is Expense => Boolean(expense));
}

export function createExpense(input: {
  title: string;
  amountCents: number;
  paidByRoommateId: number;
  note?: string | null;
  includedRoommateIds: number[];
}) {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Expense title is required.");
  }

  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Expense amount must be greater than zero.");
  }

  const shares = distributeExpenseShares(input.amountCents, input.includedRoommateIds);
  const result = db
    .prepare(
      `
      INSERT INTO expenses (
        title,
        amount_cents,
        currency,
        paid_by_roommate_id,
        note,
        created_at
      )
      VALUES (@title, @amountCents, 'EUR', @paidByRoommateId, @note, CURRENT_TIMESTAMP)
    `
    )
    .run({
      title,
      amountCents: input.amountCents,
      paidByRoommateId: input.paidByRoommateId,
      note: input.note ?? null
    });

  const expenseId = Number(result.lastInsertRowid);

  for (const share of shares) {
    db.prepare(
      `
      INSERT INTO expense_shares (expense_id, roommate_id, share_cents)
      VALUES (@expenseId, @roommateId, @shareCents)
    `
    ).run({
      expenseId,
      roommateId: share.roommateId,
      shareCents: share.shareCents
    });
  }

  const expense = getExpenseById(expenseId);
  if (!expense) {
    return null;
  }

  addEventLog({
    roommateId: input.paidByRoommateId,
    assignmentId: null,
    eventType: "EXPENSE_ADDED",
    payload: JSON.stringify({
      title: expense.title,
      amountCents: expense.amountCents,
      excludedRoommateIds: expense.excludedRoommateIds
    })
  });

  return expense;
}

export function listSettlements(): Settlement[] {
  return db
    .prepare(
      `
      SELECT
        settlements.id,
        settlements.from_roommate_id as fromRoommateId,
        sender.name as fromRoommateName,
        settlements.to_roommate_id as toRoommateId,
        receiver.name as toRoommateName,
        settlements.amount_cents as amountCents,
        settlements.currency,
        settlements.note,
        settlements.created_at as createdAt
      FROM settlements
      INNER JOIN roommates AS sender ON sender.id = settlements.from_roommate_id
      INNER JOIN roommates AS receiver ON receiver.id = settlements.to_roommate_id
      ORDER BY settlements.created_at DESC, settlements.id DESC
    `
    )
    .all() as Settlement[];
}

export function createSettlement(input: {
  fromRoommateId: number;
  toRoommateId: number;
  amountCents: number;
  note?: string | null;
}) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Settlement amount must be greater than zero.");
  }

  const result = db
    .prepare(
      `
      INSERT INTO settlements (
        from_roommate_id,
        to_roommate_id,
        amount_cents,
        currency,
        note,
        created_at
      )
      VALUES (@fromRoommateId, @toRoommateId, @amountCents, 'EUR', @note, CURRENT_TIMESTAMP)
    `
    )
    .run({
      fromRoommateId: input.fromRoommateId,
      toRoommateId: input.toRoommateId,
      amountCents: input.amountCents,
      note: input.note ?? null
    });

  const settlement = db
    .prepare(
      `
      SELECT
        settlements.id,
        settlements.from_roommate_id as fromRoommateId,
        sender.name as fromRoommateName,
        settlements.to_roommate_id as toRoommateId,
        receiver.name as toRoommateName,
        settlements.amount_cents as amountCents,
        settlements.currency,
        settlements.note,
        settlements.created_at as createdAt
      FROM settlements
      INNER JOIN roommates AS sender ON sender.id = settlements.from_roommate_id
      INNER JOIN roommates AS receiver ON receiver.id = settlements.to_roommate_id
      WHERE settlements.id = ?
    `
    )
    .get(Number(result.lastInsertRowid)) as Settlement | undefined;

  addEventLog({
    roommateId: input.fromRoommateId,
    assignmentId: null,
    eventType: "SETTLEMENT_ADDED",
    payload: JSON.stringify({
      toRoommateId: input.toRoommateId,
      amountCents: input.amountCents
    })
  });

  return settlement ?? null;
}

export function listBalances(): BalanceEntry[] {
  const netByRoommate = new Map<number, number>();
  const nameByRoommate = new Map<number, string>();

  for (const roommate of listRoommates()) {
    netByRoommate.set(roommate.id, 0);
    nameByRoommate.set(roommate.id, roommate.name);
  }

  for (const expense of listExpenses()) {
    netByRoommate.set(
      expense.paidByRoommateId,
      (netByRoommate.get(expense.paidByRoommateId) ?? 0) + expense.amountCents
    );

    for (const share of expense.shares) {
      netByRoommate.set(
        share.roommateId,
        (netByRoommate.get(share.roommateId) ?? 0) - share.shareCents
      );
    }
  }

  for (const settlement of listSettlements()) {
    netByRoommate.set(
      settlement.fromRoommateId,
      (netByRoommate.get(settlement.fromRoommateId) ?? 0) + settlement.amountCents
    );
    netByRoommate.set(
      settlement.toRoommateId,
      (netByRoommate.get(settlement.toRoommateId) ?? 0) - settlement.amountCents
    );
  }

  const creditors = Array.from(netByRoommate.entries())
    .filter(([, amount]) => amount > 0)
    .map(([roommateId, amount]) => ({ roommateId, amount }))
    .sort((left, right) => right.amount - left.amount);
  const debtors = Array.from(netByRoommate.entries())
    .filter(([, amount]) => amount < 0)
    .map(([roommateId, amount]) => ({ roommateId, amount: Math.abs(amount) }))
    .sort((left, right) => right.amount - left.amount);

  const balances: BalanceEntry[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountCents = Math.min(creditor.amount, debtor.amount);

    if (amountCents > 0) {
      balances.push({
        fromRoommateId: debtor.roommateId,
        fromRoommateName: nameByRoommate.get(debtor.roommateId) ?? "Roommate",
        toRoommateId: creditor.roommateId,
        toRoommateName: nameByRoommate.get(creditor.roommateId) ?? "Roommate",
        amountCents,
        currency: "EUR"
      });
    }

    creditor.amount -= amountCents;
    debtor.amount -= amountCents;

    if (creditor.amount === 0) {
      creditorIndex += 1;
    }

    if (debtor.amount === 0) {
      debtorIndex += 1;
    }
  }

  return balances;
}

export function addEventLog(params: {
  roommateId: number | null;
  assignmentId: number | null;
  eventType: string;
  payload: string | null;
}) {
  db.prepare(
    `
      INSERT INTO event_log (roommate_id, assignment_id, event_type, payload_json, created_at)
      VALUES (@roommateId, @assignmentId, @eventType, @payload, CURRENT_TIMESTAMP)
    `
  ).run(params);
}

export function listRecentEvents(limit = 10) {
  return db
    .prepare(
      `
      SELECT
        event_log.id,
        event_log.event_type as eventType,
        event_log.payload_json as payloadJson,
        event_log.created_at as createdAt,
        roommates.name as roommateName
      FROM event_log
      LEFT JOIN roommates ON roommates.id = event_log.roommate_id
      ORDER BY event_log.created_at DESC, event_log.id DESC
      LIMIT ?
    `
    )
    .all(limit) as EventLogEntry[];
}

export function hasConversationPromptBeenSent(
  assignmentId: number,
  promptType: string
) {
  const row = db
    .prepare(
      `
      SELECT id
      FROM event_log
      WHERE assignment_id = ?
        AND event_type = 'CONVERSATION_MESSAGE_SENT'
        AND payload_json LIKE ?
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(assignmentId, `%"promptType":"${promptType}"%`) as { id: number } | undefined;

  return Boolean(row);
}

export function getLatestConversationPromptForWhatsapp(whatsappNumber: string) {
  const row = db
    .prepare(
      `
      SELECT
        assignment_id as assignmentId,
        payload_json as payloadJson,
        created_at as createdAt
      FROM event_log
      WHERE event_type = 'CONVERSATION_MESSAGE_SENT'
        AND payload_json LIKE ?
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(`%"effectiveTo":"${whatsappNumber}"%`) as
    | {
        assignmentId: number | null;
        payloadJson: string | null;
        createdAt: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  let payload: Record<string, unknown> | null = null;
  if (row.payloadJson) {
    try {
      payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    } catch {
      payload = null;
    }
  }

  return {
    assignmentId: row.assignmentId,
    createdAt: row.createdAt,
    promptType:
      typeof payload?.promptType === "string" ? payload.promptType : null,
    effectiveTo:
      typeof payload?.effectiveTo === "string" ? payload.effectiveTo : null
  };
}

export function postponeAssignmentToTomorrow(
  assignmentId: number,
  reason: string | null
) {
  const assignment = getAssignmentById(assignmentId);
  if (!assignment || assignment.status !== "pending") {
    return null;
  }

  const tomorrow = new Date(`${assignment.dueDate}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueDate = tomorrow.toISOString().slice(0, 10);

  db.prepare(
    `
      UPDATE assignments
      SET
        due_date = @dueDate,
        status_note = @reason,
        escalation_level = 0,
        reminder_sent_at = NULL,
        penalty_applied_at = NULL,
        completed_at = NULL
      WHERE id = @assignmentId
    `
  ).run({
    assignmentId,
    dueDate,
    reason: reason ?? "pushed to tomorrow"
  });

  addEventLog({
    roommateId: assignment.roommateId,
    assignmentId,
    eventType: "ASSIGNMENT_POSTPONED",
    payload: JSON.stringify({ dueDate, reason })
  });

  return getAssignmentById(assignmentId);
}

export function getAssignmentsDueForReminder(now: Date): Assignment[] {
  return listAllPendingAssignments().filter((assignment) => {
    if (!assignment.roommateReminderEnabled || assignment.reminderSentAt) {
      return false;
    }

    const settings = getHouseSettings();
    if (!settings.autoRemindersEnabled) {
      return false;
    }

    const leadMinutes =
      assignment.roommateReminderLeadMinutes ||
      assignment.reminderLeadMinutes ||
      settings.defaultReminderLeadMinutes;
    const dueHour = assignment.roommateReminderHour || assignment.defaultDueHour;
    const dueAt = new Date(`${assignment.dueDate}T${String(dueHour).padStart(2, "0")}:00:00`);
    const reminderAt = new Date(dueAt.getTime() - leadMinutes * 60 * 1000);

    return now >= reminderAt;
  });
}

function startOfDay(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00`);
}

function dayDifference(now: Date, dueDate: string) {
  const today = startOfDay(now);
  const due = new Date(`${dueDate}T00:00:00`);
  return Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function reminderHourForAssignment(assignment: Assignment) {
  return assignment.roommateReminderHour || assignment.defaultDueHour || 18;
}

function hasReachedReminderTime(input: {
  now: Date;
  dueDate: string;
  hour: number;
  minute?: number;
}) {
  const reminderAt = new Date(
    `${input.dueDate}T${String(input.hour).padStart(2, "0")}:${String(
      input.minute ?? 0
    ).padStart(2, "0")}:00`
  );

  return input.now >= reminderAt;
}

export function getAssignmentsDueForWeeklyHeadsUp(now: Date): Assignment[] {
  const weekday = now.getDay();
  const isWeekStart = weekday === 1;

  if (!isWeekStart) {
    return [];
  }

  return listAllPendingAssignments().filter((assignment) => {
    if (!assignment.roommateReminderEnabled) {
      return false;
    }

    const settings = getHouseSettings();
    if (!settings.autoRemindersEnabled) {
      return false;
    }

    if (hasConversationPromptBeenSent(assignment.id, "weekly_heads_up")) {
      return false;
    }

    const diff = dayDifference(now, assignment.dueDate);
    return (
      diff >= 0 &&
      diff <= 6 &&
      hasReachedReminderTime({
        now,
        dueDate: now.toISOString().slice(0, 10),
        hour: reminderHourForAssignment(assignment)
      })
    );
  });
}

export function getAssignmentsDueForTwoDayReminder(now: Date): Assignment[] {
  return listAllPendingAssignments().filter((assignment) => {
    if (!assignment.roommateReminderEnabled) {
      return false;
    }

    const settings = getHouseSettings();
    if (!settings.autoRemindersEnabled) {
      return false;
    }

    if (hasConversationPromptBeenSent(assignment.id, "two_day_reminder")) {
      return false;
    }

    return (
      dayDifference(now, assignment.dueDate) === 2 &&
      hasReachedReminderTime({
        now,
        dueDate: now.toISOString().slice(0, 10),
        hour: reminderHourForAssignment(assignment)
      })
    );
  });
}

export function getAssignmentsDueForDayOfReminder(now: Date): Assignment[] {
  return listAllPendingAssignments().filter((assignment) => {
    if (!assignment.roommateReminderEnabled) {
      return false;
    }

    const settings = getHouseSettings();
    if (!settings.autoRemindersEnabled) {
      return false;
    }

    if (hasConversationPromptBeenSent(assignment.id, "day_of_reminder")) {
      return false;
    }

    if (dayDifference(now, assignment.dueDate) !== 0) {
      return false;
    }

    const leadMinutes =
      assignment.roommateReminderLeadMinutes ||
      assignment.reminderLeadMinutes ||
      settings.defaultReminderLeadMinutes;
    const dueHour = reminderHourForAssignment(assignment);
    const dueAt = new Date(`${assignment.dueDate}T${String(dueHour).padStart(2, "0")}:00:00`);
    const reminderAt = new Date(dueAt.getTime() - leadMinutes * 60 * 1000);

    return now >= reminderAt;
  });
}

export function getAssignmentsDueForCompletionCheck(now: Date): Assignment[] {
  return listAllPendingAssignments().filter((assignment) => {
    if (!assignment.roommateReminderEnabled) {
      return false;
    }

    const settings = getHouseSettings();
    if (!settings.autoRemindersEnabled || !assignment.reminderSentAt) {
      return false;
    }

    if (hasConversationPromptBeenSent(assignment.id, "completion_check")) {
      return false;
    }

    const dueHour = assignment.roommateReminderHour || assignment.defaultDueHour;
    const dueAt = new Date(`${assignment.dueDate}T${String(dueHour).padStart(2, "0")}:00:00`);

    return now >= dueAt;
  });
}

export function getAssignmentsDueForEscalationNudge(now: Date): Assignment[] {
  return listAllPendingAssignments().filter((assignment) => {
    if (!assignment.roommateReminderEnabled) {
      return false;
    }

    const settings = getHouseSettings();
    if (!settings.autoRemindersEnabled || !assignment.reminderSentAt) {
      return false;
    }

    if (!hasConversationPromptBeenSent(assignment.id, "completion_check")) {
      return false;
    }

    if (hasConversationPromptBeenSent(assignment.id, "escalation_nudge")) {
      return false;
    }

    const dueHour = assignment.roommateReminderHour || assignment.defaultDueHour;
    const dueAt = new Date(`${assignment.dueDate}T${String(dueHour).padStart(2, "0")}:00:00`);
    const escalationAt = new Date(dueAt.getTime() + 2 * 60 * 60 * 1000);

    return now >= escalationAt;
  });
}
