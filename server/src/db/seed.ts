import { db } from "./client.js";
import { initializeDatabase } from "./init.js";

function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function hasRoommates() {
  const row = db.prepare("SELECT COUNT(*) as count FROM roommates").get() as {
    count: number;
  };
  return row.count > 0;
}

function hasPenaltyRules() {
  const row = db.prepare("SELECT COUNT(*) as count FROM penalty_rules").get() as {
    count: number;
  };
  return row.count > 0;
}

function hasAssignments() {
  const row = db.prepare("SELECT COUNT(*) as count FROM assignments").get() as {
    count: number;
  };
  return row.count > 0;
}

initializeDatabase();

if (!hasPenaltyRules()) {
  const createdAt = nowIso();
  db.prepare(
    `
      INSERT INTO penalty_rules (
        title,
        description,
        trigger_type,
        amount_cents,
        created_at,
        updated_at
      )
      VALUES
        ('Missed chore fee', 'Applies when a chore is skipped or missed.', 'skipped', 500, @createdAt, @createdAt),
        ('Manual fine', 'Applied manually by the main tenant.', 'manual', 700, @createdAt, @createdAt)
    `
  ).run({ createdAt });
}

const defaultPenaltyRule = db.prepare(
  "SELECT id FROM penalty_rules ORDER BY id ASC LIMIT 1"
).get() as { id: number };

if (!hasRoommates()) {
  const insertRoommate = db.prepare(`
    INSERT INTO roommates (
      name,
      whatsapp_number,
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
      @reminderEnabled,
      @reminderHour,
      @reminderLeadMinutes,
      @notes,
      @createdAt,
      @updatedAt
    )
  `);

  const roommates = [
    {
      name: "Varun",
      whatsappNumber: "whatsapp:+4917613420040",
      reminderEnabled: 1,
      reminderHour: 18,
      reminderLeadMinutes: 180,
      notes: "Main renter and house rota owner."
    },
    {
      name: "Mayssa",
      whatsappNumber: "whatsapp:+491700000101",
      reminderEnabled: 1,
      reminderHour: 17,
      reminderLeadMinutes: 120,
      notes: "Prefers earlier nudges before deadlines."
    },
    {
      name: "Noah",
      whatsappNumber: "whatsapp:+491700000102",
      reminderEnabled: 1,
      reminderHour: 19,
      reminderLeadMinutes: 90,
      notes: "Prefers evening reminders."
    },
    {
      name: "Julia",
      whatsappNumber: "whatsapp:+491700000103",
      reminderEnabled: 1,
      reminderHour: 18,
      reminderLeadMinutes: 120,
      notes: "Rotation member."
    },
    {
      name: "Tracy",
      whatsappNumber: "whatsapp:+491700000104",
      reminderEnabled: 1,
      reminderHour: 18,
      reminderLeadMinutes: 120,
      notes: "Rotation member."
    },
    {
      name: "Maria",
      whatsappNumber: "whatsapp:+491700000105",
      reminderEnabled: 1,
      reminderHour: 18,
      reminderLeadMinutes: 120,
      notes: "Rotation member."
    }
  ];

  roommates.forEach((roommate) => {
    insertRoommate.run({
      ...roommate,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  });
}

const roommateIds = db
  .prepare("SELECT id FROM roommates ORDER BY id ASC")
  .all() as Array<{ id: number }>;

const choreCount = db.prepare("SELECT COUNT(*) as count FROM chores").get() as {
  count: number;
};

if (choreCount.count === 0) {
  const insertChore = db.prepare(`
    INSERT INTO chores (
      title,
      description,
      cadence,
      area,
      points,
      frequency_interval,
      frequency_unit,
      is_optional,
      parent_chore_id,
      default_due_hour,
      default_assignee_id,
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
      @isOptional,
      @parentChoreId,
      @defaultDueHour,
      @defaultAssigneeId,
      @reminderLeadMinutes,
      @penaltyRuleId,
      @createdAt,
      @updatedAt
    )
  `);

  insertChore.run({
    title: "Take out trash",
    description: "Bins must be outside before the evening pickup.",
    cadence: "Every 2 days",
    area: "Kitchen",
    points: 8,
    frequencyInterval: 2,
    frequencyUnit: "day",
    isOptional: 0,
    parentChoreId: null,
    defaultDueHour: 20,
    defaultAssigneeId: roommateIds[0]?.id ?? null,
    reminderLeadMinutes: 180,
    penaltyRuleId: defaultPenaltyRule.id,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  insertChore.run({
    title: "Clean kitchen",
    description: "Counters, stove, floor, and sink.",
    cadence: "Every week",
    area: "Kitchen",
    points: 16,
    frequencyInterval: 1,
    frequencyUnit: "week",
    isOptional: 0,
    parentChoreId: null,
    defaultDueHour: 19,
    defaultAssigneeId: roommateIds[1]?.id ?? null,
    reminderLeadMinutes: 120,
    penaltyRuleId: defaultPenaltyRule.id,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
  insertChore.run({
    title: "Bathroom reset",
    description: "Mirror, sink, toilet rim, and floor.",
    cadence: "Every week",
    area: "Bathroom",
    points: 18,
    frequencyInterval: 1,
    frequencyUnit: "week",
    isOptional: 0,
    parentChoreId: null,
    defaultDueHour: 18,
    defaultAssigneeId: roommateIds[2]?.id ?? null,
    reminderLeadMinutes: 90,
    penaltyRuleId: defaultPenaltyRule.id,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });

  const bathroomChore = db.prepare(
    "SELECT id FROM chores WHERE title = ? ORDER BY id DESC LIMIT 1"
  ).get("Bathroom reset") as { id: number } | undefined;

  if (bathroomChore) {
    insertChore.run({
      title: "Deep clean bathtub",
      description: "Scrub the tub, drain, and tile grout.",
      cadence: "Every month",
      area: "Bathroom",
      points: 12,
      frequencyInterval: 1,
      frequencyUnit: "month",
      isOptional: 1,
      parentChoreId: bathroomChore.id,
      defaultDueHour: 18,
      defaultAssigneeId: roommateIds[2]?.id ?? null,
      reminderLeadMinutes: 60,
      penaltyRuleId: defaultPenaltyRule.id,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }
}

if (!hasAssignments()) {
  const chores = db
    .prepare("SELECT id, default_assignee_id as defaultAssigneeId FROM chores ORDER BY id ASC")
    .all() as Array<{ id: number; defaultAssigneeId: number | null }>;

  const insertAssignment = db.prepare(`
    INSERT INTO assignments (chore_id, roommate_id, due_date, status, created_at)
    VALUES (@choreId, @roommateId, @dueDate, @status, @createdAt)
  `);

  chores.forEach((chore, index) => {
    insertAssignment.run({
      choreId: chore.id,
      roommateId: chore.defaultAssigneeId ?? roommateIds[0]?.id,
      dueDate: todayIso(index),
      status: "pending",
      createdAt: nowIso()
    });
  });
}

db.prepare(
  `
    UPDATE chores
    SET penalty_rule_id = COALESCE(penalty_rule_id, @defaultPenaltyRuleId)
  `
).run({ defaultPenaltyRuleId: defaultPenaltyRule.id });

console.log("Database initialized and seed data ensured.");
