import express from "express";
import type { NextFunction, Request, Response } from "express";
import { analyzeHouseholdFlowWithAi, suggestSubtasksWithAi } from "./services/ai-service.js";
import { initializeDatabase } from "./db/init.js";
import "./db/seed.js";
import {
  createAssignmentRecord,
  createChoreRecord,
  createPenaltyRecord,
  createPenaltyRuleRecord,
  createRoommateRecord,
  getHouseholdSnapshot,
  sendTestReminder,
  updateAssignmentRecord,
  updateChoreRecord,
  updateHouseSettingsRecord,
  updatePenaltyRecord,
  updatePenaltyRuleRecord,
  updateRoommateRecord
} from "./services/household-service.js";
import { processInboundMessage } from "./services/message-service.js";
import { buildTwimlMessage } from "./services/twilio-service.js";
import {
  findRoommateByCredentials,
  getRoommateById,
  listAssignments,
  listRecentEvents,
  listRoommates
} from "./services/task-service.js";

initializeDatabase();

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asNullableNumber(value: unknown) {
  if (value === null) {
    return null;
  }

  return asNumber(value);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asRequiredString(value: unknown) {
  const parsed = asString(value)?.trim();
  return parsed ? parsed : undefined;
}

function asNullableString(value: unknown) {
  if (value === null) {
    return null;
  }

  return asString(value);
}

function asBooleanInt(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (value === 1 || value === 0) {
    return value;
  }

  if (value === "true") {
    return 1;
  }

  if (value === "false") {
    return 0;
  }

  const parsed = Number(value);
  if (parsed === 1 || parsed === 0) {
    return parsed;
  }

  return undefined;
}

function asFrequencyUnit(value: unknown) {
  const unit = asString(value);
  if (unit === "day" || unit === "week" || unit === "month") {
    return unit;
  }

  return undefined;
}

function asTaskMode(value: unknown) {
  const taskMode = asString(value);
  if (taskMode === "fixed_schedule" || taskMode === "rolling_until_done") {
    return taskMode;
  }

  return undefined;
}

function asAdvanceRotationOn(value: unknown) {
  const mode = asString(value);
  if (mode === "completed_only" || mode === "rescue_keeps_owner") {
    return mode;
  }

  return undefined;
}

function asResolutionType(value: unknown) {
  const resolutionType = asString(value);
  if (resolutionType === "done" || resolutionType === "rescued" || resolutionType === "skipped") {
    return resolutionType;
  }

  return undefined;
}

function asPositiveNumber(value: unknown) {
  const parsed = asNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  return parsed > 0 ? parsed : undefined;
}

export function createApp() {
  const app = express();

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  });

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "roommate-chores-bot",
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/household", (_req, res) => {
    res.json(getHouseholdSnapshot());
  });

  app.get("/api/events", (_req, res) => {
    res.json({ events: listRecentEvents(25) });
  });

  app.get("/api/assignments", (_req, res) => {
    res.json({ assignments: listAssignments() });
  });

  app.get("/api/roommates", (_req, res) => {
    res.json({ roommates: listRoommates() });
  });

  app.post("/api/login", (req, res) => {
    const name = asRequiredString(req.body.name);
    const password = asRequiredString(req.body.password);

    if (!name || !password) {
      res.status(400).json({ error: "Name and password are required." });
      return;
    }

    const roommate = findRoommateByCredentials(name, password);
    if (!roommate) {
      res.status(401).json({ error: "Incorrect name or password." });
      return;
    }

    res.json({ roommate });
  });

  app.post("/api/roommates", (req, res) => {
    const roommate = createRoommateRecord({
      name: String(req.body.name ?? ""),
      whatsappNumber: String(req.body.whatsappNumber ?? ""),
      isActive: asBooleanInt(req.body.isActive),
      sortOrder: asNumber(req.body.sortOrder),
      reminderEnabled: asBooleanInt(req.body.reminderEnabled),
      reminderHour: asNumber(req.body.reminderHour),
      reminderLeadMinutes: asNumber(req.body.reminderLeadMinutes),
      notes: asNullableString(req.body.notes)
    });

    res.status(201).json({ roommate });
  });

  app.patch("/api/roommates/:id", (req, res) => {
    const roommate = updateRoommateRecord(Number(req.params.id), {
      name: asString(req.body.name),
      whatsappNumber: asString(req.body.whatsappNumber),
      isActive: asBooleanInt(req.body.isActive),
      sortOrder: asNumber(req.body.sortOrder),
      reminderEnabled: asBooleanInt(req.body.reminderEnabled),
      reminderHour: asNumber(req.body.reminderHour),
      reminderLeadMinutes: asNumber(req.body.reminderLeadMinutes),
      notes: asNullableString(req.body.notes)
    });

    res.json({ roommate });
  });

  app.post("/api/chores", (req, res) => {
    const chore = createChoreRecord({
      title: String(req.body.title ?? ""),
      description: asNullableString(req.body.description),
      cadence: asString(req.body.cadence) ?? "",
      area: asString(req.body.area),
      points: asPositiveNumber(req.body.points),
      frequencyInterval: asPositiveNumber(req.body.frequencyInterval),
      frequencyUnit: asFrequencyUnit(req.body.frequencyUnit),
      taskMode: asTaskMode(req.body.taskMode),
      softReminderAfterHours: asPositiveNumber(req.body.softReminderAfterHours),
      repeatReminderEveryHours: asPositiveNumber(req.body.repeatReminderEveryHours),
      escalateAfterHours: asPositiveNumber(req.body.escalateAfterHours),
      advanceRotationOn: asAdvanceRotationOn(req.body.advanceRotationOn),
      isOptional: asBooleanInt(req.body.isOptional),
      parentChoreId: asNullableNumber(req.body.parentChoreId),
      defaultDueHour: asNumber(req.body.defaultDueHour),
      defaultAssigneeId: asNullableNumber(req.body.defaultAssigneeId),
      isActive: asBooleanInt(req.body.isActive),
      reminderLeadMinutes: asNumber(req.body.reminderLeadMinutes),
      penaltyRuleId: asNullableNumber(req.body.penaltyRuleId)
    });

    res.status(201).json({ chore });
  });

  app.patch("/api/chores/:id", (req, res) => {
    const chore = updateChoreRecord(Number(req.params.id), {
      title: asString(req.body.title),
      description: asNullableString(req.body.description),
      cadence: asString(req.body.cadence),
      area: asString(req.body.area),
      points: asPositiveNumber(req.body.points),
      frequencyInterval: asPositiveNumber(req.body.frequencyInterval),
      frequencyUnit: asFrequencyUnit(req.body.frequencyUnit),
      taskMode: asTaskMode(req.body.taskMode),
      softReminderAfterHours: asPositiveNumber(req.body.softReminderAfterHours),
      repeatReminderEveryHours: asPositiveNumber(req.body.repeatReminderEveryHours),
      escalateAfterHours: asPositiveNumber(req.body.escalateAfterHours),
      advanceRotationOn: asAdvanceRotationOn(req.body.advanceRotationOn),
      isOptional: asBooleanInt(req.body.isOptional),
      parentChoreId: asNullableNumber(req.body.parentChoreId),
      defaultDueHour: asNumber(req.body.defaultDueHour),
      defaultAssigneeId: asNullableNumber(req.body.defaultAssigneeId),
      isActive: asBooleanInt(req.body.isActive),
      reminderLeadMinutes: asNumber(req.body.reminderLeadMinutes),
      penaltyRuleId: asNullableNumber(req.body.penaltyRuleId)
    });

    res.json({ chore });
  });

  app.post("/api/assignments", (req, res) => {
    const assignment = createAssignmentRecord({
      choreId: Number(req.body.choreId),
      roommateId: Number(req.body.roommateId),
      dueDate: String(req.body.dueDate),
      status: asString(req.body.status) as
        | "pending"
        | "done"
        | "skipped"
        | undefined,
      statusNote: asNullableString(req.body.statusNote),
      resolutionType: asResolutionType(req.body.resolutionType),
      responsibleRoommateId: asNumber(req.body.responsibleRoommateId),
      rescuedByRoommateId: asNullableNumber(req.body.rescuedByRoommateId),
      escalationLevel: asNumber(req.body.escalationLevel),
      strikeApplied: asNumber(req.body.strikeApplied),
      rescueCreditApplied: asNumber(req.body.rescueCreditApplied)
    });

    res.status(201).json({ assignment });
  });

  app.patch("/api/assignments/:id", (req, res) => {
    const assignment = updateAssignmentRecord(Number(req.params.id), {
      choreId: asNumber(req.body.choreId),
      roommateId: asNumber(req.body.roommateId),
      dueDate: asString(req.body.dueDate),
      status: asString(req.body.status) as
        | "pending"
        | "done"
        | "skipped"
        | undefined,
      statusNote: asNullableString(req.body.statusNote),
      resolutionType: asResolutionType(req.body.resolutionType),
      responsibleRoommateId: asNumber(req.body.responsibleRoommateId),
      rescuedByRoommateId: asNullableNumber(req.body.rescuedByRoommateId),
      escalationLevel: asNumber(req.body.escalationLevel),
      strikeApplied: asNumber(req.body.strikeApplied),
      rescueCreditApplied: asNumber(req.body.rescueCreditApplied)
    });

    res.json({ assignment });
  });

  app.patch("/api/settings", (req, res) => {
    const settings = updateHouseSettingsRecord({
      houseName: asString(req.body.houseName),
      timezone: asString(req.body.timezone),
      autoRemindersEnabled: asBooleanInt(req.body.autoRemindersEnabled),
      weeklySummaryEnabled: asBooleanInt(req.body.weeklySummaryEnabled),
      summaryDay: asString(req.body.summaryDay),
      summaryHour: asNumber(req.body.summaryHour),
      defaultPenaltyAmountCents: asNumber(req.body.defaultPenaltyAmountCents),
      defaultReminderLeadMinutes: asNumber(req.body.defaultReminderLeadMinutes),
      penaltyLabel: asString(req.body.penaltyLabel),
      weeklyAchievementLabel: asString(req.body.weeklyAchievementLabel),
      monthlyAchievementLabel: asString(req.body.monthlyAchievementLabel)
    });

    res.json({ settings });
  });

  app.post("/api/penalty-rules", (req, res) => {
    const penaltyRule = createPenaltyRuleRecord({
      title: String(req.body.title ?? ""),
      description: asNullableString(req.body.description),
      triggerType: asString(req.body.triggerType) as
        | "missed"
        | "skipped"
        | "manual"
        | undefined,
      amountCents: Number(req.body.amountCents ?? 0),
      isActive: asBooleanInt(req.body.isActive)
    });

    res.status(201).json({ penaltyRule });
  });

  app.patch("/api/penalty-rules/:id", (req, res) => {
    const penaltyRule = updatePenaltyRuleRecord(Number(req.params.id), {
      title: asString(req.body.title),
      description: asNullableString(req.body.description),
      triggerType: asString(req.body.triggerType) as
        | "missed"
        | "skipped"
        | "manual"
        | undefined,
      amountCents: asNumber(req.body.amountCents),
      isActive: asBooleanInt(req.body.isActive)
    });

    res.json({ penaltyRule });
  });

  app.post("/api/penalties", (req, res) => {
    const penalty = createPenaltyRecord({
      roommateId: Number(req.body.roommateId),
      assignmentId: asNullableNumber(req.body.assignmentId),
      ruleId: asNullableNumber(req.body.ruleId),
      reason: asNullableString(req.body.reason),
      amountCents: asNumber(req.body.amountCents),
      status: asString(req.body.status) as "open" | "waived" | "paid" | undefined
    });

    res.status(201).json({ penalty });
  });

  app.patch("/api/penalties/:id", (req, res) => {
    const penalty = updatePenaltyRecord(Number(req.params.id), {
      reason: asNullableString(req.body.reason),
      amountCents: asNumber(req.body.amountCents),
      status: asString(req.body.status) as "open" | "waived" | "paid" | undefined
    });

    res.json({ penalty });
  });

  app.post("/api/reminders/test", async (req, res, next) => {
    try {
      const result = await sendTestReminder({
        roommateId: asNumber(req.body.roommateId),
        to: asString(req.body.to),
        message: asString(req.body.message)
      });
      res.json({ result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/app-message", async (req, res, next) => {
    try {
      const roommateId = asNumber(req.body.roommateId);
      const body = asRequiredString(req.body.body);

      if (!roommateId || !body) {
        res.status(400).json({ error: "roommateId and body are required." });
        return;
      }

      const roommate = getRoommateById(roommateId);
      if (!roommate) {
        res.status(404).json({ error: "Roommate not found." });
        return;
      }

      const result = await processInboundMessage({
        from: roommate.whatsappNumber,
        body
      });

      res.json({ result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ai/subtasks/suggest", async (req, res, next) => {
    try {
      const result = await suggestSubtasksWithAi({
        title: String(req.body.title ?? ""),
        description: asString(req.body.description) ?? "",
        area: asString(req.body.area) ?? "Shared space",
        taskMode: asTaskMode(req.body.taskMode) ?? "fixed_schedule"
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/ai/house-analysis", async (_req, res, next) => {
    try {
      const result = await analyzeHouseholdFlowWithAi(getHouseholdSnapshot());
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/webhooks/twilio/whatsapp", async (req, res, next) => {
    try {
      const from = String(req.body.From ?? "");
      const body = String(req.body.Body ?? "");
      const result = await processInboundMessage({ from, body });
      const twiml = buildTwimlMessage(result.message);

      res.type("text/xml").send(twiml);
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      _next: NextFunction
    ) => {
      const message = error instanceof Error ? error.message : "Unknown server error";
      res.status(500).json({ error: message });
    }
  );

  return app;
}
