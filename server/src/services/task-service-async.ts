import type {
  AccountabilityState,
  AdvanceRotationOn,
  Assignment,
  BalanceEntry,
  Chore,
  EventLogEntry,
  Expense,
  ExpenseShare,
  FrequencyUnit,
  HouseSettings,
  Penalty,
  PenaltyRule,
  PenaltyStatus,
  PenaltyTrigger,
  Roommate,
  RoommateSummary,
  Settlement
  ,
  TaskMode
} from "../lib/types.js";
import type { PoolClient } from "pg";
import { queryRow, queryRows, withPoolClient, withTransaction } from "../db/pool.js";

const assignmentBaseQuery = `
  SELECT
    assignments.id,
    assignments.chore_id AS "choreId",
    assignments.roommate_id AS "roommateId",
    assignments.due_date AS "dueDate",
    assignments.window_start_date AS "windowStartDate",
    assignments.window_end_date AS "windowEndDate",
    assignments.status AS "status",
    assignments.status_note AS "statusNote",
    assignments.resolution_type AS "resolutionType",
    assignments.responsible_roommate_id AS "responsibleRoommateId",
    assignments.rescued_by_roommate_id AS "rescuedByRoommateId",
    assignments.escalation_level AS "escalationLevel",
    assignments.strike_applied AS "strikeApplied",
    assignments.rescue_credit_applied AS "rescueCreditApplied",
    assignments.created_at AS "createdAt",
    assignments.completed_at AS "completedAt",
    assignments.reminder_sent_at AS "reminderSentAt",
    assignments.penalty_applied_at AS "penaltyAppliedAt",
    chores.title AS "choreTitle",
    chores.description AS "choreDescription",
    chores.cadence AS "cadence",
    chores.area AS "area",
    chores.points AS "points",
    chores.frequency_interval AS "frequencyInterval",
    chores.frequency_unit AS "frequencyUnit",
    chores.task_mode AS "taskMode",
    chores.soft_reminder_after_hours AS "softReminderAfterHours",
    chores.repeat_reminder_every_hours AS "repeatReminderEveryHours",
    chores.escalate_after_hours AS "escalateAfterHours",
    chores.advance_rotation_on AS "advanceRotationOn",
    chores.is_optional AS "isOptional",
    chores.parent_chore_id AS "parentChoreId",
    chores.default_due_hour AS "defaultDueHour",
    chores.reminder_lead_minutes AS "reminderLeadMinutes",
    chores.penalty_rule_id AS "penaltyRuleId",
    penalty_rules.title AS "penaltyRuleTitle",
    parent_chore.title AS "parentChoreTitle",
    roommates.name AS "roommateName",
    responsible_roommates.name AS "responsibleRoommateName",
    rescued_by_roommates.name AS "rescuedByRoommateName",
    roommates.whatsapp_number AS "whatsappNumber",
    roommates.reminder_enabled AS "roommateReminderEnabled",
    roommates.reminder_hour AS "roommateReminderHour",
    roommates.reminder_lead_minutes AS "roommateReminderLeadMinutes"
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

function toCount(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number(value);
  }

  return 0;
}

function nowIso() {
  return new Date().toISOString();
}

function addDaysToIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDiffIso(leftIsoDate: string, rightIsoDate: string) {
  const left = new Date(`${leftIsoDate}T00:00:00Z`);
  const right = new Date(`${rightIsoDate}T00:00:00Z`);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
    return null;
  }

  return Math.round((right.getTime() - left.getTime()) / 86400000);
}

function isoDateInTimezone(value: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return value.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

function weekdayInTimezone(value: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short"
  });

  return formatter.format(value);
}

function timePartsInTimezone(value: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = formatter.formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0
  };
}

function weekdayIndexFromShortLabel(label: string) {
  const normalized = label.slice(0, 3).toLowerCase();
  const lookup: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };
  return lookup[normalized] ?? 0;
}

function getMondayWeekRangeInTimezone(now: Date, timezone: string) {
  const todayIso = isoDateInTimezone(now, timezone);
  const weekdayIndex = weekdayIndexFromShortLabel(weekdayInTimezone(now, timezone));
  const daysSinceMonday = (weekdayIndex + 6) % 7;
  const start = addDaysToIsoDate(todayIso, -daysSinceMonday);
  return {
    start,
    end: addDaysToIsoDate(start, 6)
  };
}

function isIsoDateWithinRange(value: string, start: string, end: string) {
  const day = dayDiffIso(start, value);
  const toEnd = dayDiffIso(value, end);
  if (day === null || toEnd === null) {
    return false;
  }

  return day >= 0 && toEnd >= 0;
}

function dayDifferenceInTimezone(now: Date, dueDate: string, timezone: string) {
  const todayIso = isoDateInTimezone(now, timezone);
  return dayDiffIso(todayIso, dueDate);
}

function hasReachedLocalMinuteOfDay(input: {
  now: Date;
  timezone: string;
  targetDate: string;
  minuteOfDay: number;
}) {
  const dayOffset = Math.floor(input.minuteOfDay / (24 * 60));
  const normalizedMinute = ((input.minuteOfDay % (24 * 60)) + 24 * 60) % (24 * 60);
  const effectiveTargetDate = addDaysToIsoDate(input.targetDate, dayOffset);
  const nowIso = isoDateInTimezone(input.now, input.timezone);
  if (dayDiffIso(nowIso, effectiveTargetDate) === null) {
    return false;
  }

  if (nowIso > effectiveTargetDate) {
    return true;
  }

  if (nowIso < effectiveTargetDate) {
    return false;
  }

  const parts = timePartsInTimezone(input.now, input.timezone);
  const currentMinuteOfDay = parts.hour * 60 + parts.minute;
  return currentMinuteOfDay >= normalizedMinute;
}

function getSundayWeekEndForIsoDate(value: string) {
  const base = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return value;
  }

  const weekday = base.getUTCDay();
  const daysToSunday = (7 - weekday) % 7;
  return addDaysToIsoDate(value, daysToSunday);
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

function deriveCadenceLabel(interval: number, unit: FrequencyUnit) {
  if (interval === 1) {
    return `Every ${unit}`;
  }

  return `Every ${interval} ${unit}s`;
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

function withAccountabilityState(assignment: Assignment): Assignment {
  return {
    ...assignment,
    accountabilityState: deriveAccountabilityState(assignment)
  };
}

export async function getHouseSettingsAsync(): Promise<HouseSettings> {
  const row = await queryRow<HouseSettings>(
    `
      SELECT
        id,
        house_name AS "houseName",
        timezone,
        auto_reminders_enabled AS "autoRemindersEnabled",
        weekly_summary_enabled AS "weeklySummaryEnabled",
        summary_day AS "summaryDay",
        summary_hour AS "summaryHour",
        default_penalty_amount_cents AS "defaultPenaltyAmountCents",
        default_reminder_lead_minutes AS "defaultReminderLeadMinutes",
        penalty_label AS "penaltyLabel",
        weekly_achievement_label AS "weeklyAchievementLabel",
        monthly_achievement_label AS "monthlyAchievementLabel",
        updated_at AS "updatedAt"
      FROM house_settings
      WHERE id = 1
    `
  );

  if (!row) {
    throw new Error("House settings row is missing.");
  }

  return row;
}

export async function findRoommateByCredentialsAsync(
  name: string,
  loginPassword: string
): Promise<Roommate | null> {
  return await queryRow<Roommate>(
    `
      SELECT
        id,
        name,
        whatsapp_number AS "whatsappNumber",
        is_active AS "isActive",
        sort_order AS "sortOrder",
        reminder_enabled AS "reminderEnabled",
        reminder_hour AS "reminderHour",
        reminder_lead_minutes AS "reminderLeadMinutes",
        notes,
        penalty_balance_cents AS "penaltyBalanceCents",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM roommates
      WHERE LOWER(name) = LOWER($1)
        AND login_password = $2
      LIMIT 1
    `,
    [name, loginPassword]
  );
}

export async function listRoommatesAsync(): Promise<RoommateSummary[]> {
  const rows = await queryRows<
    RoommateSummary & {
      pendingCount: number | string;
      completedCount: number | string;
      skippedCount: number | string;
      openPenaltyCount: number | string;
    }
  >(
    `
      SELECT
        roommates.id,
        roommates.name,
        roommates.whatsapp_number AS "whatsappNumber",
        roommates.is_active AS "isActive",
        roommates.sort_order AS "sortOrder",
        roommates.reminder_enabled AS "reminderEnabled",
        roommates.reminder_hour AS "reminderHour",
        roommates.reminder_lead_minutes AS "reminderLeadMinutes",
        roommates.notes AS notes,
        roommates.penalty_balance_cents AS "penaltyBalanceCents",
        roommates.created_at AS "createdAt",
        roommates.updated_at AS "updatedAt",
        COUNT(DISTINCT CASE WHEN assignments.status = 'pending' THEN assignments.id END) AS "pendingCount",
        COUNT(DISTINCT CASE WHEN assignments.status = 'done' THEN assignments.id END) AS "completedCount",
        COUNT(
          DISTINCT CASE
            WHEN assignments.status = 'skipped' AND COALESCE(assignments.strike_applied, 0) > 0
              THEN assignments.id
          END
        ) AS "skippedCount",
        COUNT(DISTINCT CASE WHEN penalties.status = 'open' THEN penalties.id END) AS "openPenaltyCount"
      FROM roommates
      LEFT JOIN assignments ON assignments.roommate_id = roommates.id
      LEFT JOIN penalties ON penalties.roommate_id = roommates.id
      GROUP BY roommates.id
      ORDER BY roommates.sort_order ASC, roommates.name ASC
    `
  );

  return rows.map(
    (
      row: RoommateSummary & {
        pendingCount: number | string;
        completedCount: number | string;
        skippedCount: number | string;
        openPenaltyCount: number | string;
      }
    ) => ({
      ...row,
      pendingCount: toCount(row.pendingCount),
      completedCount: toCount(row.completedCount),
      skippedCount: toCount(row.skippedCount),
      openPenaltyCount: toCount(row.openPenaltyCount)
    })
  );
}

export async function listPenaltyRulesAsync(): Promise<PenaltyRule[]> {
  return await queryRows<PenaltyRule>(
    `
      SELECT
        id,
        title,
        description,
        trigger_type AS "triggerType",
        amount_cents AS "amountCents",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM penalty_rules
      ORDER BY is_active DESC, amount_cents DESC, id ASC
    `
  );
}

export async function listChoresAsync(): Promise<Chore[]> {
  return await queryRows<Chore>(
    `
      SELECT
        chores.id,
        chores.title,
        chores.description,
        chores.cadence,
        chores.area,
        chores.points,
        chores.frequency_interval AS "frequencyInterval",
        chores.frequency_unit AS "frequencyUnit",
        chores.task_mode AS "taskMode",
        chores.soft_reminder_after_hours AS "softReminderAfterHours",
        chores.repeat_reminder_every_hours AS "repeatReminderEveryHours",
        chores.escalate_after_hours AS "escalateAfterHours",
        chores.advance_rotation_on AS "advanceRotationOn",
        chores.is_optional AS "isOptional",
        chores.parent_chore_id AS "parentChoreId",
        chores.default_due_hour AS "defaultDueHour",
        chores.default_assignee_id AS "defaultAssigneeId",
        chores.is_active AS "isActive",
        chores.reminder_lead_minutes AS "reminderLeadMinutes",
        chores.penalty_rule_id AS "penaltyRuleId",
        chores.created_at AS "createdAt",
        chores.updated_at AS "updatedAt",
        roommates.name AS "defaultAssigneeName",
        penalty_rules.title AS "penaltyRuleTitle",
        parent_chore.title AS "parentChoreTitle"
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
  );
}

export async function listAssignmentsAsync(): Promise<Assignment[]> {
  const rows = await queryRows<Assignment>(
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
  );

  return rows.map((assignment: Assignment) => withAccountabilityState(assignment));
}

export async function listPenaltiesAsync(): Promise<Penalty[]> {
  return await queryRows<Penalty>(
    `
      SELECT
        penalties.id,
        penalties.roommate_id AS "roommateId",
        penalties.assignment_id AS "assignmentId",
        penalties.rule_id AS "ruleId",
        penalties.reason,
        penalties.amount_cents AS "amountCents",
        penalties.status,
        penalties.created_at AS "createdAt",
        penalties.settled_at AS "settledAt",
        roommates.name AS "roommateName",
        penalty_rules.title AS "ruleTitle"
      FROM penalties
      INNER JOIN roommates ON roommates.id = penalties.roommate_id
      LEFT JOIN penalty_rules ON penalty_rules.id = penalties.rule_id
      ORDER BY penalties.status = 'open' DESC, penalties.created_at DESC, penalties.id DESC
    `
  );
}

export async function listExpensesAsync(): Promise<Expense[]> {
  const [expenses, shares, activeRoommates] = await Promise.all([
    queryRows<
      Omit<Expense, "shares" | "excludedRoommateIds" | "excludedRoommateNames"> & {
        currency: "EUR";
      }
    >(
      `
        SELECT
          expenses.id,
          expenses.title,
          expenses.amount_cents AS "amountCents",
          expenses.currency,
          expenses.paid_by_roommate_id AS "paidByRoommateId",
          payer.name AS "paidByRoommateName",
          expenses.note,
          expenses.created_at AS "createdAt"
        FROM expenses
        INNER JOIN roommates AS payer ON payer.id = expenses.paid_by_roommate_id
        ORDER BY expenses.created_at DESC, expenses.id DESC
      `
    ),
    queryRows<ExpenseShare>(
      `
        SELECT
          expense_shares.expense_id AS "expenseId",
          expense_shares.roommate_id AS "roommateId",
          roommates.name AS "roommateName",
          expense_shares.share_cents AS "shareCents"
        FROM expense_shares
        INNER JOIN roommates ON roommates.id = expense_shares.roommate_id
        ORDER BY expense_shares.expense_id DESC, roommates.sort_order, roommates.id
      `
    ),
    queryRows<{ id: number; name: string }>(
      `
        SELECT id, name
        FROM roommates
        WHERE is_active = 1
        ORDER BY sort_order, id
      `
    )
  ]);

  const sharesByExpenseId = new Map<number, ExpenseShare[]>();
  for (const share of shares) {
    const bucket = sharesByExpenseId.get(share.expenseId) ?? [];
    bucket.push(share);
    sharesByExpenseId.set(share.expenseId, bucket);
  }

  return expenses.map((expense: Omit<Expense, "shares" | "excludedRoommateIds" | "excludedRoommateNames"> & { currency: "EUR" }) => {
    const expenseShares = sharesByExpenseId.get(expense.id) ?? [];
    const includedIds = new Set(expenseShares.map((share) => share.roommateId));
    const excludedRoommates = activeRoommates.filter((roommate: { id: number; name: string }) => !includedIds.has(roommate.id));

    return {
      ...expense,
      shares: expenseShares,
      excludedRoommateIds: excludedRoommates.map((roommate: { id: number; name: string }) => roommate.id),
      excludedRoommateNames: excludedRoommates.map((roommate: { id: number; name: string }) => roommate.name)
    };
  });
}

export async function listSettlementsAsync(): Promise<Settlement[]> {
  return await queryRows<Settlement>(
    `
      SELECT
        settlements.id,
        settlements.from_roommate_id AS "fromRoommateId",
        sender.name AS "fromRoommateName",
        settlements.to_roommate_id AS "toRoommateId",
        receiver.name AS "toRoommateName",
        settlements.amount_cents AS "amountCents",
        settlements.currency,
        settlements.note,
        settlements.created_at AS "createdAt"
      FROM settlements
      INNER JOIN roommates AS sender ON sender.id = settlements.from_roommate_id
      INNER JOIN roommates AS receiver ON receiver.id = settlements.to_roommate_id
      ORDER BY settlements.created_at DESC, settlements.id DESC
    `
  );
}

export async function listBalancesAsync(): Promise<BalanceEntry[]> {
  const [roommates, expenses, settlements] = await Promise.all([
    listRoommatesAsync(),
    listExpensesAsync(),
    listSettlementsAsync()
  ]);

  const netByRoommate = new Map<number, number>();
  const nameByRoommate = new Map<number, string>();

  for (const roommate of roommates) {
    netByRoommate.set(roommate.id, 0);
    nameByRoommate.set(roommate.id, roommate.name);
  }

  for (const expense of expenses) {
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

  for (const settlement of settlements) {
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

export async function listRecentEventsAsync(limit = 10): Promise<EventLogEntry[]> {
  return await queryRows<EventLogEntry>(
    `
      SELECT
        event_log.id,
        event_log.assignment_id AS "assignmentId",
        event_log.event_type AS "eventType",
        event_log.payload_json AS "payloadJson",
        event_log.created_at AS "createdAt",
        roommates.name AS "roommateName"
      FROM event_log
      LEFT JOIN roommates ON roommates.id = event_log.roommate_id
      ORDER BY event_log.created_at DESC, event_log.id DESC
      LIMIT $1
    `,
    [limit]
  );
}

async function getRoommateByIdWithClient(client: PoolClient, id: number) {
  const result = await client.query<Roommate>(
    `
      SELECT
        id,
        name,
        whatsapp_number AS "whatsappNumber",
        is_active AS "isActive",
        sort_order AS "sortOrder",
        reminder_enabled AS "reminderEnabled",
        reminder_hour AS "reminderHour",
        reminder_lead_minutes AS "reminderLeadMinutes",
        notes,
        penalty_balance_cents AS "penaltyBalanceCents",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM roommates
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

async function getAssignmentByIdWithClient(client: PoolClient, assignmentId: number) {
  const result = await client.query<Assignment>(
    `
      ${assignmentBaseQuery}
      WHERE assignments.id = $1
      LIMIT 1
    `,
    [assignmentId]
  );

  const assignment = result.rows[0] ?? null;
  return assignment ? withAccountabilityState(assignment) : null;
}

async function listActiveRoommatesWithClient(client: PoolClient) {
  const result = await client.query<Roommate>(
    `
      SELECT
        id,
        name,
        whatsapp_number AS "whatsappNumber",
        is_active AS "isActive",
        sort_order AS "sortOrder",
        reminder_enabled AS "reminderEnabled",
        reminder_hour AS "reminderHour",
        reminder_lead_minutes AS "reminderLeadMinutes",
        notes,
        penalty_balance_cents AS "penaltyBalanceCents",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM roommates
      WHERE is_active = 1
      ORDER BY sort_order ASC, name ASC
    `
  );

  return result.rows;
}

async function getChoreByIdWithClient(client: PoolClient, id: number) {
  const result = await client.query<Chore>(
    `
      SELECT
        chores.id,
        chores.title,
        chores.description,
        chores.cadence,
        chores.area,
        chores.points,
        chores.frequency_interval AS "frequencyInterval",
        chores.frequency_unit AS "frequencyUnit",
        chores.task_mode AS "taskMode",
        chores.soft_reminder_after_hours AS "softReminderAfterHours",
        chores.repeat_reminder_every_hours AS "repeatReminderEveryHours",
        chores.escalate_after_hours AS "escalateAfterHours",
        chores.advance_rotation_on AS "advanceRotationOn",
        chores.is_optional AS "isOptional",
        chores.parent_chore_id AS "parentChoreId",
        chores.default_due_hour AS "defaultDueHour",
        chores.default_assignee_id AS "defaultAssigneeId",
        chores.is_active AS "isActive",
        chores.reminder_lead_minutes AS "reminderLeadMinutes",
        chores.penalty_rule_id AS "penaltyRuleId",
        chores.created_at AS "createdAt",
        chores.updated_at AS "updatedAt",
        roommates.name AS "defaultAssigneeName",
        penalty_rules.title AS "penaltyRuleTitle",
        parent_chore.title AS "parentChoreTitle"
      FROM chores
      LEFT JOIN roommates ON roommates.id = chores.default_assignee_id
      LEFT JOIN penalty_rules ON penalty_rules.id = chores.penalty_rule_id
      LEFT JOIN chores AS parent_chore ON parent_chore.id = chores.parent_chore_id
      WHERE chores.id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

async function getPenaltyRuleByIdWithClient(client: PoolClient, id: number) {
  const result = await client.query<PenaltyRule>(
    `
      SELECT
        id,
        title,
        description,
        trigger_type AS "triggerType",
        amount_cents AS "amountCents",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM penalty_rules
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

async function getPenaltyByIdWithClient(client: PoolClient, id: number) {
  const result = await client.query<Penalty>(
    `
      SELECT
        penalties.id,
        penalties.roommate_id AS "roommateId",
        penalties.assignment_id AS "assignmentId",
        penalties.rule_id AS "ruleId",
        penalties.reason,
        penalties.amount_cents AS "amountCents",
        penalties.status,
        penalties.created_at AS "createdAt",
        penalties.settled_at AS "settledAt",
        roommates.name AS "roommateName",
        penalty_rules.title AS "ruleTitle"
      FROM penalties
      INNER JOIN roommates ON roommates.id = penalties.roommate_id
      LEFT JOIN penalty_rules ON penalty_rules.id = penalties.rule_id
      WHERE penalties.id = $1
      LIMIT 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

async function recalculatePenaltyBalanceWithClient(client: PoolClient, roommateId: number) {
  const result = await client.query<{ amount: number | string }>(
    `
      SELECT COALESCE(SUM(amount_cents), 0) AS amount
      FROM penalties
      WHERE roommate_id = $1
        AND status = 'open'
    `,
    [roommateId]
  );

  const amount = toCount(result.rows[0]?.amount ?? 0);

  await client.query(
    `
      UPDATE roommates
      SET penalty_balance_cents = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [roommateId, amount]
  );
}

async function getExistingPenaltyForAssignmentWithClient(client: PoolClient, assignmentId: number) {
  const result = await client.query<{ id: number }>(
    `
      SELECT id
      FROM penalties
      WHERE assignment_id = $1
        AND status = 'open'
      LIMIT 1
    `,
    [assignmentId]
  );

  return result.rows[0] ?? null;
}

async function addEventLogWithClient(
  client: PoolClient,
  params: { roommateId: number | null; assignmentId: number | null; eventType: string; payload: string | null }
) {
  await client.query(
    `
      INSERT INTO event_log (roommate_id, assignment_id, event_type, payload_json, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    `,
    [params.roommateId, params.assignmentId, params.eventType, params.payload]
  );
}

async function setChoreDefaultAssigneeWithClient(client: PoolClient, choreId: number, roommateId: number) {
  await client.query(
    `
      UPDATE chores
      SET default_assignee_id = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [choreId, roommateId]
  );
}

async function listStandbyRoommatesForFixedAssignmentWithClient(client: PoolClient, assignment: Assignment) {
  const result = await client.query<Roommate>(
    `
      SELECT
        roommates.id,
        roommates.name,
        roommates.whatsapp_number AS "whatsappNumber",
        roommates.is_active AS "isActive",
        roommates.sort_order AS "sortOrder",
        roommates.reminder_enabled AS "reminderEnabled",
        roommates.reminder_hour AS "reminderHour",
        roommates.reminder_lead_minutes AS "reminderLeadMinutes",
        roommates.notes,
        roommates.penalty_balance_cents AS "penaltyBalanceCents",
        roommates.created_at AS "createdAt",
        roommates.updated_at AS "updatedAt"
      FROM roommates
      WHERE roommates.is_active = 1
        AND roommates.id <> $1
        AND NOT EXISTS (
          SELECT 1
          FROM assignments
          INNER JOIN chores ON chores.id = assignments.chore_id
          WHERE assignments.roommate_id = roommates.id
            AND assignments.due_date = $2
            AND chores.task_mode = 'fixed_schedule'
        )
      ORDER BY roommates.sort_order ASC, roommates.name ASC
    `,
    [assignment.roommateId, assignment.dueDate]
  );

  return result.rows;
}

async function findStandbyRoommateForFixedAssignmentWithClient(client: PoolClient, assignment: Assignment) {
  const roommates = await listStandbyRoommatesForFixedAssignmentWithClient(client, assignment);
  return roommates[0] ?? null;
}

async function markNextFixedAssignmentPriorityWithClient(client: PoolClient, assignment: Assignment) {
  const nextResult = await client.query<{ id: number }>(
    `
      SELECT id
      FROM assignments
      WHERE chore_id = $1
        AND due_date > $2
        AND status = 'pending'
      ORDER BY due_date ASC, id ASC
      LIMIT 1
    `,
    [assignment.choreId, assignment.dueDate]
  );

  const nextAssignmentId = nextResult.rows[0]?.id;
  if (!nextAssignmentId) {
    return;
  }

  const existing = await getAssignmentByIdWithClient(client, nextAssignmentId);
  const carryOverNote = `carry over priority from ${assignment.roommateName}`;
  const mergedNote = existing?.statusNote ? `${existing.statusNote}; ${carryOverNote}` : carryOverNote;

  await client.query(
    `
      UPDATE assignments
      SET status_note = $2
      WHERE id = $1
    `,
    [nextAssignmentId, mergedNote]
  );

  await addEventLogWithClient(client, {
    roommateId: existing?.roommateId ?? null,
    assignmentId: nextAssignmentId,
    eventType: "CARRY_OVER_PRIORITY_SET",
    payload: JSON.stringify({
      sourceAssignmentId: assignment.id,
      choreId: assignment.choreId,
      missedByRoommateId: assignment.roommateId,
      missedByRoommateName: assignment.roommateName
    })
  });
}

async function getNextRoommateInRotationWithClient(client: PoolClient, roommateId: number) {
  const rotationRoommates = await listActiveRoommatesWithClient(client);
  if (rotationRoommates.length === 0) {
    return null;
  }

  const currentIndex = rotationRoommates.findIndex((roommate) => roommate.id === roommateId);
  return currentIndex === -1
    ? rotationRoommates[0] ?? null
    : rotationRoommates[(currentIndex + 1) % rotationRoommates.length] ?? null;
}

async function advanceChoreRotationWithClient(client: PoolClient, assignment: Assignment) {
  if (assignment.status !== "done" && assignment.status !== "skipped") {
    return;
  }

  const chore = await getChoreByIdWithClient(client, assignment.choreId);
  if (!chore || chore.taskMode === "fixed_schedule") {
    return;
  }

  if (
    chore.taskMode === "rolling_until_done" &&
    (assignment.status === "skipped" ||
      (assignment.resolutionType === "rescued" &&
        chore.advanceRotationOn === "rescue_keeps_owner"))
  ) {
    await setChoreDefaultAssigneeWithClient(client, assignment.choreId, assignment.responsibleRoommateId);
    await addEventLogWithClient(client, {
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

  const nextRoommate = await getNextRoommateInRotationWithClient(client, assignment.responsibleRoommateId);
  if (!nextRoommate) {
    return;
  }

  await setChoreDefaultAssigneeWithClient(client, assignment.choreId, nextRoommate.id);
  await addEventLogWithClient(client, {
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

async function maybeCreatePenaltyForAssignmentWithClient(
  client: PoolClient,
  assignment: Assignment,
  reason: string | null
) {
  if (
    assignment.status !== "skipped" ||
    assignment.penaltyRuleId === null ||
    assignment.strikeApplied <= 0
  ) {
    return;
  }

  if (await getExistingPenaltyForAssignmentWithClient(client, assignment.id)) {
    return;
  }

  const rule = await getPenaltyRuleByIdWithClient(client, assignment.penaltyRuleId);
  if (!rule || !rule.isActive) {
    return;
  }

  await client.query(
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
      VALUES ($1, $2, $3, $4, $5, 'open', CURRENT_TIMESTAMP)
    `,
    [assignment.roommateId, assignment.id, rule.id, reason ?? `Penalty triggered for ${assignment.choreTitle}`, rule.amountCents]
  );

  await client.query(
    `
      UPDATE assignments
      SET penalty_applied_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [assignment.id]
  );

  await addEventLogWithClient(client, {
    roommateId: assignment.roommateId,
    assignmentId: assignment.id,
    eventType: "PENALTY_CREATED",
    payload: JSON.stringify({ ruleId: rule.id, amountCents: rule.amountCents })
  });

  await recalculatePenaltyBalanceWithClient(client, assignment.roommateId);
}

function deriveAssignmentResolutionType(
  status: Assignment["status"],
  resolutionType?: Assignment["resolutionType"] | null
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

function distributeExpenseShares(amountCents: number, roommateIds: number[]) {
  const uniqueRoommateIds = [...new Set(roommateIds)].sort((left, right) => left - right);
  const baseShare = Math.floor(amountCents / uniqueRoommateIds.length);
  let remainder = amountCents - baseShare * uniqueRoommateIds.length;

  return uniqueRoommateIds.map((roommateId) => {
    const shareCents = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }

    return { roommateId, shareCents };
  });
}

export async function findRoommateByWhatsappNumberAsync(whatsappNumber: string) {
  return await queryRow<Roommate>(
    `
      SELECT
        id,
        name,
        whatsapp_number AS "whatsappNumber",
        is_active AS "isActive",
        sort_order AS "sortOrder",
        reminder_enabled AS "reminderEnabled",
        reminder_hour AS "reminderHour",
        reminder_lead_minutes AS "reminderLeadMinutes",
        notes,
        penalty_balance_cents AS "penaltyBalanceCents",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM roommates
      WHERE whatsapp_number = $1
      LIMIT 1
    `,
    [whatsappNumber]
  );
}

export async function getRoommateByIdAsync(id: number) {
  return await queryRow<Roommate>(
    `
      SELECT
        id,
        name,
        whatsapp_number AS "whatsappNumber",
        is_active AS "isActive",
        sort_order AS "sortOrder",
        reminder_enabled AS "reminderEnabled",
        reminder_hour AS "reminderHour",
        reminder_lead_minutes AS "reminderLeadMinutes",
        notes,
        penalty_balance_cents AS "penaltyBalanceCents",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM roommates
      WHERE id = $1
      LIMIT 1
    `,
    [id]
  );
}

export async function getRoommateLoginPasswordAsync(roommateId: number) {
  const row = await queryRow<{ loginPassword: string }>(
    `
      SELECT login_password AS "loginPassword"
      FROM roommates
      WHERE id = $1
      LIMIT 1
    `,
    [roommateId]
  );

  return row?.loginPassword ?? null;
}

export async function createRoommateAsync(input: {
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
  return await withTransaction(async (client) => {
    const sortOrderRow = await client.query<{ maxSortOrder: number | string }>(
      `SELECT COALESCE(MAX(sort_order), 0) AS "maxSortOrder" FROM roommates`
    );
    const nextSortOrder = toCount(sortOrderRow.rows[0]?.maxSortOrder ?? 0) + 1;
    const result = await client.query<{ id: number }>(
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [
        input.name,
        input.whatsappNumber,
        input.loginPassword ?? `${input.name.toLowerCase()}123`,
        input.isActive ?? 1,
        input.sortOrder ?? nextSortOrder,
        input.reminderEnabled ?? 1,
        input.reminderHour ?? 18,
        input.reminderLeadMinutes ?? 120,
        input.notes ?? null
      ]
    );

    return await getRoommateByIdWithClient(client, result.rows[0].id);
  });
}

export async function updateRoommateAsync(
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
  return await withTransaction(async (client) => {
    const updates: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (input.name !== undefined) push("name", input.name);
    if (input.whatsappNumber !== undefined) push("whatsapp_number", input.whatsappNumber);
    if (input.loginPassword !== undefined) push("login_password", input.loginPassword);
    if (input.isActive !== undefined) push("is_active", input.isActive);
    if (input.sortOrder !== undefined) push("sort_order", input.sortOrder);
    if (input.reminderEnabled !== undefined) push("reminder_enabled", input.reminderEnabled);
    if (input.reminderHour !== undefined) push("reminder_hour", input.reminderHour);
    if (input.reminderLeadMinutes !== undefined) push("reminder_lead_minutes", input.reminderLeadMinutes);
    if (input.notes !== undefined) push("notes", input.notes);
    push("updated_at", nowIso());
    values.push(id);

    await client.query(`UPDATE roommates SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
    return await getRoommateByIdWithClient(client, id);
  });
}

export async function updateHouseSettingsAsync(input: Partial<HouseSettings>) {
  return await withTransaction(async (client) => {
    const updates: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (input.houseName !== undefined) push("house_name", input.houseName);
    if (input.timezone !== undefined) push("timezone", input.timezone);
    if (input.autoRemindersEnabled !== undefined) push("auto_reminders_enabled", input.autoRemindersEnabled);
    if (input.weeklySummaryEnabled !== undefined) push("weekly_summary_enabled", input.weeklySummaryEnabled);
    if (input.summaryDay !== undefined) push("summary_day", input.summaryDay);
    if (input.summaryHour !== undefined) push("summary_hour", input.summaryHour);
    if (input.defaultPenaltyAmountCents !== undefined) {
      push("default_penalty_amount_cents", input.defaultPenaltyAmountCents);
    }
    if (input.defaultReminderLeadMinutes !== undefined) {
      push("default_reminder_lead_minutes", input.defaultReminderLeadMinutes);
    }
    if (input.penaltyLabel !== undefined) push("penalty_label", input.penaltyLabel);
    if (input.weeklyAchievementLabel !== undefined) push("weekly_achievement_label", input.weeklyAchievementLabel);
    if (input.monthlyAchievementLabel !== undefined) {
      push("monthly_achievement_label", input.monthlyAchievementLabel);
    }
    push("updated_at", nowIso());

    await client.query(`UPDATE house_settings SET ${updates.join(", ")} WHERE id = 1`, values);
    return await getHouseSettingsAsync();
  });
}

export async function createPenaltyRuleAsync(input: {
  title: string;
  description?: string | null;
  triggerType?: PenaltyTrigger;
  amountCents: number;
  isActive?: number;
}) {
  return await withTransaction(async (client) => {
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO penalty_rules (
          title, description, trigger_type, amount_cents, is_active, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [input.title, input.description ?? null, input.triggerType ?? "manual", input.amountCents, input.isActive ?? 1]
    );

    return await getPenaltyRuleByIdWithClient(client, result.rows[0].id);
  });
}

export async function updatePenaltyRuleAsync(
  id: number,
  input: {
    title?: string;
    description?: string | null;
    triggerType?: PenaltyTrigger;
    amountCents?: number;
    isActive?: number;
  }
) {
  return await withTransaction(async (client) => {
    const updates: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (input.title !== undefined) push("title", input.title);
    if (input.description !== undefined) push("description", input.description);
    if (input.triggerType !== undefined) push("trigger_type", input.triggerType);
    if (input.amountCents !== undefined) push("amount_cents", input.amountCents);
    if (input.isActive !== undefined) push("is_active", input.isActive);
    push("updated_at", nowIso());
    values.push(id);

    await client.query(
      `UPDATE penalty_rules SET ${updates.join(", ")} WHERE id = $${values.length}`,
      values
    );
    return await getPenaltyRuleByIdWithClient(client, id);
  });
}

export async function createChoreAsync(input: {
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
  return await withTransaction(async (client) => {
    const frequencyInterval = input.frequencyInterval ?? 1;
    const frequencyUnit = normalizeFrequencyUnit(input.frequencyUnit);
    const taskMode = normalizeTaskMode(input.taskMode);
    const softReminderAfterHours = Math.max(1, input.softReminderAfterHours ?? 24);
    const repeatReminderEveryHours = Math.max(1, input.repeatReminderEveryHours ?? 24);
    const escalateAfterHours = Math.max(softReminderAfterHours, input.escalateAfterHours ?? 48);
    const advanceRotationOn =
      taskMode === "rolling_until_done"
        ? normalizeAdvanceRotationOn(input.advanceRotationOn ?? "rescue_keeps_owner")
        : normalizeAdvanceRotationOn(input.advanceRotationOn ?? "completed_only");
    const cadence = input.cadence || deriveCadenceLabel(frequencyInterval, frequencyUnit);

    const result = await client.query<{ id: number }>(
      `
        INSERT INTO chores (
          title, description, cadence, area, points, frequency_interval, frequency_unit, task_mode,
          soft_reminder_after_hours, repeat_reminder_every_hours, escalate_after_hours,
          advance_rotation_on, is_optional, parent_chore_id, default_due_hour, default_assignee_id,
          is_active, reminder_lead_minutes, penalty_rule_id, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING id
      `,
      [
        input.title,
        input.description ?? null,
        cadence,
        input.area ?? "",
        input.points ?? 10,
        frequencyInterval,
        frequencyUnit,
        taskMode,
        softReminderAfterHours,
        repeatReminderEveryHours,
        escalateAfterHours,
        advanceRotationOn,
        input.isOptional ?? 0,
        input.parentChoreId ?? null,
        input.defaultDueHour ?? 18,
        input.defaultAssigneeId ?? null,
        input.isActive ?? 1,
        input.reminderLeadMinutes ?? 120,
        input.penaltyRuleId ?? null
      ]
    );

    return await getChoreByIdWithClient(client, result.rows[0].id);
  });
}

export async function updateChoreAsync(
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
  return await withTransaction(async (client) => {
    const current = await getChoreByIdWithClient(client, id);
    if (!current) return null;

    const frequencyInterval = input.frequencyInterval ?? current.frequencyInterval ?? 1;
    const frequencyUnit = normalizeFrequencyUnit(input.frequencyUnit ?? current.frequencyUnit);
    const cadence =
      input.cadence ??
      (input.frequencyInterval !== undefined || input.frequencyUnit !== undefined
        ? deriveCadenceLabel(frequencyInterval, frequencyUnit)
        : undefined);
    const updates: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (input.title !== undefined) push("title", input.title);
    if (input.description !== undefined) push("description", input.description);
    if (cadence !== undefined) push("cadence", cadence);
    if (input.area !== undefined) push("area", input.area);
    if (input.points !== undefined) push("points", input.points);
    if (input.frequencyInterval !== undefined) push("frequency_interval", input.frequencyInterval);
    if (input.frequencyUnit !== undefined) push("frequency_unit", normalizeFrequencyUnit(input.frequencyUnit));
    if (input.taskMode !== undefined) push("task_mode", normalizeTaskMode(input.taskMode));
    if (input.softReminderAfterHours !== undefined) push("soft_reminder_after_hours", Math.max(1, input.softReminderAfterHours));
    if (input.repeatReminderEveryHours !== undefined) push("repeat_reminder_every_hours", Math.max(1, input.repeatReminderEveryHours));
    if (input.escalateAfterHours !== undefined) push("escalate_after_hours", Math.max(1, input.escalateAfterHours));
    if (input.advanceRotationOn !== undefined) push("advance_rotation_on", normalizeAdvanceRotationOn(input.advanceRotationOn));
    if (input.isOptional !== undefined) push("is_optional", input.isOptional);
    if (input.parentChoreId !== undefined) push("parent_chore_id", input.parentChoreId);
    if (input.defaultDueHour !== undefined) push("default_due_hour", input.defaultDueHour);
    if (input.defaultAssigneeId !== undefined) push("default_assignee_id", input.defaultAssigneeId);
    if (input.isActive !== undefined) push("is_active", input.isActive);
    if (input.reminderLeadMinutes !== undefined) push("reminder_lead_minutes", input.reminderLeadMinutes);
    if (input.penaltyRuleId !== undefined) push("penalty_rule_id", input.penaltyRuleId);
    push("updated_at", nowIso());
    values.push(id);

    await client.query(`UPDATE chores SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
    return await getChoreByIdWithClient(client, id);
  });
}

export async function createPenaltyAsync(input: {
  roommateId: number;
  assignmentId?: number | null;
  ruleId?: number | null;
  reason?: string | null;
  amountCents?: number;
  status?: PenaltyStatus;
}) {
  return await withTransaction(async (client) => {
    const ruleAmount =
      input.ruleId != null ? (await getPenaltyRuleByIdWithClient(client, input.ruleId))?.amountCents : undefined;
    const settings = await getHouseSettingsAsync();
    const amountCents = input.amountCents ?? ruleAmount ?? settings.defaultPenaltyAmountCents;
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO penalties (
          roommate_id, assignment_id, rule_id, reason, amount_cents, status, created_at, settled_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP,
          CASE WHEN $6 IN ('waived', 'paid') THEN CURRENT_TIMESTAMP ELSE NULL END
        )
        RETURNING id
      `,
      [
        input.roommateId,
        input.assignmentId ?? null,
        input.ruleId ?? null,
        input.reason ?? null,
        amountCents,
        input.status ?? "open"
      ]
    );

    await recalculatePenaltyBalanceWithClient(client, input.roommateId);
    return await getPenaltyByIdWithClient(client, result.rows[0].id);
  });
}

export async function updatePenaltyAsync(
  id: number,
  input: {
    reason?: string | null;
    amountCents?: number;
    status?: PenaltyStatus;
  }
) {
  return await withTransaction(async (client) => {
    const existing = await getPenaltyByIdWithClient(client, id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (input.reason !== undefined) push("reason", input.reason);
    if (input.amountCents !== undefined) push("amount_cents", input.amountCents);
    if (input.status !== undefined) push("status", input.status);
    if (input.status !== undefined) push("settled_at", input.status === "open" ? null : nowIso());
    values.push(id);

    await client.query(`UPDATE penalties SET ${updates.join(", ")} WHERE id = $${values.length}`, values);
    await recalculatePenaltyBalanceWithClient(client, existing.roommateId);
    return await getPenaltyByIdWithClient(client, id);
  });
}

export async function getAssignmentByIdAsync(assignmentId: number) {
  return await withPoolClient((client) => getAssignmentByIdWithClient(client, assignmentId));
}

export async function listPendingAssignmentsForRoommateAsync(roommateId: number) {
  const rows = await queryRows<Assignment>(
    `
      ${assignmentBaseQuery}
      WHERE assignments.roommate_id = $1
        AND assignments.status = 'pending'
      ORDER BY assignments.due_date ASC, assignments.id ASC
    `,
    [roommateId]
  );

  return rows.map((assignment) => withAccountabilityState(assignment));
}

export async function listAllPendingAssignmentsAsync() {
  const rows = await queryRows<Assignment>(
    `
      ${assignmentBaseQuery}
      WHERE assignments.status = 'pending'
      ORDER BY assignments.due_date ASC, assignments.id ASC
    `
  );

  return rows.map((assignment) => withAccountabilityState(assignment));
}

export async function getOldestPendingAssignmentAsync(roommateId: number) {
  const row = await queryRow<Assignment>(
    `
      ${assignmentBaseQuery}
      WHERE assignments.roommate_id = $1
        AND assignments.status = 'pending'
      ORDER BY assignments.due_date ASC, assignments.id ASC
      LIMIT 1
    `,
    [roommateId]
  );

  return row ? withAccountabilityState(row) : null;
}

export async function addEventLogAsync(params: {
  roommateId: number | null;
  assignmentId: number | null;
  eventType: string;
  payload: string | null;
}) {
  await queryRows(
    `
      INSERT INTO event_log (roommate_id, assignment_id, event_type, payload_json, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING id
    `,
    [params.roommateId, params.assignmentId, params.eventType, params.payload]
  );
}

export async function hasRoommateReceivedWhatsappWelcomeAsync(roommateId: number) {
  const row = await queryRow<{ id: number }>(
    `
      SELECT id
      FROM event_log
      WHERE roommate_id = $1
        AND event_type = 'WHATSAPP_WELCOME_SENT'
      ORDER BY id DESC
      LIMIT 1
    `,
    [roommateId]
  );

  return Boolean(row);
}

export async function getLatestConversationPromptForWhatsappAsync(
  whatsappNumber: string,
  options?: { preferOriginalRecipient?: boolean }
) {
  const effectivePattern = `%"effectiveTo":"${whatsappNumber}"%`;
  const originalPattern = `%"originalTo":"${whatsappNumber}"%`;

  const row = options?.preferOriginalRecipient
    ? await queryRow<{
        assignmentId: number | null;
        payloadJson: string | null;
        createdAt: string;
      }>(
        `
          SELECT
            assignment_id AS "assignmentId",
            payload_json AS "payloadJson",
            created_at AS "createdAt"
          FROM event_log
          WHERE event_type = 'CONVERSATION_MESSAGE_SENT'
            AND (payload_json LIKE $1 OR payload_json LIKE $2)
          ORDER BY
            CASE WHEN payload_json LIKE $1 THEN 0 ELSE 1 END,
            id DESC
          LIMIT 1
        `,
        [originalPattern, effectivePattern]
      )
    : await queryRow<{
        assignmentId: number | null;
        payloadJson: string | null;
        createdAt: string;
      }>(
        `
          SELECT
            assignment_id AS "assignmentId",
            payload_json AS "payloadJson",
            created_at AS "createdAt"
          FROM event_log
          WHERE event_type = 'CONVERSATION_MESSAGE_SENT'
            AND payload_json LIKE $1
          ORDER BY id DESC
          LIMIT 1
        `,
        [effectivePattern]
      );

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
    promptType: typeof payload?.promptType === "string" ? payload.promptType : null,
    originalTo: typeof payload?.originalTo === "string" ? payload.originalTo : null,
    effectiveTo: typeof payload?.effectiveTo === "string" ? payload.effectiveTo : null
  };
}

export async function getRoommateStreakSummaryAsync(roommateId: number) {
  const assignments = (await listAssignmentsAsync())
    .filter((assignment) => assignment.responsibleRoommateId === roommateId)
    .filter((assignment) => assignment.status !== "pending")
    .sort((left, right) => new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime());

  let currentStreak = 0;
  let bestStreak = 0;

  for (const assignment of assignments) {
    const successfulCompletion =
      assignment.status === "done" &&
      assignment.resolutionType !== "rescued" &&
      !assignment.strikeApplied;

    if (successfulCompletion) {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return { currentStreak, bestStreak };
}

export async function createAssignmentAsync(input: {
  choreId: number;
  roommateId: number;
  dueDate: string;
  windowStartDate?: string | null;
  windowEndDate?: string | null;
  status?: Assignment["status"];
  statusNote?: string | null;
  resolutionType?: Assignment["resolutionType"] | null;
  responsibleRoommateId?: number;
  rescuedByRoommateId?: number | null;
  escalationLevel?: number;
  strikeApplied?: number;
  rescueCreditApplied?: number;
}) {
  return await withTransaction(async (client) => {
    const status = input.status ?? "pending";
    const resolutionType = deriveAssignmentResolutionType(status, input.resolutionType);
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO assignments (
          chore_id,
          roommate_id,
          due_date,
          window_start_date,
          window_end_date,
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [
        input.choreId,
        input.roommateId,
        input.dueDate,
        input.windowStartDate ?? null,
        input.windowEndDate ?? null,
        status,
        input.statusNote ?? null,
        resolutionType,
        input.responsibleRoommateId ?? input.roommateId,
        input.rescuedByRoommateId ?? null,
        input.escalationLevel ?? 0,
        input.strikeApplied ?? 0,
        input.rescueCreditApplied ?? 0
      ]
    );

    const assignmentId = result.rows[0]?.id;
    if (!assignmentId) {
      return null;
    }

    await addEventLogWithClient(client, {
      roommateId: input.roommateId,
      assignmentId,
      eventType: "ASSIGNMENT_CREATED",
      payload: JSON.stringify({ dueDate: input.dueDate })
    });

    return await getAssignmentByIdWithClient(client, assignmentId);
  });
}

export async function updateAssignmentStatusAsync(
  assignmentId: number,
  status: Assignment["status"],
  note: string | null,
  options?: {
    resolutionType?: Assignment["resolutionType"] | null;
    rescuedByRoommateId?: number | null;
    responsibleRoommateId?: number;
    escalationLevel?: number;
    strikeApplied?: number;
    rescueCreditApplied?: number;
  }
) {
  return await withTransaction(async (client) => {
    const previous = await getAssignmentByIdWithClient(client, assignmentId);
    const resolutionType = deriveAssignmentResolutionType(status, options?.resolutionType);

    await client.query(
      `
        UPDATE assignments
        SET
          status = $2,
          status_note = $3,
          resolution_type = $4,
          responsible_roommate_id = $5,
          rescued_by_roommate_id = $6,
          escalation_level = $7,
          strike_applied = $8,
          rescue_credit_applied = $9,
          completed_at = CASE
            WHEN $2 IN ('done', 'skipped') THEN CURRENT_TIMESTAMP
            ELSE NULL
          END
        WHERE id = $1
      `,
      [
        assignmentId,
        status,
        note,
        resolutionType,
        options?.responsibleRoommateId ?? previous?.responsibleRoommateId ?? previous?.roommateId ?? null,
        options?.rescuedByRoommateId ?? null,
        options?.escalationLevel ?? previous?.escalationLevel ?? 0,
        options?.strikeApplied ?? previous?.strikeApplied ?? 0,
        options?.rescueCreditApplied ?? previous?.rescueCreditApplied ?? 0
      ]
    );

    const updated = await getAssignmentByIdWithClient(client, assignmentId);
    if (updated) {
      const movedIntoResolvedState =
        (updated.status === "done" || updated.status === "skipped") &&
        previous?.status !== updated.status;

      if (movedIntoResolvedState) {
        await advanceChoreRotationWithClient(client, updated);
      }
      await maybeCreatePenaltyForAssignmentWithClient(client, updated, note);
    }

    return updated;
  });
}

export async function rescueAssignmentAsync(
  assignmentId: number,
  rescuedByRoommateId: number,
  note: string | null
) {
  const assignment = await getAssignmentByIdAsync(assignmentId);
  if (!assignment) {
    return null;
  }

  if (assignment.status !== "pending") {
    return assignment;
  }

  if (assignment.roommateId === rescuedByRoommateId) {
    await updateAssignmentStatusAsync(assignmentId, "done", note, {
      resolutionType: "done",
      responsibleRoommateId: assignment.roommateId,
      rescuedByRoommateId: null
    });
    return await getAssignmentByIdAsync(assignmentId);
  }

  await updateAssignmentStatusAsync(assignmentId, "done", note, {
    resolutionType: "rescued",
    responsibleRoommateId: assignment.roommateId,
    rescuedByRoommateId,
    strikeApplied: 1,
    rescueCreditApplied: 1,
    escalationLevel: Math.max(assignment.escalationLevel, 2)
  });

  await addEventLogAsync({
    roommateId: rescuedByRoommateId,
    assignmentId,
    eventType: "TASK_RESCUED",
    payload: JSON.stringify({
      choreId: assignment.choreId,
      responsibleRoommateId: assignment.roommateId,
      rescuedByRoommateId
    })
  });
  await addEventLogAsync({
    roommateId: assignment.roommateId,
    assignmentId,
    eventType: "RESPONSIBILITY_STRIKE_APPLIED",
    payload: JSON.stringify({ choreId: assignment.choreId, rescuedByRoommateId })
  });
  await addEventLogAsync({
    roommateId: rescuedByRoommateId,
    assignmentId,
    eventType: "RESCUE_CREDIT_APPLIED",
    payload: JSON.stringify({ choreId: assignment.choreId, responsibleRoommateId: assignment.roommateId })
  });

  return await getAssignmentByIdAsync(assignmentId);
}

export async function listRescueCandidatesForAssignmentAsync(assignmentId: number) {
  return await withPoolClient(async (client) => {
    const assignment = await getAssignmentByIdWithClient(client, assignmentId);
    if (!assignment) {
      return [];
    }

    const chore = await getChoreByIdWithClient(client, assignment.choreId);
    if (!chore) {
      return [];
    }

    if (chore.taskMode === "fixed_schedule") {
      return await listStandbyRoommatesForFixedAssignmentWithClient(client, assignment);
    }

    const nextRoommate = await getNextRoommateInRotationWithClient(client, assignment.roommateId);
    if (!nextRoommate || nextRoommate.id === assignment.roommateId) {
      return [];
    }

    return [nextRoommate];
  });
}

export async function handoffAssignmentToNextRoommateAsync(
  assignmentId: number,
  reason: string | null
) {
  return await withTransaction(async (client) => {
    const assignment = await getAssignmentByIdWithClient(client, assignmentId);
    if (!assignment || (assignment.status !== "pending" && assignment.status !== "skipped")) {
      return null;
    }

    const chore = await getChoreByIdWithClient(client, assignment.choreId);
    const nextRoommate =
      chore?.taskMode === "fixed_schedule"
        ? await findStandbyRoommateForFixedAssignmentWithClient(client, assignment)
        : await getNextRoommateInRotationWithClient(client, assignment.roommateId);

    if (!nextRoommate || nextRoommate.id === assignment.roommateId) {
      if (chore?.taskMode === "fixed_schedule") {
        await markNextFixedAssignmentPriorityWithClient(client, assignment);
        await addEventLogWithClient(client, {
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

    const existingPending = await client.query<{ id: number }>(
      `
        SELECT id
        FROM assignments
        WHERE chore_id = $1
          AND roommate_id = $2
          AND due_date = $3
          AND status = 'pending'
        ORDER BY id DESC
        LIMIT 1
      `,
      [assignment.choreId, nextRoommate.id, assignment.dueDate]
    );

    let reassigned: Assignment | null;
    if (existingPending.rows[0]?.id) {
      reassigned = await getAssignmentByIdWithClient(client, existingPending.rows[0].id);
    } else {
      const created = await client.query<{ id: number }>(
        `
          INSERT INTO assignments (
            chore_id,
            roommate_id,
            due_date,
            window_start_date,
            window_end_date,
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
          VALUES ($1, $2, $3, $4, $5, 'pending', $6, NULL, $2, NULL, 0, 0, 0, CURRENT_TIMESTAMP)
          RETURNING id
        `,
        [
          assignment.choreId,
          nextRoommate.id,
          assignment.dueDate,
          assignment.windowStartDate ?? null,
          assignment.windowEndDate ?? null,
          reason ? `handoff: ${reason}` : "handoff from WhatsApp"
        ]
      );
      reassigned = created.rows[0]?.id ? await getAssignmentByIdWithClient(client, created.rows[0].id) : null;
    }

    await addEventLogWithClient(client, {
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
  });
}

export async function handoffAssignmentToRoommateAsync(
  assignmentId: number,
  roommateId: number,
  reason: string | null
) {
  return await withTransaction(async (client) => {
    const assignment = await getAssignmentByIdWithClient(client, assignmentId);
    if (!assignment || (assignment.status !== "pending" && assignment.status !== "skipped")) {
      return null;
    }

    if (roommateId === assignment.roommateId) {
      return null;
    }

    const chore = await getChoreByIdWithClient(client, assignment.choreId);
    let candidates: Roommate[] = [];
    if (chore?.taskMode === "fixed_schedule") {
      candidates = await listStandbyRoommatesForFixedAssignmentWithClient(client, assignment);
    } else {
      const nextRoommate = await getNextRoommateInRotationWithClient(client, assignment.roommateId);
      candidates =
        nextRoommate && nextRoommate.id !== assignment.roommateId ? [nextRoommate] : [];
    }
    const candidateIds = new Set(candidates.map((roommate) => roommate.id));
    if (!candidateIds.has(roommateId)) {
      return null;
    }

    const existingPending = await client.query<{ id: number }>(
      `
        SELECT id
        FROM assignments
        WHERE chore_id = $1
          AND roommate_id = $2
          AND due_date = $3
          AND status = 'pending'
        ORDER BY id DESC
        LIMIT 1
      `,
      [assignment.choreId, roommateId, assignment.dueDate]
    );

    let reassigned: Assignment | null;
    if (existingPending.rows[0]?.id) {
      reassigned = await getAssignmentByIdWithClient(client, existingPending.rows[0].id);
    } else {
      const created = await client.query<{ id: number }>(
        `
          INSERT INTO assignments (
            chore_id,
            roommate_id,
            due_date,
            window_start_date,
            window_end_date,
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
          VALUES ($1, $2, $3, $4, $5, 'pending', $6, NULL, $2, NULL, 0, 0, 0, CURRENT_TIMESTAMP)
          RETURNING id
        `,
        [
          assignment.choreId,
          roommateId,
          assignment.dueDate,
          assignment.windowStartDate ?? null,
          assignment.windowEndDate ?? null,
          reason ? `handoff: ${reason}` : "handoff from WhatsApp"
        ]
      );
      reassigned = created.rows[0]?.id ? await getAssignmentByIdWithClient(client, created.rows[0].id) : null;
    }

    await addEventLogWithClient(client, {
      roommateId,
      assignmentId: reassigned?.id ?? null,
      eventType: "ASSIGNMENT_ACCEPTED_FROM_RESCUE_REQUEST",
      payload: JSON.stringify({
        originalAssignmentId: assignmentId,
        choreId: assignment.choreId,
        fromRoommateId: assignment.roommateId,
        toRoommateId: roommateId,
        reason
      })
    });

    return reassigned;
  });
}

export async function postponeAssignmentToTomorrowAsync(
  assignmentId: number,
  reason: string | null
) {
  const assignment = await getAssignmentByIdAsync(assignmentId);
  if (!assignment) {
    return null;
  }

  const dueDate = addDaysToIsoDate(assignment.dueDate, 1);
  return await rescheduleAssignmentToDateAsync(assignmentId, dueDate, reason ?? "pushed to tomorrow");
}

export async function rescheduleAssignmentToDateAsync(
  assignmentId: number,
  dueDate: string,
  reason: string | null
) {
  return await withTransaction(async (client) => {
    const assignment = await getAssignmentByIdWithClient(client, assignmentId);
    if (!assignment || assignment.status !== "pending") {
      return null;
    }

    if (assignment.taskMode === "fixed_schedule") {
      const weekEnd = getSundayWeekEndForIsoDate(assignment.dueDate);
      if (!isIsoDateWithinRange(dueDate, assignment.dueDate, weekEnd)) {
        return null;
      }
    }

    await client.query(
      `
        UPDATE assignments
        SET
          due_date = $2,
          window_start_date = NULL,
          window_end_date = NULL,
          status_note = $3,
          escalation_level = 0,
          reminder_sent_at = NULL,
          penalty_applied_at = NULL,
          completed_at = NULL
        WHERE id = $1
      `,
      [assignmentId, dueDate, reason ?? "pushed to tomorrow"]
    );

    await addEventLogWithClient(client, {
      roommateId: assignment.roommateId,
      assignmentId,
      eventType: "ASSIGNMENT_POSTPONED",
      payload: JSON.stringify({ dueDate, reason })
    });

    return await getAssignmentByIdWithClient(client, assignmentId);
  });
}

async function shiftUpcomingWeeklyWindowAfterWeekendDelayWithClient(input: {
  client: PoolClient;
  sourceAssignment: Assignment;
  effectiveDate: string;
  referenceDueDate: string;
  reason: string | null;
}) {
  const { client, sourceAssignment, effectiveDate, referenceDueDate, reason } = input;
  if (
    sourceAssignment.taskMode !== "fixed_schedule" ||
    sourceAssignment.frequencyUnit !== "week"
  ) {
    return null;
  }

  const delayDays = dayDiffIso(referenceDueDate, effectiveDate);
  if (delayDays === null || delayDays <= 0) {
    return null;
  }

  const settingsRow = await client.query<{ timezone: string | null }>(
    `
      SELECT timezone
      FROM house_settings
      WHERE id = 1
      LIMIT 1
    `
  );
  const timezone = settingsRow.rows[0]?.timezone || "Europe/Berlin";
  const effectiveDateMidday = new Date(`${effectiveDate}T12:00:00Z`);
  const weekday = weekdayInTimezone(effectiveDateMidday, timezone);
  if (weekday !== "Sat" && weekday !== "Sun") {
    return null;
  }

  const nextPending = await client.query<{
    id: number;
    dueDate: string;
    windowStartDate: string | null;
    windowEndDate: string | null;
  }>(
    `
      SELECT
        id,
        due_date AS "dueDate",
        window_start_date AS "windowStartDate",
        window_end_date AS "windowEndDate"
      FROM assignments
      WHERE chore_id = $1
        AND status = 'pending'
        AND due_date > $2
      ORDER BY due_date ASC, id ASC
      LIMIT 1
    `,
    [sourceAssignment.choreId, effectiveDate]
  );

  const upcoming = nextPending.rows[0];
  if (!upcoming) {
    return null;
  }

  if (upcoming.windowStartDate || upcoming.windowEndDate) {
    return await getAssignmentByIdWithClient(client, upcoming.id);
  }

  const gapDays = dayDiffIso(effectiveDate, upcoming.dueDate);
  if (gapDays === null || gapDays > 6 || gapDays < 0) {
    return null;
  }

  const shiftedDueDate = addDaysToIsoDate(upcoming.dueDate, 1);
  const shiftedWindowStartDate = addDaysToIsoDate(shiftedDueDate, -2);
  const shiftedWindowEndDate = shiftedDueDate;
  const note = reason ?? "shifted after weekend delay";

  await client.query(
    `
      UPDATE assignments
      SET
        due_date = $2,
        window_start_date = $3,
        window_end_date = $4,
        status_note = CASE
          WHEN status_note IS NULL OR status_note = '' THEN $5
          WHEN status_note LIKE '%' || $5 || '%' THEN status_note
          ELSE status_note || ' | ' || $5
        END
      WHERE id = $1
    `,
    [upcoming.id, shiftedDueDate, shiftedWindowStartDate, shiftedWindowEndDate, note]
  );

  await addEventLogWithClient(client, {
    roommateId: sourceAssignment.roommateId,
    assignmentId: upcoming.id,
    eventType: "ASSIGNMENT_WINDOW_SHIFTED",
    payload: JSON.stringify({
      sourceAssignmentId: sourceAssignment.id,
      sourceEffectiveDate: effectiveDate,
      sourceReferenceDueDate: referenceDueDate,
      previousDueDate: upcoming.dueDate,
      shiftedDueDate,
      shiftedWindowStartDate,
      shiftedWindowEndDate
    })
  });

  return await getAssignmentByIdWithClient(client, upcoming.id);
}

export async function shiftNextWeeklyWindowAfterSundayCompletionAsync(
  completedAssignmentId: number,
  reason: string | null = null
) {
  return await withTransaction(async (client) => {
    const completedAssignment = await getAssignmentByIdWithClient(
      client,
      completedAssignmentId
    );
    if (!completedAssignment || completedAssignment.status !== "done") {
      return null;
    }

    const timezoneRow = await client.query<{ timezone: string | null }>(
      `
        SELECT timezone
        FROM house_settings
        WHERE id = 1
        LIMIT 1
      `
    );
    const timezone = timezoneRow.rows[0]?.timezone || "Europe/Berlin";
    const completedAt = completedAssignment.completedAt
      ? new Date(completedAssignment.completedAt)
      : new Date();
    const completedDateLocal = isoDateInTimezone(completedAt, timezone);

    return await shiftUpcomingWeeklyWindowAfterWeekendDelayWithClient({
      client,
      sourceAssignment: completedAssignment,
      effectiveDate: completedDateLocal,
      referenceDueDate: completedAssignment.dueDate,
      reason: reason ?? "shifted because completion happened on the weekend"
    });
  });
}

export async function shiftNextWeeklyWindowAfterWeekendDelayAsync(
  assignmentId: number,
  previousDueDate: string,
  reason: string | null = null
) {
  return await withTransaction(async (client) => {
    const assignment = await getAssignmentByIdWithClient(client, assignmentId);
    if (!assignment || assignment.status !== "pending") {
      return null;
    }

    return await shiftUpcomingWeeklyWindowAfterWeekendDelayWithClient({
      client,
      sourceAssignment: assignment,
      effectiveDate: assignment.dueDate,
      referenceDueDate: previousDueDate,
      reason: reason ?? "shifted because this week was delayed to the weekend"
    });
  });
}

export async function hasConversationPromptBeenSentAsync(
  assignmentId: number,
  promptType: string
) {
  const row = await queryRow<{ id: number }>(
    `
      SELECT id
      FROM event_log
      WHERE assignment_id = $1
        AND event_type = 'CONVERSATION_MESSAGE_SENT'
        AND payload_json LIKE $2
      ORDER BY id DESC
      LIMIT 1
    `,
    [assignmentId, `%"promptType":"${promptType}"%`]
  );

  return Boolean(row);
}

export async function hasRoommateConversationPromptBeenSentTodayAsync(input: {
  roommateId: number;
  promptType: string;
  now: Date;
  timezone: string;
}) {
  const row = await queryRow<{ createdAt: string }>(
    `
      SELECT created_at AS "createdAt"
      FROM event_log
      WHERE roommate_id = $1
        AND event_type = 'CONVERSATION_MESSAGE_SENT'
        AND payload_json LIKE $2
      ORDER BY id DESC
      LIMIT 1
    `,
    [input.roommateId, `%"promptType":"${input.promptType}"%`]
  );

  if (!row) {
    return false;
  }

  const sentAt = new Date(row.createdAt);
  if (Number.isNaN(sentAt.getTime())) {
    return false;
  }

  return (
    isoDateInTimezone(sentAt, input.timezone) ===
    isoDateInTimezone(input.now, input.timezone)
  );
}

export async function markReminderSentAsync(assignmentId: number) {
  return await withTransaction(async (client) => {
    await client.query(
      `
        UPDATE assignments
        SET reminder_sent_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [assignmentId]
    );

    const assignment = await getAssignmentByIdWithClient(client, assignmentId);
    if (!assignment) {
      return null;
    }

    const nextLevel =
      assignment.escalationLevel >= 2
        ? assignment.escalationLevel
        : assignment.escalationLevel === 0
          ? 1
          : assignment.escalationLevel;

    if (nextLevel !== assignment.escalationLevel) {
      await client.query(
        `
          UPDATE assignments
          SET escalation_level = $2
          WHERE id = $1
        `,
        [assignmentId, nextLevel]
      );
    }

    await addEventLogWithClient(client, {
      roommateId: assignment.roommateId,
      assignmentId,
      eventType: "TASK_REMINDER_SENT",
      payload: JSON.stringify({ escalationLevel: nextLevel })
    });

    return await getAssignmentByIdWithClient(client, assignmentId);
  });
}

function reminderHourForAssignment(assignment: Assignment) {
  return assignment.roommateReminderHour || assignment.defaultDueHour || 18;
}

function hasReachedReminderTime(input: {
  now: Date;
  timezone: string;
  dueDate: string;
  hour: number;
  minute?: number;
}) {
  return hasReachedLocalMinuteOfDay({
    now: input.now,
    timezone: input.timezone,
    targetDate: input.dueDate,
    minuteOfDay: input.hour * 60 + (input.minute ?? 0)
  });
}

export async function getAssignmentsDueForWeeklyHeadsUpAsync(now: Date) {
  const [assignments, settings] = await Promise.all([
    listAllPendingAssignmentsAsync(),
    getHouseSettingsAsync()
  ]);

  if (!settings.autoRemindersEnabled) {
    return [];
  }

  const timezone = settings.timezone || "Europe/Berlin";
  if (weekdayInTimezone(now, timezone) !== "Mon") {
    return [];
  }

  const currentWeek = getMondayWeekRangeInTimezone(now, timezone);
  const localToday = isoDateInTimezone(now, timezone);
  const candidates = [];
  for (const assignment of assignments) {
    if (!assignment.roommateReminderEnabled) {
      continue;
    }

    if (await hasConversationPromptBeenSentAsync(assignment.id, "weekly_heads_up")) {
      continue;
    }

    const diff = dayDifferenceInTimezone(now, assignment.dueDate, timezone);
    if (
      diff !== null &&
      diff >= 0 &&
      diff <= 6 &&
      isIsoDateWithinRange(assignment.dueDate, currentWeek.start, currentWeek.end) &&
      hasReachedReminderTime({
        now,
        timezone,
        dueDate: localToday,
        hour: reminderHourForAssignment(assignment)
      })
    ) {
      candidates.push(assignment);
    }
  }

  return candidates;
}

export async function getAssignmentsDueForTwoDayReminderAsync(now: Date) {
  const [assignments, settings] = await Promise.all([
    listAllPendingAssignmentsAsync(),
    getHouseSettingsAsync()
  ]);

  if (!settings.autoRemindersEnabled) {
    return [];
  }

  const timezone = settings.timezone || "Europe/Berlin";
  const currentWeek = getMondayWeekRangeInTimezone(now, timezone);
  const localToday = isoDateInTimezone(now, timezone);
  const candidates = [];
  for (const assignment of assignments) {
    if (!assignment.roommateReminderEnabled) {
      continue;
    }

    if (await hasConversationPromptBeenSentAsync(assignment.id, "two_day_reminder")) {
      continue;
    }

    const diff = dayDifferenceInTimezone(now, assignment.dueDate, timezone);
    if (
      diff === 2 &&
      isIsoDateWithinRange(assignment.dueDate, currentWeek.start, currentWeek.end) &&
      hasReachedReminderTime({
        now,
        timezone,
        dueDate: localToday,
        hour: reminderHourForAssignment(assignment)
      })
    ) {
      candidates.push(assignment);
    }
  }

  return candidates;
}

export async function getAssignmentsDueForDayOfReminderAsync(now: Date) {
  const [assignments, settings] = await Promise.all([
    listAllPendingAssignmentsAsync(),
    getHouseSettingsAsync()
  ]);

  if (!settings.autoRemindersEnabled) {
    return [];
  }

  const timezone = settings.timezone || "Europe/Berlin";
  const currentWeek = getMondayWeekRangeInTimezone(now, timezone);
  const candidates = [];
  for (const assignment of assignments) {
    if (!assignment.roommateReminderEnabled) {
      continue;
    }

    if (await hasConversationPromptBeenSentAsync(assignment.id, "day_of_reminder")) {
      continue;
    }

    if (dayDifferenceInTimezone(now, assignment.dueDate, timezone) !== 0) {
      continue;
    }

    if (!isIsoDateWithinRange(assignment.dueDate, currentWeek.start, currentWeek.end)) {
      continue;
    }

    const leadMinutes =
      assignment.roommateReminderLeadMinutes ||
      assignment.reminderLeadMinutes ||
      settings.defaultReminderLeadMinutes;
    const dueHour = reminderHourForAssignment(assignment);
    if (
      hasReachedLocalMinuteOfDay({
        now,
        timezone,
        targetDate: assignment.dueDate,
        minuteOfDay: dueHour * 60 - leadMinutes
      })
    ) {
      candidates.push(assignment);
    }
  }

  return candidates;
}

export async function getAssignmentsDueForCompletionCheckAsync(now: Date) {
  const [assignments, settings] = await Promise.all([
    listAllPendingAssignmentsAsync(),
    getHouseSettingsAsync()
  ]);

  if (!settings.autoRemindersEnabled) {
    return [];
  }

  const timezone = settings.timezone || "Europe/Berlin";
  const candidates = [];
  for (const assignment of assignments) {
    if (!assignment.roommateReminderEnabled || !assignment.reminderSentAt) {
      continue;
    }

    if (await hasConversationPromptBeenSentAsync(assignment.id, "completion_check")) {
      continue;
    }

    const dueHour = assignment.roommateReminderHour || assignment.defaultDueHour || 18;
    if (
      hasReachedLocalMinuteOfDay({
        now,
        timezone,
        targetDate: assignment.dueDate,
        minuteOfDay: dueHour * 60
      })
    ) {
      candidates.push(assignment);
    }
  }

  return candidates;
}

export async function getAssignmentsDueForEscalationNudgeAsync(now: Date) {
  const [assignments, settings] = await Promise.all([
    listAllPendingAssignmentsAsync(),
    getHouseSettingsAsync()
  ]);

  if (!settings.autoRemindersEnabled) {
    return [];
  }

  const timezone = settings.timezone || "Europe/Berlin";
  const candidates = [];
  for (const assignment of assignments) {
    if (!assignment.roommateReminderEnabled || !assignment.reminderSentAt) {
      continue;
    }

    if (!(await hasConversationPromptBeenSentAsync(assignment.id, "completion_check"))) {
      continue;
    }

    if (await hasConversationPromptBeenSentAsync(assignment.id, "escalation_nudge")) {
      continue;
    }

    const dueHour = assignment.roommateReminderHour || assignment.defaultDueHour || 18;
    if (
      hasReachedLocalMinuteOfDay({
        now,
        timezone,
        targetDate: assignment.dueDate,
        minuteOfDay: dueHour * 60 + 120
      })
    ) {
      candidates.push(assignment);
    }
  }

  return candidates;
}

export async function getAssignmentsDueForAutoStrikeAsync(now: Date) {
  const assignments = await listAllPendingAssignmentsAsync();
  return assignments.filter((assignment) => {
    if (assignment.taskMode !== "fixed_schedule") {
      return false;
    }

    const dueHour = assignment.roommateReminderHour || assignment.defaultDueHour || 20;
    const dueAt = new Date(`${assignment.dueDate}T${String(dueHour).padStart(2, "0")}:00:00`);
    const strikeAt = new Date(dueAt.getTime() + 12 * 60 * 60 * 1000);
    return now >= strikeAt;
  });
}

export async function applyMissedWeeklyStrikeAsync(
  assignmentId: number,
  note?: string | null
) {
  return await withTransaction(async (client) => {
    const assignment = await getAssignmentByIdWithClient(client, assignmentId);
    if (!assignment || assignment.status !== "pending" || assignment.taskMode !== "fixed_schedule") {
      return null;
    }

    await client.query(
      `
        UPDATE assignments
        SET
          status = 'skipped',
          status_note = $2,
          resolution_type = 'skipped',
          responsible_roommate_id = $3,
          rescued_by_roommate_id = NULL,
          escalation_level = $4,
          strike_applied = 1,
          rescue_credit_applied = 0,
          completed_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [
        assignmentId,
        note ?? "missed weekly cleaning window",
        assignment.roommateId,
        Math.max(assignment.escalationLevel, 2)
      ]
    );

    const updated = await getAssignmentByIdWithClient(client, assignmentId);
    if (!updated) {
      return null;
    }

    await markNextFixedAssignmentPriorityWithClient(client, updated);
    await maybeCreatePenaltyForAssignmentWithClient(client, updated, updated.statusNote);
    await addEventLogWithClient(client, {
      roommateId: updated.roommateId,
      assignmentId,
      eventType: "WEEKLY_STRIKE_APPLIED",
      payload: JSON.stringify({
        choreId: updated.choreId,
        dueDate: updated.dueDate
      })
    });

    return updated;
  });
}

export async function getAssignmentsDueForRescueFallbackAsync(
  now: Date,
  waitMinutes = 30
) {
  const rows = await queryRows<{ assignmentId: number; createdAt: string }>(
    `
      SELECT
        assignment_id AS "assignmentId",
        MIN(created_at) AS "createdAt"
      FROM event_log
      WHERE event_type = 'CONVERSATION_MESSAGE_SENT'
        AND assignment_id IS NOT NULL
        AND payload_json LIKE '%"promptType":"rescue_request"%'
      GROUP BY assignment_id
      ORDER BY MIN(created_at) ASC
    `
  );

  const candidates = [];
  for (const row of rows) {
    const assignment = await getAssignmentByIdAsync(row.assignmentId);
    if (!assignment || assignment.status !== "skipped") {
      continue;
    }

    const resolved = await queryRow<{ id: number }>(
      `
        SELECT id
        FROM event_log
        WHERE assignment_id = $1
          AND event_type = 'RESCUE_REQUEST_RESOLVED'
        ORDER BY id DESC
        LIMIT 1
      `,
      [row.assignmentId]
    );

    if (resolved) {
      continue;
    }

    const createdAt = new Date(row.createdAt);
    if (now.getTime() - createdAt.getTime() >= waitMinutes * 60 * 1000) {
      candidates.push(assignment);
    }
  }

  return candidates;
}

export async function createExpenseAsync(input: {
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

  return await withTransaction(async (client) => {
    const activeRoommates = await client.query<{ id: number; name: string }>(
      `
        SELECT id, name
        FROM roommates
        WHERE is_active = 1
        ORDER BY sort_order, id
      `
    );

    const result = await client.query<{ id: number }>(
      `
        INSERT INTO expenses (
          title,
          amount_cents,
          currency,
          paid_by_roommate_id,
          note,
          created_at
        )
        VALUES ($1, $2, 'EUR', $3, $4, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [title, input.amountCents, input.paidByRoommateId, input.note ?? null]
    );

    const expenseId = result.rows[0]?.id;
    if (!expenseId) {
      return null;
    }

    for (const share of shares) {
      await client.query(
        `
          INSERT INTO expense_shares (expense_id, roommate_id, share_cents)
          VALUES ($1, $2, $3)
        `,
        [expenseId, share.roommateId, share.shareCents]
      );
    }

    await addEventLogWithClient(client, {
      roommateId: input.paidByRoommateId,
      assignmentId: null,
      eventType: "EXPENSE_ADDED",
      payload: JSON.stringify({
        title,
        amountCents: input.amountCents,
        excludedRoommateIds: activeRoommates.rows
          .map((roommate) => roommate.id)
          .filter((roommateId) => !input.includedRoommateIds.includes(roommateId))
      })
    });

    const [expenseRow] = await client.query<
      Omit<Expense, "shares" | "excludedRoommateIds" | "excludedRoommateNames"> & { currency: "EUR" }
    >(
      `
        SELECT
          expenses.id,
          expenses.title,
          expenses.amount_cents AS "amountCents",
          expenses.currency,
          expenses.paid_by_roommate_id AS "paidByRoommateId",
          payer.name AS "paidByRoommateName",
          expenses.note,
          expenses.created_at AS "createdAt"
        FROM expenses
        INNER JOIN roommates AS payer ON payer.id = expenses.paid_by_roommate_id
        WHERE expenses.id = $1
        LIMIT 1
      `,
      [expenseId]
    ).then((result) => result.rows);

    const shareRows = await client.query<ExpenseShare>(
      `
        SELECT
          expense_shares.expense_id AS "expenseId",
          expense_shares.roommate_id AS "roommateId",
          roommates.name AS "roommateName",
          expense_shares.share_cents AS "shareCents"
        FROM expense_shares
        INNER JOIN roommates ON roommates.id = expense_shares.roommate_id
        WHERE expense_shares.expense_id = $1
        ORDER BY roommates.sort_order, roommates.id
      `,
      [expenseId]
    );

    if (!expenseRow) {
      return null;
    }

    const includedIds = new Set(shareRows.rows.map((share) => share.roommateId));
    const excluded = activeRoommates.rows.filter((roommate) => !includedIds.has(roommate.id));

    return {
      ...expenseRow,
      shares: shareRows.rows,
      excludedRoommateIds: excluded.map((roommate) => roommate.id),
      excludedRoommateNames: excluded.map((roommate) => roommate.name)
    };
  });
}

export async function createSettlementAsync(input: {
  fromRoommateId: number;
  toRoommateId: number;
  amountCents: number;
  note?: string | null;
}) {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Settlement amount must be greater than zero.");
  }

  return await withTransaction(async (client) => {
    const result = await client.query<{ id: number }>(
      `
        INSERT INTO settlements (
          from_roommate_id,
          to_roommate_id,
          amount_cents,
          currency,
          note,
          created_at
        )
        VALUES ($1, $2, $3, 'EUR', $4, CURRENT_TIMESTAMP)
        RETURNING id
      `,
      [input.fromRoommateId, input.toRoommateId, input.amountCents, input.note ?? null]
    );

    const settlementId = result.rows[0]?.id;
    if (!settlementId) {
      return null;
    }

    await addEventLogWithClient(client, {
      roommateId: input.fromRoommateId,
      assignmentId: null,
      eventType: "SETTLEMENT_ADDED",
      payload: JSON.stringify({
        toRoommateId: input.toRoommateId,
        amountCents: input.amountCents
      })
    });

    const settlementRows = await client.query<Settlement>(
      `
        SELECT
          settlements.id,
          settlements.from_roommate_id AS "fromRoommateId",
          sender.name AS "fromRoommateName",
          settlements.to_roommate_id AS "toRoommateId",
          receiver.name AS "toRoommateName",
          settlements.amount_cents AS "amountCents",
          settlements.currency,
          settlements.note,
          settlements.created_at AS "createdAt"
        FROM settlements
        INNER JOIN roommates AS sender ON sender.id = settlements.from_roommate_id
        INNER JOIN roommates AS receiver ON receiver.id = settlements.to_roommate_id
        WHERE settlements.id = $1
        LIMIT 1
      `,
      [settlementId]
    );

    return settlementRows.rows[0] ?? null;
  });
}

export async function updateAssignmentAsync(
  id: number,
  input: {
    choreId?: number;
    roommateId?: number;
    dueDate?: string;
    windowStartDate?: string | null;
    windowEndDate?: string | null;
    status?: Assignment["status"];
    statusNote?: string | null;
    resolutionType?: Assignment["resolutionType"] | null;
    responsibleRoommateId?: number;
    rescuedByRoommateId?: number | null;
    escalationLevel?: number;
    strikeApplied?: number;
    rescueCreditApplied?: number;
  }
) {
  if (input.status !== undefined) {
    const updated = await updateAssignmentStatusAsync(id, input.status, input.statusNote ?? null, {
      resolutionType: input.resolutionType,
      responsibleRoommateId: input.responsibleRoommateId,
      rescuedByRoommateId: input.rescuedByRoommateId,
      escalationLevel: input.escalationLevel,
      strikeApplied: input.strikeApplied,
      rescueCreditApplied: input.rescueCreditApplied
    });

    if (updated) {
      await addEventLogAsync({
        roommateId: updated.roommateId,
        assignmentId: id,
        eventType: "ASSIGNMENT_UPDATED",
        payload: JSON.stringify({
          dueDate: input.dueDate,
          status: input.status,
          roommateId: input.roommateId
        })
      });
    }

    return updated;
  }

  return await withTransaction(async (client) => {
    const fields: string[] = [];
    const values: unknown[] = [];
    let index = 2;

    const push = (column: string, value: unknown) => {
      if (value === undefined) {
        return;
      }
      fields.push(`${column} = $${index}`);
      values.push(value);
      index += 1;
    };

    push("chore_id", input.choreId);
    push("roommate_id", input.roommateId);
    push("due_date", input.dueDate);
    push("window_start_date", input.windowStartDate);
    push("window_end_date", input.windowEndDate);
    push("status_note", input.statusNote);
    push("resolution_type", input.resolutionType);
    push("responsible_roommate_id", input.responsibleRoommateId);
    push("rescued_by_roommate_id", input.rescuedByRoommateId);
    push("escalation_level", input.escalationLevel);
    push("strike_applied", input.strikeApplied);
    push("rescue_credit_applied", input.rescueCreditApplied);

    if (fields.length > 0) {
      await client.query(
        `UPDATE assignments SET ${fields.join(", ")} WHERE id = $1`,
        [id, ...values]
      );
    }

    const assignment = await getAssignmentByIdWithClient(client, id);
    if (assignment) {
      await addEventLogWithClient(client, {
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
  });
}
