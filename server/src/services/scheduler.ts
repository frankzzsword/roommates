import { config } from "../config.js";
import { rememberLastOutboundAssignment } from "./message-service.js";
import {
  addEventLog,
  getAssignmentsDueForReminder,
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
    const message = [
      `Reminder: ${assignment.choreTitle} is coming up.`,
      `Due date: ${assignment.dueDate}`,
      `Reply DONE ${assignment.id} when finished.`,
      `Reply SKIP ${assignment.id} <reason> if you cannot do it.`,
      `Natural language also works: "I can't do it today, skip".`
    ].join("\n");

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
}

export function startScheduler() {
  void runReminderTick();

  const everyFiveMinutes = 5 * 60 * 1000;
  setInterval(() => {
    void runReminderTick();
  }, everyFiveMinutes);
}
