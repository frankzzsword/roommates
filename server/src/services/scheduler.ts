import { composeWhatsappConversationMessage } from "./ai-service.js";
import { config } from "../config.js";
import { rememberLastOutboundAssignment } from "./message-service.js";
import {
  addEventLog,
  getAssignmentsDueForCompletionCheck,
  getAssignmentsDueForReminder,
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

  const dueAssignments = getAssignmentsDueForReminder(new Date());

  for (const assignment of dueAssignments) {
    const outboundTo = resolveOutboundWhatsappNumber(assignment.whatsappNumber);
    const composed = await composeWhatsappConversationMessage({
      kind: "assignment_reminder",
      roommateName: assignment.roommateName,
      choreTitle: assignment.choreTitle,
      dueDate: assignment.dueDate
    });
    const message = composed.text;

    try {
      await sendWhatsappMessage(assignment.whatsappNumber, message);
      rememberLastOutboundAssignment(outboundTo, assignment.id);
      markReminderSent(assignment.id);
      addEventLog({
        roommateId: assignment.roommateId,
        assignmentId: assignment.id,
        eventType: "REMINDER_SENT",
        payload: JSON.stringify({
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
          promptType: "assignment_reminder",
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
          error: error instanceof Error ? error.message : "unknown"
        })
      });
    }
  }

  const followUpAssignments = getAssignmentsDueForCompletionCheck(new Date());

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
}

export function startScheduler() {
  void runReminderTick();

  const everyFiveMinutes = 5 * 60 * 1000;
  setInterval(() => {
    void runReminderTick();
  }, everyFiveMinutes);
}
