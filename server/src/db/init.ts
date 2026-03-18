import { db } from "./client.js";

function ensureHouseSettingsRow() {
  const row = db.prepare('SELECT COUNT(*) AS "count" FROM house_settings').get() as {
    count: number;
  };

  if (row.count > 0) {
    return;
  }

  db.prepare(
    `
      INSERT INTO house_settings (
        id,
        house_name,
        timezone,
        auto_reminders_enabled,
        weekly_summary_enabled,
        summary_day,
        summary_hour,
        default_penalty_amount_cents,
        default_reminder_lead_minutes,
        penalty_label,
        weekly_achievement_label,
        monthly_achievement_label,
        updated_at
      )
      VALUES (
        1,
        @houseName,
        @timezone,
        1,
        1,
        'SUN',
        18,
        500,
        120,
        'Pizza Fund',
        'Weekly Champion',
        'Monthly Champion',
        CURRENT_TIMESTAMP
      )
    `
  ).run({
    houseName: "Shared Apartment",
    timezone: "Europe/Berlin"
  });
}

export function initializeDatabase() {
  db.exec(`
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS penalty_rules (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('missed', 'skipped', 'manual')),
      amount_cents INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS assignments (
      id SERIAL PRIMARY KEY,
      chore_id INTEGER NOT NULL REFERENCES chores(id),
      roommate_id INTEGER NOT NULL REFERENCES roommates(id),
      due_date TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'skipped')) DEFAULT 'pending',
      status_note TEXT,
      resolution_type TEXT CHECK (resolution_type IN ('done', 'rescued', 'skipped')),
      responsible_roommate_id INTEGER REFERENCES roommates(id),
      rescued_by_roommate_id INTEGER REFERENCES roommates(id),
      escalation_level INTEGER NOT NULL DEFAULT 0,
      strike_applied INTEGER NOT NULL DEFAULT 0,
      rescue_credit_applied INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      status TEXT NOT NULL CHECK (status IN ('open', 'waived', 'paid')) DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      settled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS house_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      house_name TEXT NOT NULL DEFAULT 'Shared Apartment',
      timezone TEXT NOT NULL DEFAULT 'Europe/Berlin',
      auto_reminders_enabled INTEGER NOT NULL DEFAULT 1,
      weekly_summary_enabled INTEGER NOT NULL DEFAULT 1,
      summary_day TEXT NOT NULL DEFAULT 'SUN',
      summary_hour INTEGER NOT NULL DEFAULT 18,
      default_penalty_amount_cents INTEGER NOT NULL DEFAULT 500,
      default_reminder_lead_minutes INTEGER NOT NULL DEFAULT 120,
      penalty_label TEXT NOT NULL DEFAULT 'Pizza Fund',
      weekly_achievement_label TEXT NOT NULL DEFAULT 'Weekly Champion',
      monthly_achievement_label TEXT NOT NULL DEFAULT 'Monthly Champion',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id SERIAL PRIMARY KEY,
      roommate_id INTEGER REFERENCES roommates(id),
      assignment_id INTEGER REFERENCES assignments(id),
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS reminder_enabled INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS reminder_hour INTEGER NOT NULL DEFAULT 18;
    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS reminder_lead_minutes INTEGER NOT NULL DEFAULT 120;
    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS penalty_balance_cents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE roommates ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

    ALTER TABLE chores ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT 'Shared space';
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 10;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS frequency_interval INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS frequency_unit TEXT NOT NULL DEFAULT 'week';
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS task_mode TEXT NOT NULL DEFAULT 'fixed_schedule';
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS soft_reminder_after_hours INTEGER NOT NULL DEFAULT 24;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS repeat_reminder_every_hours INTEGER NOT NULL DEFAULT 24;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS escalate_after_hours INTEGER NOT NULL DEFAULT 48;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS advance_rotation_on TEXT NOT NULL DEFAULT 'completed_only';
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS is_optional INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS parent_chore_id INTEGER REFERENCES chores(id);
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS reminder_lead_minutes INTEGER NOT NULL DEFAULT 120;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS penalty_rule_id INTEGER REFERENCES penalty_rules(id);
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE chores ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS penalty_applied_at TEXT;
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS resolution_type TEXT CHECK (resolution_type IN ('done', 'rescued', 'skipped'));
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS responsible_roommate_id INTEGER REFERENCES roommates(id);
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS rescued_by_roommate_id INTEGER REFERENCES roommates(id);
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS strike_applied INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE assignments ADD COLUMN IF NOT EXISTS rescue_credit_applied INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE house_settings ADD COLUMN IF NOT EXISTS weekly_achievement_label TEXT NOT NULL DEFAULT 'Weekly Champion';
    ALTER TABLE house_settings ADD COLUMN IF NOT EXISTS monthly_achievement_label TEXT NOT NULL DEFAULT 'Monthly Champion';
  `);

  db.prepare(
    `
      UPDATE roommates
      SET sort_order = id
      WHERE sort_order IS NULL OR sort_order = 0
    `
  ).run();

  db.prepare(
    `
      UPDATE chores
      SET
        area = CASE
          WHEN area IS NOT NULL AND area <> '' THEN area
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%bathroom%' THEN 'Bathroom'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%kitchen%' THEN 'Kitchen'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%trash%' THEN 'Utilities'
          WHEN lower(COALESCE(title, '') || ' ' || COALESCE(description, '')) LIKE '%hall%' THEN 'Hallway'
          ELSE 'Shared space'
        END,
        points = CASE WHEN points IS NULL OR points <= 0 THEN 10 ELSE points END,
        frequency_interval = CASE
          WHEN frequency_interval IS NULL OR frequency_interval <= 0 THEN 1
          ELSE frequency_interval
        END,
        frequency_unit = CASE
          WHEN frequency_unit IS NULL OR frequency_unit NOT IN ('day', 'week', 'month') THEN 'week'
          ELSE frequency_unit
        END,
        task_mode = CASE
          WHEN task_mode IS NULL OR task_mode NOT IN ('fixed_schedule', 'rolling_until_done') THEN 'fixed_schedule'
          ELSE task_mode
        END,
        soft_reminder_after_hours = CASE
          WHEN soft_reminder_after_hours IS NULL OR soft_reminder_after_hours <= 0 THEN 24
          ELSE soft_reminder_after_hours
        END,
        repeat_reminder_every_hours = CASE
          WHEN repeat_reminder_every_hours IS NULL OR repeat_reminder_every_hours <= 0 THEN 24
          ELSE repeat_reminder_every_hours
        END,
        escalate_after_hours = CASE
          WHEN escalate_after_hours IS NULL OR escalate_after_hours <= 0 THEN 48
          ELSE escalate_after_hours
        END,
        advance_rotation_on = CASE
          WHEN advance_rotation_on IS NULL OR advance_rotation_on NOT IN ('completed_only', 'rescue_keeps_owner') THEN 'completed_only'
          ELSE advance_rotation_on
        END,
        is_optional = CASE WHEN is_optional IS NULL THEN 0 ELSE is_optional END
    `
  ).run();

  db.prepare(
    `
      UPDATE assignments
      SET responsible_roommate_id = roommate_id
      WHERE responsible_roommate_id IS NULL
    `
  ).run();

  db.prepare(
    `
      UPDATE assignments
      SET resolution_type = CASE
        WHEN status = 'done' THEN 'done'
        WHEN status = 'skipped' THEN 'skipped'
        ELSE resolution_type
      END
      WHERE resolution_type IS NULL AND status IN ('done', 'skipped')
    `
  ).run();

  ensureHouseSettingsRow();
}
