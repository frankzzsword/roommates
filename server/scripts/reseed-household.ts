import dotenv from "dotenv";
import pg from "pg";

import { initializeDatabase } from "../src/db/init.js";

dotenv.config();

const { Client } = pg;

type SeedRoommate = {
  name: string;
  whatsappNumber: string;
  loginPassword: string;
  note: string;
  reminderHour: number;
  reminderLeadMinutes: number;
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getTuesdayForScheduleAnchor(anchor: Date) {
  const day = anchor.getDay();
  const distanceFromTuesday = (day + 5) % 7;
  return addDays(anchor, -distanceFromTuesday);
}

function getFridayFromTuesday(tuesday: Date) {
  return addDays(tuesday, 3);
}

function activeRotationOrder(roommates: string[], freeName: string) {
  const freeIndex = roommates.findIndex((roommate) => roommate === freeName);
  if (freeIndex === -1) {
    return roommates;
  }

  return [
    ...roommates.slice(freeIndex + 1),
    ...roommates.slice(0, freeIndex)
  ].filter((roommate) => roommate !== freeName);
}

async function main() {
  initializeDatabase();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const roommates: SeedRoommate[] = [
    {
      name: "Varun",
      whatsappNumber: "whatsapp:+4917613420040",
      loginPassword: "varun123",
      note: "Main renter",
      reminderHour: 18,
      reminderLeadMinutes: 240
    },
    {
      name: "Mayssa",
      whatsappNumber: "whatsapp:+491700000101",
      loginPassword: "mayssa123",
      note: "Out this week, starts next week",
      reminderHour: 18,
      reminderLeadMinutes: 240
    },
    {
      name: "Noah",
      whatsappNumber: "whatsapp:+491700000102",
      loginPassword: "noah123",
      note: "Roommate",
      reminderHour: 18,
      reminderLeadMinutes: 240
    },
    {
      name: "Julia",
      whatsappNumber: "whatsapp:+491700000103",
      loginPassword: "julia123",
      note: "Roommate",
      reminderHour: 18,
      reminderLeadMinutes: 240
    },
    {
      name: "Tracy",
      whatsappNumber: "whatsapp:+491700000104",
      loginPassword: "tracy123",
      note: "Roommate",
      reminderHour: 18,
      reminderLeadMinutes: 240
    },
    {
      name: "Maria",
      whatsappNumber: "whatsapp:+491700000105",
      loginPassword: "maria123",
      note: "Roommate",
      reminderHour: 18,
      reminderLeadMinutes: 240
    }
  ];

  const weeklyChoreTitles = ["Bathroom", "Kitchen", "Hallway", "Living Room", "Toilet"];

  try {
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE event_log, settlements, expense_shares, expenses, penalties, assignments, chores, penalty_rules, roommates RESTART IDENTITY CASCADE"
    );
    await client.query("DELETE FROM house_settings");
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
          'Varun''s Flat',
          'Europe/Berlin',
          1,
          1,
          'SUN',
          18,
          0,
          180,
          'Strike',
          'Weekly House Hero',
          'Monthly House Hero',
          CURRENT_TIMESTAMP
        )
      `
    );

    const strikeRule = await client.query(
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
          'Missed weekly window',
          'Tracks a strike when a weekly chore is missed after Friday night.',
          'skipped',
          0,
          1,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
        RETURNING id
      `
    );
    const strikeRuleId = strikeRule.rows[0].id as number;

    const roommateIdsByName = new Map<string, number>();
    for (const [index, roommate] of roommates.entries()) {
      const result = await client.query(
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
          VALUES ($1, $2, $3, 1, $4, 1, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          RETURNING id
        `,
        [
          roommate.name,
          roommate.whatsappNumber,
          roommate.loginPassword,
          index + 1,
          roommate.reminderHour,
          roommate.reminderLeadMinutes,
          roommate.note
        ]
      );

      roommateIdsByName.set(roommate.name, result.rows[0].id as number);
    }

    const createChore = async (input: {
      title: string;
      description: string;
      cadence: string;
      area: string;
      points: number;
      frequencyInterval: number;
      frequencyUnit: "day" | "week" | "month";
      taskMode: "fixed_schedule" | "rolling_until_done";
      defaultDueHour: number;
      reminderLeadMinutes: number;
      defaultAssigneeId?: number | null;
      softReminderAfterHours?: number;
      repeatReminderEveryHours?: number;
      escalateAfterHours?: number;
      advanceRotationOn?: "completed_only" | "rescue_keeps_owner";
    }) => {
      const result = await client.query(
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
            default_due_hour,
            default_assignee_id,
            is_active,
            reminder_lead_minutes,
            penalty_rule_id,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, 1, $15, $16,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          RETURNING id
        `,
        [
          input.title,
          input.description,
          input.cadence,
          input.area,
          input.points,
          input.frequencyInterval,
          input.frequencyUnit,
          input.taskMode,
          input.softReminderAfterHours ?? 24,
          input.repeatReminderEveryHours ?? 24,
          input.escalateAfterHours ?? 48,
          input.advanceRotationOn ?? "completed_only",
          input.defaultDueHour,
          input.defaultAssigneeId ?? null,
          input.reminderLeadMinutes,
          strikeRuleId
        ]
      );

      return result.rows[0].id as number;
    };

    const weeklyChoreIds = new Map<string, number>();
    for (const title of weeklyChoreTitles) {
      const id = await createChore({
        title,
        description: `${title} cleaning window runs from Tuesday to Friday each week.`,
        cadence: "Tuesday to Friday every week",
        area: title,
        points: 14,
        frequencyInterval: 1,
        frequencyUnit: "week",
        taskMode: "fixed_schedule",
        defaultDueHour: 20,
        reminderLeadMinutes: 240
      });
      weeklyChoreIds.set(title, id);
    }

    const towelsId = await createChore({
      title: "Washing Towels",
      description: "Wash and dry shared towels.",
      cadence: "Every month",
      area: "Laundry",
      points: 8,
      frequencyInterval: 1,
      frequencyUnit: "month",
      taskMode: "fixed_schedule",
      defaultDueHour: 20,
      reminderLeadMinutes: 240
    });

    const recyclingId = await createChore({
      title: "Plastic and Glass Trash",
      description: "Take out plastic and glass recycling.",
      cadence: "Every 2 weeks",
      area: "Recycling",
      points: 8,
      frequencyInterval: 2,
      frequencyUnit: "week",
      taskMode: "fixed_schedule",
      defaultDueHour: 20,
      reminderLeadMinutes: 240
    });

    const rollingSeeds = [
      ["Running Dishwasher", "Start the dishwasher when it is full.", "Varun", "Kitchen", 1],
      ["Emptying Dishwasher", "Empty the dishwasher once it is clean.", "Noah", "Kitchen", 1],
      ["Taking Out Trash", "Take out the household trash when it is full.", "Julia", "Utilities", 2]
    ] as const;

    for (const [title, description, assigneeName, area, dueOffset] of rollingSeeds) {
      const assigneeId = roommateIdsByName.get(assigneeName);
      if (!assigneeId) {
        throw new Error(`Missing rolling assignee ${assigneeName}`);
      }

      const choreId = await createChore({
        title,
        description,
        cadence: "Rolling ownership",
        area,
        points: 6,
        frequencyInterval: 1,
        frequencyUnit: "day",
        taskMode: "rolling_until_done",
        defaultDueHour: 20,
        defaultAssigneeId: assigneeId,
        reminderLeadMinutes: 180,
        softReminderAfterHours: 12,
        repeatReminderEveryHours: 12,
        escalateAfterHours: 24,
        advanceRotationOn: "rescue_keeps_owner"
      });

      await client.query(
        `
          INSERT INTO assignments (
            chore_id,
            roommate_id,
            due_date,
            status,
            responsible_roommate_id,
            escalation_level,
            strike_applied,
            rescue_credit_applied,
            created_at
          )
          VALUES ($1, $2, $3, 'pending', $2, 0, 0, 0, CURRENT_TIMESTAMP)
        `,
        [choreId, assigneeId, isoDate(addDays(new Date(), dueOffset))]
      );
    }

    const tomorrow = addDays(new Date(), 1);
    const currentWeekTuesday = getTuesdayForScheduleAnchor(tomorrow);
    const rosterOrder = roommates.map((roommate) => roommate.name);

    for (let weekIndex = 0; weekIndex < 8; weekIndex += 1) {
      const weekTuesday = addDays(currentWeekTuesday, weekIndex * 7);
      const dueDate = isoDate(getFridayFromTuesday(weekTuesday));

      const weekAssignments =
        weekIndex === 0
          ? rosterOrder.filter((name) => name !== "Mayssa")
          : activeRotationOrder(rosterOrder, rosterOrder[(weekIndex - 1) % rosterOrder.length]);

      for (const [taskIndex, title] of weeklyChoreTitles.entries()) {
        const roommateName = weekAssignments[taskIndex];
        const roommateId = roommateIdsByName.get(roommateName);
        const choreId = weeklyChoreIds.get(title);

        if (!roommateId || !choreId) {
          throw new Error(`Unable to seed weekly assignment for ${title}`);
        }

        await client.query(
          `
            INSERT INTO assignments (
              chore_id,
              roommate_id,
              due_date,
              status,
              responsible_roommate_id,
              escalation_level,
              strike_applied,
              rescue_credit_applied,
              created_at
            )
            VALUES ($1, $2, $3, 'pending', $2, 0, 0, 0, CURRENT_TIMESTAMP)
          `,
          [choreId, roommateId, dueDate]
        );
      }

      if (weekIndex >= 1) {
        const freeRoommateName = rosterOrder[(weekIndex - 1) % rosterOrder.length];
        const freeRoommateId = roommateIdsByName.get(freeRoommateName);

        if (freeRoommateId && (weekIndex - 1) % 4 === 0) {
          await client.query(
            `
              INSERT INTO assignments (
                chore_id,
                roommate_id,
                due_date,
                status,
                responsible_roommate_id,
                escalation_level,
                strike_applied,
                rescue_credit_applied,
                created_at
              )
              VALUES ($1, $2, $3, 'pending', $2, 0, 0, 0, CURRENT_TIMESTAMP)
            `,
            [towelsId, freeRoommateId, dueDate]
          );
        }

        if (freeRoommateId && (weekIndex - 1) % 2 === 0) {
          await client.query(
            `
              INSERT INTO assignments (
                chore_id,
                roommate_id,
                due_date,
                status,
                responsible_roommate_id,
                escalation_level,
                strike_applied,
                rescue_credit_applied,
                created_at
              )
              VALUES ($1, $2, $3, 'pending', $2, 0, 0, 0, CURRENT_TIMESTAMP)
            `,
            [recyclingId, freeRoommateId, dueDate]
          );
        }
      }
    }

    await client.query("COMMIT");

    console.log(
      JSON.stringify(
        {
          ok: true,
          roommates: roommates.map((roommate) => ({
            name: roommate.name,
            password: roommate.loginPassword
          }))
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
