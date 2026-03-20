import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const { Client } = pg;

function createSchemaName() {
  return `codex_test_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function toUnpooledUrl(databaseUrl: string) {
  return databaseUrl.replace("-pooler.", ".");
}

describe("roommate backend integration", () => {
  const baseDatabaseUrl = process.env.DATABASE_URL;

  if (!baseDatabaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests.");
  }

  const schema = createSchemaName();
  const schemaDatabaseUrl = toUnpooledUrl(baseDatabaseUrl);

  let adminClient: pg.Client;
  let app: Awaited<ReturnType<typeof loadApp>>;
  let taskService: Awaited<ReturnType<typeof loadTaskService>>;
  let closePool: (() => Promise<void>) | null = null;

  async function loadApp() {
    process.env.DATABASE_URL = schemaDatabaseUrl;
    process.env.DATABASE_SCHEMA = schema;
    process.env.ENABLE_OUTBOUND_REMINDERS = "false";
    process.env.APP_BASE_URL = "http://localhost:4321";
    const init = await import("../dist/db/init.js");
    await init.initializeDatabase();
    const mod = await import("../dist/app.js");
    return mod.createApp();
  }

  async function loadTaskService() {
    return import("../dist/services/task-service-async.js");
  }

  async function seedBaseHousehold() {
    await adminClient.query(`
      TRUNCATE event_log, settlements, expense_shares, expenses, penalties, assignments, chores, penalty_rules, roommates, house_settings
      RESTART IDENTITY CASCADE
    `);

    await adminClient.query(`
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
        'Test Flat',
        'Europe/Berlin',
        1,
        1,
        'SUN',
        18,
        0,
        180,
        'Strike',
        'Weekly Hero',
        'Monthly Hero',
        CURRENT_TIMESTAMP::text
      )
    `);

    const rule = await adminClient.query<{ id: number }>(`
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
        'Tracks a strike when a weekly chore is missed.',
        'skipped',
        0,
        1,
        CURRENT_TIMESTAMP::text,
        CURRENT_TIMESTAMP::text
      )
      RETURNING id
    `);
    const penaltyRuleId = rule.rows[0]!.id;

    const roommates = [
      ["Varun", "whatsapp:+4917613420040", "varun123", 1],
      ["Mayssa", "whatsapp:+4915759562765", "mayssa123", 2],
      ["Noah", "whatsapp:+41799186472", "noah123", 3],
      ["Julia", "whatsapp:+491757075838", "julia123", 4],
      ["Tracy", "whatsapp:+491637210388", "tracy123", 5],
      ["Maria", "whatsapp:+48516772314", "maria123", 6]
    ] as const;

    for (const [name, whatsappNumber, loginPassword, sortOrder] of roommates) {
      await adminClient.query(
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
            penalty_balance_cents,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 1, $4, 1, 18, 180, NULL, 0, CURRENT_TIMESTAMP::text, CURRENT_TIMESTAMP::text)
        `,
        [name, whatsappNumber, loginPassword, sortOrder]
      );
    }

    const chores = [
      ["Bathroom", 5, "week", "fixed_schedule", "Bathroom"],
      ["Kitchen", 5, "week", "fixed_schedule", "Kitchen"],
      ["Hallway", 3, "week", "fixed_schedule", "Hallway"],
      ["Living Room", 3, "week", "fixed_schedule", "Living Room"],
      ["Toilet", 3, "week", "fixed_schedule", "Toilet"],
      ["Running Dishwasher", 1, "day", "rolling_until_done", "Kitchen"],
      ["Emptying Dishwasher", 2, "day", "rolling_until_done", "Kitchen"],
      ["Taking Out Trash", 2, "day", "rolling_until_done", "Utilities"]
    ] as const;

    for (const [title, points, frequencyUnit, taskMode, area] of chores) {
      await adminClient.query(
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
            $1,
            $2,
            $3,
            $4,
            $5,
            1,
            $6,
            $7,
            24,
            24,
            48,
            CASE WHEN $7 = 'rolling_until_done' THEN 'rescue_keeps_owner' ELSE 'completed_only' END,
            20,
            NULL,
            1,
            180,
            $8,
            CURRENT_TIMESTAMP::text,
            CURRENT_TIMESTAMP::text
          )
        `,
        [
          title,
          `${title} test chore`,
          frequencyUnit === "day" ? "Rolling ownership" : "Tuesday to Friday every week",
          area,
          points,
          frequencyUnit,
          taskMode,
          penaltyRuleId
        ]
      );
    }

    await adminClient.query(`
      INSERT INTO assignments (
        chore_id,
        roommate_id,
        due_date,
        status,
        resolution_type,
        responsible_roommate_id,
        rescued_by_roommate_id,
        escalation_level,
        strike_applied,
        rescue_credit_applied,
        created_at
      )
      VALUES
        (6, 1, '2026-03-19', 'pending', NULL, 1, NULL, 0, 0, 0, CURRENT_TIMESTAMP::text),
        (7, 3, '2026-03-19', 'pending', NULL, 3, NULL, 0, 0, 0, CURRENT_TIMESTAMP::text),
        (8, 4, '2026-03-20', 'pending', NULL, 4, NULL, 0, 0, 0, CURRENT_TIMESTAMP::text),
        (4, 5, '2026-03-20', 'pending', NULL, 5, NULL, 0, 0, 0, CURRENT_TIMESTAMP::text),
        (4, 2, '2026-03-27', 'pending', NULL, 2, NULL, 0, 0, 0, CURRENT_TIMESTAMP::text)
    `);
  }

  beforeAll(async () => {
    adminClient = new Client({ connectionString: toUnpooledUrl(baseDatabaseUrl) });
    await adminClient.connect();
    await adminClient.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await adminClient.query(`SET search_path TO ${schema}`);

    app = await loadApp();
    taskService = await loadTaskService();
    const poolMod = await import("../dist/db/pool.js");
    closePool = poolMod.closePool;
  });

  beforeEach(async () => {
    await seedBaseHousehold();
  });

  afterAll(async () => {
    if (closePool) {
      await closePool();
    }
    await adminClient.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminClient.end();
  });

  it("logs in a roommate with the convenience password flow", async () => {
    const success = await request(app)
      .post("/api/login")
      .send({ name: "Varun", password: "varun123" })
      .expect(200);

    expect(success.body.roommate.name).toBe("Varun");

    const failure = await request(app)
      .post("/api/login")
      .send({ name: "Varun", password: "wrong" })
      .expect(401);

    expect(failure.body.error).toMatch(/Incorrect name or password/i);
  });

  it("creates an equal-shared expense with exclusions and simplified balances", async () => {
    const response = await request(app)
      .post("/api/expenses")
      .send({
        title: "Toilet paper",
        amountCents: 356,
        paidByRoommateId: 1,
        includedRoommateIds: [1, 2, 3, 5, 6]
      })
      .expect(201);

    expect(response.body.expense.excludedRoommateNames).toEqual(["Julia"]);
    expect(response.body.expense.shares).toHaveLength(5);

    const snapshot = await request(app).get("/api/household").expect(200);
    expect(snapshot.body.expenses).toHaveLength(1);
    expect(snapshot.body.balances).toEqual([
      expect.objectContaining({ fromRoommateName: "Mayssa", toRoommateName: "Varun", amountCents: 71 }),
      expect.objectContaining({ fromRoommateName: "Noah", toRoommateName: "Varun", amountCents: 71 }),
      expect.objectContaining({ fromRoommateName: "Tracy", toRoommateName: "Varun", amountCents: 71 }),
      expect.objectContaining({ fromRoommateName: "Maria", toRoommateName: "Varun", amountCents: 71 })
    ]);
  });

  it("reduces balances after a settlement is recorded", async () => {
    await request(app)
      .post("/api/expenses")
      .send({
        title: "Dishwasher tabs",
        amountCents: 600,
        paidByRoommateId: 1,
        includedRoommateIds: [1, 2, 3]
      })
      .expect(201);

    await request(app)
      .post("/api/settlements")
      .send({
        fromRoommateId: 2,
        toRoommateId: 1,
        amountCents: 200
      })
      .expect(201);

    const snapshot = await request(app).get("/api/household").expect(200);
    const mayssaBalance = snapshot.body.balances.find(
      (entry: { fromRoommateName: string; toRoommateName: string }) =>
        entry.fromRoommateName === "Mayssa" && entry.toRoommateName === "Varun"
    );

    expect(mayssaBalance).toBeUndefined();
  });

  it("rejects delaying a fixed weekly chore into the next week", async () => {
    const assignments = await taskService.listAssignmentsAsync();
    const livingRoomThisWeek = assignments.find(
      (assignment: { choreTitle: string; dueDate: string; roommateName: string; status: string }) =>
        assignment.choreTitle === "Living Room" &&
        assignment.dueDate === "2026-03-20" &&
        assignment.roommateName === "Tracy" &&
        assignment.status === "pending"
    );

    expect(livingRoomThisWeek).toBeDefined();
    if (!livingRoomThisWeek) {
      throw new Error("Expected Tracy's Living Room assignment for this week.");
    }

    const rejected = await taskService.rescheduleAssignmentToDateAsync(
      livingRoomThisWeek.id,
      "2026-03-30",
      "try to move into next week"
    );

    expect(rejected).toBeNull();
  });

  it("shifts next week's window when a weekly chore is delayed to Sunday", async () => {
    const assignments = await taskService.listAssignmentsAsync();
    const livingRoomThisWeek = assignments.find(
      (assignment: { choreTitle: string; dueDate: string; roommateName: string; status: string }) =>
        assignment.choreTitle === "Living Room" &&
        assignment.dueDate === "2026-03-20" &&
        assignment.roommateName === "Tracy" &&
        assignment.status === "pending"
    );
    const livingRoomNextWeek = assignments.find(
      (assignment: { choreTitle: string; dueDate: string; roommateName: string; status: string }) =>
        assignment.choreTitle === "Living Room" &&
        assignment.dueDate === "2026-03-27" &&
        assignment.roommateName === "Mayssa" &&
        assignment.status === "pending"
    );

    expect(livingRoomThisWeek).toBeDefined();
    expect(livingRoomNextWeek).toBeDefined();
    if (!livingRoomThisWeek || !livingRoomNextWeek) {
      throw new Error("Expected Living Room assignments for this and next week.");
    }

    const rescheduled = await taskService.rescheduleAssignmentToDateAsync(
      livingRoomThisWeek.id,
      "2026-03-22",
      "moved to Sunday"
    );
    expect(rescheduled?.dueDate).toBe("2026-03-22");

    const shifted = await taskService.shiftNextWeeklyWindowAfterWeekendDelayAsync(
      livingRoomThisWeek.id,
      "2026-03-20",
      "shifted after weekend delay"
    );

    expect(shifted).toBeDefined();
    expect(shifted?.id).toBe(livingRoomNextWeek.id);
    expect(shifted?.dueDate).toBe("2026-03-28");
    expect(shifted?.windowStartDate).toBe("2026-03-26");
    expect(shifted?.windowEndDate).toBe("2026-03-28");
  });

  it("exposes seeded assignments through the async household snapshot", async () => {
    const snapshot = await request(app).get("/api/household").expect(200);

    expect(snapshot.body.roommates).toHaveLength(6);
    expect(snapshot.body.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ choreTitle: "Running Dishwasher", roommateName: "Varun", status: "pending" }),
        expect.objectContaining({ choreTitle: "Taking Out Trash", roommateName: "Julia", status: "pending" })
      ])
    );
  });

  it("tracks streaks from consecutive successful own-task completions and breaks on misses", async () => {
    const first = await taskService.createAssignmentAsync({
      choreId: 1,
      roommateId: 1,
      dueDate: "2026-03-11"
    });
    const second = await taskService.createAssignmentAsync({
      choreId: 1,
      roommateId: 1,
      dueDate: "2026-03-12"
    });
    const third = await taskService.createAssignmentAsync({
      choreId: 1,
      roommateId: 1,
      dueDate: "2026-03-13"
    });

    await taskService.updateAssignmentStatusAsync(first!.id, "done", null);
    await taskService.updateAssignmentStatusAsync(second!.id, "done", null);

    expect(await taskService.getRoommateStreakSummaryAsync(1)).toEqual({
      currentStreak: 2,
      bestStreak: 2
    });

    await taskService.updateAssignmentStatusAsync(third!.id, "skipped", "missed");

    expect(await taskService.getRoommateStreakSummaryAsync(1)).toEqual({
      currentStreak: 0,
      bestStreak: 2
    });
  });
});
