import { queryRow, withPoolClient } from "./pool.js";

async function ensureHouseSettingsRow() {
  const row = await queryRow<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count FROM house_settings`
  );

  if ((Number(row?.count ?? 0) || 0) > 0) {
    return;
  }

  await withPoolClient(async (client) => {
    await client.query(
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
          $1,
          $2,
          1,
          1,
          'SUN',
          18,
          500,
          120,
          'Pizza Fund',
          'Weekly Champion',
          'Monthly Champion',
          CURRENT_TIMESTAMP::text
        )
        ON CONFLICT (id) DO NOTHING
      `,
      ["Shared Apartment", "Europe/Berlin"]
    );
  });
}

export async function initializeDatabase() {
  await withPoolClient(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS roommates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        whatsapp_number TEXT NOT NULL UNIQUE,
        login_password TEXT NOT NULL DEFAULT '',
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
        trigger_type TEXT NOT NULL CHECK (trigger_type IN ('missed', 'skipped', 'manual')),
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
        window_start_date TEXT,
        window_end_date TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'done', 'skipped')) DEFAULT 'pending',
        status_note TEXT,
        resolution_type TEXT CHECK (resolution_type IN ('done', 'rescued', 'skipped')),
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
        status TEXT NOT NULL CHECK (status IN ('open', 'waived', 'paid')) DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text,
        settled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        paid_by_roommate_id INTEGER NOT NULL REFERENCES roommates(id),
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
      );

      CREATE TABLE IF NOT EXISTS expense_shares (
        id SERIAL PRIMARY KEY,
        expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        roommate_id INTEGER NOT NULL REFERENCES roommates(id),
        share_cents INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settlements (
        id SERIAL PRIMARY KEY,
        from_roommate_id INTEGER NOT NULL REFERENCES roommates(id),
        to_roommate_id INTEGER NOT NULL REFERENCES roommates(id),
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'EUR',
        note TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text
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

      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS login_password TEXT NOT NULL DEFAULT '';
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS reminder_enabled INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS reminder_hour INTEGER NOT NULL DEFAULT 18;
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS reminder_lead_minutes INTEGER NOT NULL DEFAULT 120;
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS penalty_balance_cents INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text;
      ALTER TABLE roommates ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text;

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
      ALTER TABLE chores ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text;
      ALTER TABLE chores ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP::text;

      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS penalty_applied_at TEXT;
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS window_start_date TEXT;
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS window_end_date TEXT;
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS resolution_type TEXT CHECK (resolution_type IN ('done', 'rescued', 'skipped'));
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS responsible_roommate_id INTEGER REFERENCES roommates(id);
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS rescued_by_roommate_id INTEGER REFERENCES roommates(id);
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS escalation_level INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS strike_applied INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE assignments ADD COLUMN IF NOT EXISTS rescue_credit_applied INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE house_settings ADD COLUMN IF NOT EXISTS weekly_achievement_label TEXT NOT NULL DEFAULT 'Weekly Champion';
      ALTER TABLE house_settings ADD COLUMN IF NOT EXISTS monthly_achievement_label TEXT NOT NULL DEFAULT 'Monthly Champion';
    `);

    await client.query(`
      UPDATE roommates
      SET sort_order = id
      WHERE sort_order IS NULL OR sort_order = 0
    `);

    await client.query(`
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
        frequency_interval = CASE WHEN frequency_interval IS NULL OR frequency_interval <= 0 THEN 1 ELSE frequency_interval END,
        frequency_unit = CASE WHEN frequency_unit IS NULL OR frequency_unit NOT IN ('day', 'week', 'month') THEN 'week' ELSE frequency_unit END,
        task_mode = CASE WHEN task_mode IS NULL OR task_mode NOT IN ('fixed_schedule', 'rolling_until_done') THEN 'fixed_schedule' ELSE task_mode END,
        soft_reminder_after_hours = CASE WHEN soft_reminder_after_hours IS NULL OR soft_reminder_after_hours <= 0 THEN 24 ELSE soft_reminder_after_hours END,
        repeat_reminder_every_hours = CASE WHEN repeat_reminder_every_hours IS NULL OR repeat_reminder_every_hours <= 0 THEN 24 ELSE repeat_reminder_every_hours END,
        escalate_after_hours = CASE WHEN escalate_after_hours IS NULL OR escalate_after_hours <= 0 THEN 48 ELSE escalate_after_hours END,
        advance_rotation_on = CASE WHEN advance_rotation_on IS NULL OR advance_rotation_on NOT IN ('completed_only', 'rescue_keeps_owner') THEN 'completed_only' ELSE advance_rotation_on END,
        is_optional = COALESCE(is_optional, 0),
        default_due_hour = CASE WHEN default_due_hour IS NULL OR default_due_hour < 0 THEN 18 ELSE default_due_hour END,
        reminder_lead_minutes = CASE WHEN reminder_lead_minutes IS NULL OR reminder_lead_minutes < 0 THEN 120 ELSE reminder_lead_minutes END,
        created_at = COALESCE(created_at, CURRENT_TIMESTAMP::text),
        updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP::text)
    `);

    await client.query(`
      UPDATE assignments
      SET
        responsible_roommate_id = COALESCE(responsible_roommate_id, roommate_id),
        escalation_level = COALESCE(escalation_level, 0),
        strike_applied = COALESCE(strike_applied, 0),
        rescue_credit_applied = COALESCE(rescue_credit_applied, 0),
        created_at = COALESCE(created_at, CURRENT_TIMESTAMP::text)
    `);
  });

  await ensureHouseSettingsRow();
}
