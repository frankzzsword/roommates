import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import dotenv from "dotenv";

const { Client } = pg;

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const snapshotPath = path.resolve(
  process.cwd(),
  process.env.HOUSEHOLD_SNAPSHOT_PATH ?? "./tmp/household-snapshot.json"
);

const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const client = new Client({ connectionString: databaseUrl });

function placeholders(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`).join(", ");
}

async function insertRows(table, columns, rows) {
  if (rows.length === 0) {
    return;
  }

  for (const row of rows) {
    const values = columns.map((column) => row[column] ?? null);
    await client.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders(columns.length)})`,
      values
    );
  }
}

async function setSequence(table, column = "id") {
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${column}) FROM ${table}), 1), true)`,
    [table, column]
  );
}

async function ensureSchema() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS roommates (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      whatsapp_number TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      reminder_enabled INTEGER NOT NULL DEFAULT 1,
      reminder_hour INTEGER NOT NULL DEFAULT 18,
      reminder_lead_minutes INTEGER NOT NULL DEFAULT 120,
      notes TEXT,
      penalty_balance_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
    );

    CREATE TABLE IF NOT EXISTS penalty_rules (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
    );

    CREATE TABLE IF NOT EXISTS chores (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      cadence TEXT NOT NULL,
      area TEXT NOT NULL DEFAULT 'Shared space',
      points INTEGER NOT NULL DEFAULT 10,
      frequency_interval INTEGER NOT NULL DEFAULT 1,
      frequency_unit TEXT NOT NULL DEFAULT 'week',
      task_mode TEXT NOT NULL DEFAULT 'fixed_schedule',
      soft_reminder_after_hours INTEGER NOT NULL DEFAULT 24,
      repeat_reminder_every_hours INTEGER NOT NULL DEFAULT 24,
      escalate_after_hours INTEGER NOT NULL DEFAULT 48,
      advance_rotation_on TEXT NOT NULL DEFAULT 'completed_only',
      is_optional INTEGER NOT NULL DEFAULT 0,
      parent_chore_id INTEGER REFERENCES chores(id),
      default_due_hour INTEGER NOT NULL DEFAULT 18,
      default_assignee_id INTEGER REFERENCES roommates(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      reminder_lead_minutes INTEGER NOT NULL DEFAULT 120,
      penalty_rule_id INTEGER REFERENCES penalty_rules(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      chore_id INTEGER NOT NULL REFERENCES chores(id),
      roommate_id INTEGER NOT NULL REFERENCES roommates(id),
      due_date TEXT NOT NULL,
      status TEXT NOT NULL,
      status_note TEXT,
      resolution_type TEXT,
      responsible_roommate_id INTEGER REFERENCES roommates(id),
      rescued_by_roommate_id INTEGER REFERENCES roommates(id),
      escalation_level INTEGER NOT NULL DEFAULT 0,
      strike_applied INTEGER NOT NULL DEFAULT 0,
      rescue_credit_applied INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
      completed_at TEXT,
      reminder_sent_at TEXT,
      penalty_applied_at TEXT
    );

    CREATE TABLE IF NOT EXISTS penalties (
      id SERIAL PRIMARY KEY,
      roommate_id INTEGER NOT NULL REFERENCES roommates(id),
      assignment_id INTEGER REFERENCES assignments(id),
      rule_id INTEGER REFERENCES penalty_rules(id),
      reason TEXT,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS house_settings (
      id INTEGER PRIMARY KEY,
      house_name TEXT NOT NULL,
      timezone TEXT NOT NULL,
      auto_reminders_enabled INTEGER NOT NULL DEFAULT 1,
      weekly_summary_enabled INTEGER NOT NULL DEFAULT 1,
      summary_day TEXT NOT NULL DEFAULT 'SUN',
      summary_hour INTEGER NOT NULL DEFAULT 18,
      default_penalty_amount_cents INTEGER NOT NULL DEFAULT 500,
      default_reminder_lead_minutes INTEGER NOT NULL DEFAULT 120,
      penalty_label TEXT NOT NULL DEFAULT 'Pizza Fund',
      weekly_achievement_label TEXT NOT NULL DEFAULT 'Weekly Champion',
      monthly_achievement_label TEXT NOT NULL DEFAULT 'Monthly Champion',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id SERIAL PRIMARY KEY,
      roommate_id INTEGER REFERENCES roommates(id),
      assignment_id INTEGER REFERENCES assignments(id),
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
    );
  `);
}

async function main() {
  await client.connect();
  await ensureSchema();

  await client.query("BEGIN");
  try {
    await client.query(
      "TRUNCATE event_log, penalties, assignments, chores, penalty_rules, roommates, house_settings RESTART IDENTITY CASCADE"
    );

    await insertRows(
      "house_settings",
      [
        "id",
        "house_name",
        "timezone",
        "auto_reminders_enabled",
        "weekly_summary_enabled",
        "summary_day",
        "summary_hour",
        "default_penalty_amount_cents",
        "default_reminder_lead_minutes",
        "penalty_label",
        "weekly_achievement_label",
        "monthly_achievement_label",
        "updated_at"
      ],
      [
        {
          id: snapshot.settings.id,
          house_name: snapshot.settings.houseName,
          timezone: snapshot.settings.timezone,
          auto_reminders_enabled: snapshot.settings.autoRemindersEnabled,
          weekly_summary_enabled: snapshot.settings.weeklySummaryEnabled,
          summary_day: snapshot.settings.summaryDay,
          summary_hour: snapshot.settings.summaryHour,
          default_penalty_amount_cents: snapshot.settings.defaultPenaltyAmountCents,
          default_reminder_lead_minutes: snapshot.settings.defaultReminderLeadMinutes,
          penalty_label: snapshot.settings.penaltyLabel,
          weekly_achievement_label: snapshot.settings.weeklyAchievementLabel,
          monthly_achievement_label: snapshot.settings.monthlyAchievementLabel,
          updated_at: snapshot.settings.updatedAt
        }
      ]
    );

    await insertRows(
      "roommates",
      [
        "id",
        "name",
        "whatsapp_number",
        "is_active",
        "sort_order",
        "reminder_enabled",
        "reminder_hour",
        "reminder_lead_minutes",
        "notes",
        "penalty_balance_cents",
        "created_at",
        "updated_at"
      ],
      snapshot.roommates.map((roommate) => ({
        id: roommate.id,
        name: roommate.name,
        whatsapp_number: roommate.whatsappNumber,
        is_active: roommate.isActive,
        sort_order: roommate.sortOrder,
        reminder_enabled: roommate.reminderEnabled,
        reminder_hour: roommate.reminderHour,
        reminder_lead_minutes: roommate.reminderLeadMinutes,
        notes: roommate.notes,
        penalty_balance_cents: roommate.penaltyBalanceCents,
        created_at: roommate.createdAt,
        updated_at: roommate.updatedAt
      }))
    );

    await insertRows(
      "penalty_rules",
      [
        "id",
        "title",
        "description",
        "trigger_type",
        "amount_cents",
        "is_active",
        "created_at",
        "updated_at"
      ],
      snapshot.penaltyRules.map((rule) => ({
        id: rule.id,
        title: rule.title,
        description: rule.description,
        trigger_type: rule.triggerType,
        amount_cents: rule.amountCents,
        is_active: rule.isActive,
        created_at: rule.createdAt,
        updated_at: rule.updatedAt
      }))
    );

    await insertRows(
      "chores",
      [
        "id",
        "title",
        "description",
        "cadence",
        "area",
        "points",
        "frequency_interval",
        "frequency_unit",
        "task_mode",
        "soft_reminder_after_hours",
        "repeat_reminder_every_hours",
        "escalate_after_hours",
        "advance_rotation_on",
        "is_optional",
        "parent_chore_id",
        "default_due_hour",
        "default_assignee_id",
        "is_active",
        "reminder_lead_minutes",
        "penalty_rule_id",
        "created_at",
        "updated_at"
      ],
      snapshot.chores.map((chore) => ({
        id: chore.id,
        title: chore.title,
        description: chore.description,
        cadence: chore.cadence,
        area: chore.area,
        points: chore.points,
        frequency_interval: chore.frequencyInterval,
        frequency_unit: chore.frequencyUnit,
        task_mode: chore.taskMode,
        soft_reminder_after_hours: chore.softReminderAfterHours,
        repeat_reminder_every_hours: chore.repeatReminderEveryHours,
        escalate_after_hours: chore.escalateAfterHours,
        advance_rotation_on: chore.advanceRotationOn,
        is_optional: chore.isOptional,
        parent_chore_id: chore.parentChoreId,
        default_due_hour: chore.defaultDueHour,
        default_assignee_id: chore.defaultAssigneeId,
        is_active: chore.isActive,
        reminder_lead_minutes: chore.reminderLeadMinutes,
        penalty_rule_id: chore.penaltyRuleId,
        created_at: chore.createdAt,
        updated_at: chore.updatedAt
      }))
    );

    await insertRows(
      "assignments",
      [
        "id",
        "chore_id",
        "roommate_id",
        "due_date",
        "status",
        "status_note",
        "resolution_type",
        "responsible_roommate_id",
        "rescued_by_roommate_id",
        "escalation_level",
        "strike_applied",
        "rescue_credit_applied",
        "created_at",
        "completed_at",
        "reminder_sent_at",
        "penalty_applied_at"
      ],
      snapshot.assignments.map((assignment) => ({
        id: assignment.id,
        chore_id: assignment.choreId,
        roommate_id: assignment.roommateId,
        due_date: assignment.dueDate,
        status: assignment.status,
        status_note: assignment.statusNote,
        resolution_type: assignment.resolutionType,
        responsible_roommate_id: assignment.responsibleRoommateId,
        rescued_by_roommate_id: assignment.rescuedByRoommateId,
        escalation_level: assignment.escalationLevel,
        strike_applied: assignment.strikeApplied,
        rescue_credit_applied: assignment.rescueCreditApplied,
        created_at: assignment.createdAt,
        completed_at: assignment.completedAt,
        reminder_sent_at: assignment.reminderSentAt,
        penalty_applied_at: assignment.penaltyAppliedAt
      }))
    );

    await insertRows(
      "penalties",
      [
        "id",
        "roommate_id",
        "assignment_id",
        "rule_id",
        "reason",
        "amount_cents",
        "status",
        "created_at",
        "settled_at"
      ],
      snapshot.penalties.map((penalty) => ({
        id: penalty.id,
        roommate_id: penalty.roommateId,
        assignment_id: penalty.assignmentId,
        rule_id: penalty.ruleId,
        reason: penalty.reason,
        amount_cents: penalty.amountCents,
        status: penalty.status,
        created_at: penalty.createdAt,
        settled_at: penalty.settledAt
      }))
    );

    await client.query(
      `INSERT INTO event_log (event_type, payload_json, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP::text)`,
      ["DATA_MIGRATED_TO_NEON", JSON.stringify({ source: path.basename(snapshotPath) })]
    );

    await setSequence("roommates");
    await setSequence("penalty_rules");
    await setSequence("chores");
    await setSequence("assignments");
    await setSequence("penalties");
    await setSequence("event_log");

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }

  console.log(`Neon bootstrap complete from ${snapshotPath}.`);
}

await main();
