import express from "express";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { analyzeHouseholdFlowWithAi, suggestSubtasksWithAi } from "./services/ai-service.js";
import {
  createAssignmentRecord,
  createChoreRecord,
  createExpenseRecord,
  createPenaltyRecord,
  createPenaltyRuleRecord,
  createRoommateRecord,
  createSettlementRecord,
  sendTestReminder,
  getHouseholdSnapshotAsync,
  updateAssignmentRecord,
  updateChoreRecord,
  updateHouseSettingsRecord,
  updatePenaltyRecord,
  updatePenaltyRuleRecord,
  updateRoommateRecord
} from "./services/household-service.js";
import {
  notifyHouseExpenseAddedAsync,
  notifyHouseSettlementAddedAsync,
  processInboundMessage
} from "./services/message-service.js";
import {
  getWhatsappClientStatus,
  initializeWhatsappClient,
  sendWhatsappMessageDirect
} from "./services/whatsapp-service.js";
import {
  createAssignmentAsync,
  createExpenseAsync,
  createSettlementAsync,
  findRoommateByCredentialsAsync,
  getRoommateByIdAsync,
  listAssignmentsAsync,
  listRecentEventsAsync,
  listRoommatesAsync,
  updateAssignmentAsync
} from "./services/task-service-async.js";

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

  app.get("/api/household", async (_req, res, next) => {
    try {
      res.json(await getHouseholdSnapshotAsync());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/events", async (_req, res, next) => {
    try {
      res.json({ events: await listRecentEventsAsync(25) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/assignments", async (_req, res, next) => {
    try {
      res.json({ assignments: await listAssignmentsAsync() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/roommates", async (_req, res, next) => {
    try {
      res.json({ roommates: await listRoommatesAsync() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/login", async (req, res, next) => {
    const name = asRequiredString(req.body.name);
    const password = asRequiredString(req.body.password);

    if (!name || !password) {
      res.status(400).json({ error: "Name and password are required." });
      return;
    }

    if (
      name.toLowerCase() === config.adminLoginName.toLowerCase() &&
      password === config.adminLoginPassword
    ) {
      res.json({
        accountType: "admin",
        displayName: config.adminDisplayName
      });
      return;
    }

    try {
      const roommate = await findRoommateByCredentialsAsync(name, password);
      if (!roommate) {
        res.status(401).json({ error: "Incorrect name or password." });
        return;
      }

      res.json({
        accountType: "roommate",
        displayName: roommate.name,
        roommate
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/roommates", async (req, res, next) => {
    try {
      const roommate = await createRoommateRecord({
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
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/roommates/:id", async (req, res, next) => {
    try {
      const roommate = await updateRoommateRecord(Number(req.params.id), {
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
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chores", async (req, res, next) => {
    try {
      const chore = await createChoreRecord({
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
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/chores/:id", async (req, res, next) => {
    try {
      const chore = await updateChoreRecord(Number(req.params.id), {
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
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assignments", async (req, res, next) => {
    try {
      const assignment = await createAssignmentAsync({
        choreId: Number(req.body.choreId),
        roommateId: Number(req.body.roommateId),
        dueDate: String(req.body.dueDate),
        windowStartDate: asNullableString(req.body.windowStartDate),
        windowEndDate: asNullableString(req.body.windowEndDate),
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
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/assignments/:id", async (req, res, next) => {
    try {
      const assignment = await updateAssignmentAsync(Number(req.params.id), {
        choreId: asNumber(req.body.choreId),
        roommateId: asNumber(req.body.roommateId),
        dueDate: asString(req.body.dueDate),
        windowStartDate: asNullableString(req.body.windowStartDate),
        windowEndDate: asNullableString(req.body.windowEndDate),
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
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/settings", async (req, res, next) => {
    try {
      const settings = await updateHouseSettingsRecord({
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
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/penalty-rules", async (req, res, next) => {
    try {
      const penaltyRule = await createPenaltyRuleRecord({
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
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/penalty-rules/:id", async (req, res, next) => {
    try {
      const penaltyRule = await updatePenaltyRuleRecord(Number(req.params.id), {
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
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/penalties", async (req, res, next) => {
    try {
      const penalty = await createPenaltyRecord({
        roommateId: Number(req.body.roommateId),
        assignmentId: asNullableNumber(req.body.assignmentId),
        ruleId: asNullableNumber(req.body.ruleId),
        reason: asNullableString(req.body.reason),
        amountCents: asNumber(req.body.amountCents),
        status: asString(req.body.status) as "open" | "waived" | "paid" | undefined
      });

      res.status(201).json({ penalty });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/expenses", async (req, res, next) => {
    try {
      const title = asRequiredString(req.body.title);
      const amountCents = asPositiveNumber(req.body.amountCents);
      const paidByRoommateId = asPositiveNumber(req.body.paidByRoommateId);
      const includedRoommateIds = Array.isArray(req.body.includedRoommateIds)
        ? req.body.includedRoommateIds
            .map((value: unknown) => Number(value))
            .filter(Number.isFinite)
        : [];

      if (!title || !amountCents || !paidByRoommateId || includedRoommateIds.length === 0) {
        res.status(400).json({ error: "Title, amount, payer, and participants are required." });
        return;
      }

      const expense = await createExpenseAsync({
        title,
        amountCents,
        paidByRoommateId,
        note: asNullableString(req.body.note),
        includedRoommateIds
      });
      if (expense) {
        await notifyHouseExpenseAddedAsync(expense);
      }

      res.status(201).json({ expense });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/settlements", async (req, res, next) => {
    try {
      const fromRoommateId = asPositiveNumber(req.body.fromRoommateId);
      const toRoommateId = asPositiveNumber(req.body.toRoommateId);
      const amountCents = asPositiveNumber(req.body.amountCents);

      if (!fromRoommateId || !toRoommateId || !amountCents) {
        res.status(400).json({ error: "Settlement requires sender, receiver, and amount." });
        return;
      }

      const settlement = await createSettlementAsync({
        fromRoommateId,
        toRoommateId,
        amountCents,
        note: asNullableString(req.body.note)
      });
      if (settlement) {
        await notifyHouseSettlementAddedAsync(settlement);
      }

      res.status(201).json({ settlement });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/penalties/:id", async (req, res, next) => {
    try {
      const penalty = await updatePenaltyRecord(Number(req.params.id), {
        reason: asNullableString(req.body.reason),
        amountCents: asNumber(req.body.amountCents),
        status: asString(req.body.status) as "open" | "waived" | "paid" | undefined
      });

      res.json({ penalty });
    } catch (error) {
      next(error);
    }
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

      const roommate = await getRoommateByIdAsync(roommateId);
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
      const result = await analyzeHouseholdFlowWithAi(await getHouseholdSnapshotAsync());
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/whatsapp/status", (_req, res) => {
    res.json({
      whatsapp: getWhatsappClientStatus()
    });
  });

  app.post("/api/whatsapp/reconnect", async (_req, res, next) => {
    try {
      await initializeWhatsappClient();
      res.json({
        ok: true,
        whatsapp: getWhatsappClientStatus()
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/internal/whatsapp/send", async (req, res, next) => {
    try {
      const providedKey = String(req.headers["x-whatsapp-internal-key"] ?? "");
      if (!config.whatsappInternalApiKey || providedKey !== config.whatsappInternalApiKey) {
        res.status(401).json({ error: "Unauthorized internal WhatsApp send request." });
        return;
      }

      const to = asRequiredString(req.body.to);
      const body = asRequiredString(req.body.body);
      if (!to || !body) {
        res.status(400).json({ error: "to and body are required." });
        return;
      }

      const result = await sendWhatsappMessageDirect(to, body);
      res.json({ ok: true, result });
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
