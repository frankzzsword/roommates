import { composeWhatsappConversationMessage } from "./ai-service.js";
import { config } from "../config.js";
import { rememberLastOutboundAssignment } from "./message-service.js";
import {
  addEventLog,
  getAssignmentsDueForCompletionCheck,
  getAssignmentsDueForEscalationNudge,
  getAssignmentsDueForDayOfReminder,
  getAssignmentsDueForTwoDayReminder,
  getAssignmentsDueForWeeklyHeadsUp,
  hasConversationPromptBeenSent,
  markReminderSent
} from "./task-service.js";
import {
  resolveOutboundWhatsappNumber,
  sendWhatsappMessage
} from "./twilio-service.js";

async function runReminderTick() {
  if (!config.enableOutboundReminders) {
    return;
  }

  const now = new Date();
  const reminderGroups = [
    {
      promptType: "weekly_heads_up",
      kind: "weekly_heads_up" as const,
      assignments: getAssignmentsDueForWeeklyHeadsUp(now)
    },
    {
      promptType: "two_day_reminder",
      kind: "two_day_reminder" as const,
      assignments: getAssignmentsDueForTwoDayReminder(now)
    },
    {
      promptType: "day_of_reminder",
      kind: "day_of_reminder" as const,
      assignments: getAssignmentsDueForDayOfReminder(now)
    }
  ];

  for (const group of reminderGroups) {
    for (const assignment of group.assignments) {
      const outboundTo = resolveOutboundWhatsappNumber(assignment.whatsappNumber);
      const composed = await composeWhatsappConversationMessage({
        kind: group.kind,
        roommateName: assignment.roommateName,
        choreTitle: assignment.choreTitle,
        dueDate: assignment.dueDate
      });
      const message = composed.text;

      try {
        await sendWhatsappMessage(assignment.whatsappNumber, message);
        rememberLastOutboundAssignment(outboundTo, assignment.id);
        if (group.promptType === "day_of_reminder") {
          markReminderSent(assignment.id);
        }
        addEventLog({
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
        addEventLog({
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
        addEventLog({
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

  const followUpAssignments = getAssignmentsDueForCompletionCheck(now);

  for (const assignment of followUpAssignments) {
    if (hasConversationPromptBeenSent(assignment.id, "completion_check")) {
      continue;
    }

    const outboundTo = resolveOutboundWhatsappNumber(assignment.whatsappNumber);
    const composed = await composeWhatsappConversationMessage({
      kind: "completion_check",
      roommateName: assignment.roommateName,
      choreTitle: assignment.choreTitle,
      dueDate: assignment.dueDate
    });

    try {
      await sendWhatsappMessage(assignment.whatsappNumber, composed.text);
      rememberLastOutboundAssignment(outboundTo, assignment.id);
      addEventLog({
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
      addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "FOLLOW_UP_FAILED",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }

  const escalationAssignments = getAssignmentsDueForEscalationNudge(now);

  for (const assignment of escalationAssignments) {
    const outboundTo = resolveOutboundWhatsappNumber(assignment.whatsappNumber);
    const composed = await composeWhatsappConversationMessage({
      kind: "escalation_nudge",
      roommateName: assignment.roommateName,
      choreTitle: assignment.choreTitle,
      dueDate: assignment.dueDate
    });

    try {
      await sendWhatsappMessage(assignment.whatsappNumber, composed.text);
      rememberLastOutboundAssignment(outboundTo, assignment.id);
      addEventLog({
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
      addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "FOLLOW_UP_FAILED",
        payload: JSON.stringify({
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }
}

export function startScheduler() {
  void runReminderTick();

  const everyFiveMinutes = 5 * 60 * 1000;
  setInterval(() => {
    void runReminderTick();
  }, everyFiveMinutes);
}
