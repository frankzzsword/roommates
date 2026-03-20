import { composeWhatsappConversationMessage } from "./ai-service.js";
import { config } from "../config.js";
import { rememberLastOutboundAssignment } from "./message-service.js";
import {
  addEventLogAsync as addEventLog,
  applyMissedWeeklyStrikeAsync as applyMissedWeeklyStrike,
  getAssignmentsDueForRescueFallbackAsync as getAssignmentsDueForRescueFallback,
  getAssignmentsDueForAutoStrikeAsync as getAssignmentsDueForAutoStrike,
  getAssignmentsDueForCompletionCheckAsync as getAssignmentsDueForCompletionCheck,
  getAssignmentsDueForEscalationNudgeAsync as getAssignmentsDueForEscalationNudge,
  getAssignmentsDueForDayOfReminderAsync as getAssignmentsDueForDayOfReminder,
  getAssignmentsDueForTwoDayReminderAsync as getAssignmentsDueForTwoDayReminder,
  getHouseSettingsAsync as getHouseSettings,
  handoffAssignmentToNextRoommateAsync as handoffAssignmentToNextRoommate,
  hasRoommateConversationPromptBeenSentTodayAsync as hasRoommateConversationPromptBeenSentToday,
  hasConversationPromptBeenSentAsync as hasConversationPromptBeenSent,
  listPendingAssignmentsForRoommateAsync as listPendingAssignmentsForRoommate,
  listRoommatesAsync as listRoommates,
  markReminderSentAsync as markReminderSent
} from "./task-service-async.js";
import {
  resolveOutboundWhatsappNumber,
  sendWhatsappMessage
} from "./twilio-service.js";

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
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short"
  }).format(value);
}

function hourInTimezone(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit"
  }).formatToParts(value);
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

function addDaysToIsoDate(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekRangeMondayInTimezone(now: Date, timezone: string) {
  const today = isoDateInTimezone(now, timezone);
  const weekdayShort = weekdayInTimezone(now, timezone).slice(0, 3).toLowerCase();
  const weekdayLookup: Record<string, number> = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };
  const weekday = weekdayLookup[weekdayShort] ?? 1;
  const daysSinceMonday = (weekday + 6) % 7;
  const start = addDaysToIsoDate(today, -daysSinceMonday);
  return {
    start,
    end: addDaysToIsoDate(start, 6)
  };
}

function isIsoDateWithinRange(value: string, start: string, end: string) {
  return value >= start && value <= end;
}

function formatDueLabel(dueDate: string, timezone: string) {
  const date = new Date(`${dueDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return dueDate;
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short"
  }).format(date);
}

function buildWeeklyOverviewMessage(input: {
  roommateName: string;
  tasks: Array<{ choreTitle: string; dueDate: string }>;
  timezone: string;
}) {
  if (input.tasks.length === 0) {
    return `Hey ${input.roommateName} 🙂 quick Monday check, you’re clear for this week right now. I’ll ping you only if something gets reassigned.`;
  }

  const lines = input.tasks
    .slice(0, 7)
    .map((task) => `• ${task.choreTitle} by ${formatDueLabel(task.dueDate, input.timezone)}`);

  return [
    `Hey ${input.roommateName} 🙂 here’s your task overview for this week.`,
    ...lines,
    "I’ll only remind you within this week: two days before and again on the due day 😅"
  ].join("\n");
}

async function runWeeklyOverviewTick(now: Date) {
  const settings = await getHouseSettings();
  if (!settings.autoRemindersEnabled || !settings.weeklySummaryEnabled) {
    return;
  }

  const timezone = settings.timezone || config.defaultTimezone || "Europe/Berlin";
  if (weekdayInTimezone(now, timezone) !== "Mon") {
    return;
  }

  const summaryHour = Number.isFinite(settings.summaryHour) ? settings.summaryHour : 14;
  if (hourInTimezone(now, timezone) < summaryHour) {
    return;
  }

  const week = weekRangeMondayInTimezone(now, timezone);
  const roommates = (await listRoommates()).filter(
    (roommate) => Boolean(roommate.isActive) && Boolean(roommate.reminderEnabled)
  );

  for (const roommate of roommates) {
    const alreadySent = await hasRoommateConversationPromptBeenSentToday({
      roommateId: roommate.id,
      promptType: "weekly_overview",
      now,
      timezone
    });
    if (alreadySent) {
      continue;
    }

    const tasks = (await listPendingAssignmentsForRoommate(roommate.id))
      .filter((assignment) => isIsoDateWithinRange(assignment.dueDate, week.start, week.end))
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
    const outboundTo = resolveOutboundWhatsappNumber(roommate.whatsappNumber);
    const message = buildWeeklyOverviewMessage({
      roommateName: roommate.name,
      tasks,
      timezone
    });

    try {
      await sendWhatsappMessage(roommate.whatsappNumber, message);
      await addEventLog({
        roommateId: roommate.id,
        assignmentId: null,
        eventType: "CONVERSATION_MESSAGE_SENT",
        payload: JSON.stringify({
          promptType: "weekly_overview",
          originalTo: roommate.whatsappNumber,
          effectiveTo: outboundTo,
          taskCount: tasks.length
        })
      });
    } catch (error) {
      await addEventLog({
        roommateId: roommate.id,
        assignmentId: null,
        eventType: "REMINDER_FAILED",
        payload: JSON.stringify({
          promptType: "weekly_overview",
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }
}

async function runReminderTick() {
  if (!config.enableOutboundReminders) {
    return;
  }

  const now = new Date();
  await runWeeklyOverviewTick(now);
  const reminderGroups = [
    {
      promptType: "two_day_reminder",
      kind: "two_day_reminder" as const,
      assignments: await getAssignmentsDueForTwoDayReminder(now)
    },
    {
      promptType: "day_of_reminder",
      kind: "day_of_reminder" as const,
      assignments: await getAssignmentsDueForDayOfReminder(now)
    }
  ];

  for (const group of reminderGroups) {
    for (const assignment of group.assignments) {
      const outboundTo = resolveOutboundWhatsappNumber(assignment.whatsappNumber);
      const composed = await composeWhatsappConversationMessage({
        kind: group.kind,
        roommateName: assignment.roommateName,
        choreTitle: assignment.choreTitle,
        dueDate: assignment.dueDate,
        contextNote: assignment.statusNote
      });
      const message = composed.text;

      try {
        await sendWhatsappMessage(assignment.whatsappNumber, message);
        rememberLastOutboundAssignment(outboundTo, assignment.id);
        if (group.promptType === "day_of_reminder") {
          await markReminderSent(assignment.id);
        }
        await addEventLog({
          roommateId: assignment.roommateId,
          assignmentId: assignment.id,
          eventType: "REMINDER_SENT",
          payload: JSON.stringify({
            promptType: group.promptType,
            originalTo: assignment.whatsappNumber,
            effectiveTo: outboundTo,
            dueDate: assignment.dueDate,
            leadMinutes:
              assignment.roommateReminderLeadMinutes || assignment.reminderLeadMinutes
          })
        });
        await addEventLog({
          roommateId: assignment.roommateId,
          assignmentId: assignment.id,
          eventType: "CONVERSATION_MESSAGE_SENT",
          payload: JSON.stringify({
            promptType: group.promptType,
            originalTo: assignment.whatsappNumber,
            effectiveTo: outboundTo,
            source: composed.source,
            model: composed.model
          })
        });
      } catch (error) {
        console.error("Failed to send reminder", error);
        await addEventLog({
          roommateId: assignment.roommateId,
          assignmentId: assignment.id,
          eventType: "REMINDER_FAILED",
          payload: JSON.stringify({
            promptType: group.promptType,
            error: error instanceof Error ? error.message : "unknown"
          })
        });
      }
    }
  }

  const followUpAssignments = await getAssignmentsDueForCompletionCheck(now);

  for (const assignment of followUpAssignments) {
    if (await hasConversationPromptBeenSent(assignment.id, "completion_check")) {
      continue;
    }

    const outboundTo = resolveOutboundWhatsappNumber(assignment.whatsappNumber);
    const composed = await composeWhatsappConversationMessage({
      kind: "completion_check",
      roommateName: assignment.roommateName,
      choreTitle: assignment.choreTitle,
      dueDate: assignment.dueDate,
      contextNote: assignment.statusNote
    });

    try {
      await sendWhatsappMessage(assignment.whatsappNumber, composed.text);
      rememberLastOutboundAssignment(outboundTo, assignment.id);
      await addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "CONVERSATION_MESSAGE_SENT",
        payload: JSON.stringify({
          promptType: "completion_check",
          originalTo: assignment.whatsappNumber,
          effectiveTo: outboundTo,
          source: composed.source,
          model: composed.model
        })
      });
    } catch (error) {
      await addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "FOLLOW_UP_FAILED",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }

  const escalationAssignments = await getAssignmentsDueForEscalationNudge(now);

  for (const assignment of escalationAssignments) {
    const outboundTo = resolveOutboundWhatsappNumber(assignment.whatsappNumber);
    const composed = await composeWhatsappConversationMessage({
      kind: "escalation_nudge",
      roommateName: assignment.roommateName,
      choreTitle: assignment.choreTitle,
      dueDate: assignment.dueDate,
      contextNote: assignment.statusNote
    });

    try {
      await sendWhatsappMessage(assignment.whatsappNumber, composed.text);
      rememberLastOutboundAssignment(outboundTo, assignment.id);
      await addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "CONVERSATION_MESSAGE_SENT",
        payload: JSON.stringify({
          promptType: "escalation_nudge",
          originalTo: assignment.whatsappNumber,
          effectiveTo: outboundTo,
          source: composed.source,
          model: composed.model
        })
      });
    } catch (error) {
      await addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "FOLLOW_UP_FAILED",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }

  const strikeAssignments = await getAssignmentsDueForAutoStrike(now);

  for (const assignment of strikeAssignments) {
    try {
      const updated = await applyMissedWeeklyStrike(
        assignment.id,
        "missed the Friday cleaning window"
      );
      if (!updated) {
        continue;
      }

      await addEventLog({
        roommateId: updated.roommateId,
        assignmentId: updated.id,
        eventType: "AUTO_STRIKE_PROCESSED",
        payload: JSON.stringify({
          choreId: updated.choreId,
          dueDate: updated.dueDate
        })
      });
    } catch (error) {
      await addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "AUTO_STRIKE_FAILED",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }

  const rescueFallbackAssignments = await getAssignmentsDueForRescueFallback(now);

  for (const assignment of rescueFallbackAssignments) {
    try {
      const reassigned = await handoffAssignmentToNextRoommate(
        assignment.id,
        "nobody answered the house rescue request"
      );

      await addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "RESCUE_REQUEST_RESOLVED",
        payload: JSON.stringify({
          resolution: reassigned ? "fallback_handoff" : "carry_over"
        })
      });

      if (!reassigned) {
        continue;
      }

      const outboundTo = resolveOutboundWhatsappNumber(reassigned.whatsappNumber);
      const composed = await composeWhatsappConversationMessage({
        kind: "handoff_notice",
        roommateName: reassigned.roommateName,
        choreTitle: reassigned.choreTitle,
        dueDate: reassigned.dueDate,
        contextNote: "nobody else picked it up in time"
      });

      await sendWhatsappMessage(reassigned.whatsappNumber, composed.text);
      rememberLastOutboundAssignment(outboundTo, reassigned.id);
      await addEventLog({
        roommateId: reassigned.roommateId,
        assignmentId: reassigned.id,
        eventType: "HANDOFF_MESSAGE_SENT",
        payload: JSON.stringify({
          originalTo: reassigned.whatsappNumber,
          effectiveTo: outboundTo
        })
      });
      await addEventLog({
        roommateId: reassigned.roommateId,
        assignmentId: reassigned.id,
        eventType: "CONVERSATION_MESSAGE_SENT",
        payload: JSON.stringify({
          promptType: "handoff_notice",
          originalTo: reassigned.whatsappNumber,
          effectiveTo: outboundTo,
          source: composed.source,
          model: composed.model
        })
      });
    } catch (error) {
      await addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "RESCUE_REQUEST_FALLBACK_FAILED",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }
}

async function safeRunReminderTick() {
  try {
    await runReminderTick();
  } catch (error) {
    console.error("Reminder tick failed", error);
  }
}

export function startScheduler() {
  const everyFiveMinutes = 5 * 60 * 1000;
  const initialDelay = 15 * 1000;

  setTimeout(() => {
    void safeRunReminderTick();
  }, initialDelay);

  setInterval(() => {
    void safeRunReminderTick();
  }, everyFiveMinutes);
}
