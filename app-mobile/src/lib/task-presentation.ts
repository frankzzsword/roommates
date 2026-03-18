import type { TaskMode, UiChore } from "@/src/lib/types";

export function formatTaskMode(taskMode: TaskMode) {
  return taskMode === "rolling_until_done" ? "Rolling ownership" : "Fixed schedule";
}

export function getTaskTone(task: UiChore) {
  if (task.accountabilityState === "owner_owes_repeat_turn" || task.status === "rescued") {
    return "warning" as const;
  }

  if (task.accountabilityState === "escalated" || task.status === "overdue") {
    return "danger" as const;
  }

  if (task.status === "done") {
    return "success" as const;
  }

  if (task.accountabilityState === "reminder_sent") {
    return "accent" as const;
  }

  return "neutral" as const;
}

export function getTaskHeadline(task: UiChore) {
  if (task.resolutionType === "rescued" && task.rescuedByRoommate) {
    return `Rescued by ${task.rescuedByRoommate}`;
  }

  if (task.accountabilityState === "owner_owes_repeat_turn") {
    return `${task.responsibleRoommate} still owes the next turn`;
  }

  if (task.accountabilityState === "escalated") {
    return `Escalated after ${task.escalationLevel} reminder steps`;
  }

  if (task.accountabilityState === "reminder_sent") {
    return "Reminder already sent";
  }

  if (task.status === "done") {
    return "Completed cleanly";
  }

  if (task.status === "skipped") {
    return "Skipped and logged";
  }

  return "Waiting on current owner";
}

export function getTaskBadge(task: UiChore) {
  if (task.accountabilityState === "owner_owes_repeat_turn") {
    return "Owner owes repeat";
  }

  if (task.accountabilityState === "escalated") {
    return "Escalated";
  }

  if (task.resolutionType === "rescued") {
    return "Rescued";
  }

  if (task.accountabilityState === "reminder_sent") {
    return "Reminder sent";
  }

  if (task.status === "done") {
    return "Done";
  }

  if (task.status === "skipped") {
    return "Skipped";
  }

  return task.taskMode === "rolling_until_done" ? "Rolling" : "Scheduled";
}
