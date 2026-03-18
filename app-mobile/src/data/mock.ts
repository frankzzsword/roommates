import type {
  FrequencyUnit,
  HouseholdSnapshot,
  UiChore,
  UiExpenseEntry,
  UiHouseSummary,
  UiBalanceEntry,
  UiPenaltyEntry,
  UiScoreboardEntry,
  UiTaskTemplate
} from "@/src/lib/types";

function formatFrequencyLabel(interval: number, unit: FrequencyUnit) {
  if (interval === 1) {
    return `Every ${unit}`;
  }

  const plural = `${unit}s`;
  return `Every ${interval} ${plural}`;
}

function formatRelative(dateInput: string) {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    return dateInput;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function buildPreviewSnapshot(): HouseholdSnapshot {
  const taskTemplates: UiTaskTemplate[] = [
    {
      id: "template-trash",
      title: "Take out trash",
      description: "Move kitchen and bathroom bins before collection day.",
      area: "Kitchen",
      assigneeId: "mayssa",
      assignee: "Mayssa",
      frequencyInterval: 2,
      frequencyUnit: "day",
      taskMode: "rolling_until_done",
      softReminderAfterHours: 48,
      repeatReminderEveryHours: 12,
      escalateAfterHours: 72,
      advanceRotationOn: "rescue_keeps_owner",
      cadenceLabel: formatFrequencyLabel(2, "day"),
      reminderEnabled: true,
      isOptionalSubtask: false,
      parentTemplateId: null,
      parentTemplateTitle: null,
      isActive: true
    },
    {
      id: "template-bathroom",
      title: "Bathroom reset",
      description: "Mirror, sink, surfaces, and a quick floor pass.",
      area: "Bathroom",
      assigneeId: "noah",
      assignee: "Noah",
      frequencyInterval: 1,
      frequencyUnit: "week",
      taskMode: "fixed_schedule",
      softReminderAfterHours: 24,
      repeatReminderEveryHours: 24,
      escalateAfterHours: 48,
      advanceRotationOn: "completed_only",
      cadenceLabel: formatFrequencyLabel(1, "week"),
      reminderEnabled: true,
      isOptionalSubtask: false,
      parentTemplateId: null,
      parentTemplateTitle: null,
      isActive: true
    },
    {
      id: "template-bathtub",
      title: "Deep clean bathtub",
      description: "Scrub tub, grout edges, and drain cover.",
      area: "Bathroom",
      assigneeId: "noah",
      assignee: "Noah",
      frequencyInterval: 1,
      frequencyUnit: "month",
      taskMode: "fixed_schedule",
      softReminderAfterHours: 48,
      repeatReminderEveryHours: 24,
      escalateAfterHours: 72,
      advanceRotationOn: "completed_only",
      cadenceLabel: formatFrequencyLabel(1, "month"),
      reminderEnabled: true,
      isOptionalSubtask: true,
      parentTemplateId: "template-bathroom",
      parentTemplateTitle: "Bathroom reset",
      isActive: true
    },
    {
      id: "template-hallway",
      title: "Vacuum hallway",
      description: "Quick pass plus entrance mat.",
      area: "Hallway",
      assigneeId: "varun",
      assignee: "Varun",
      frequencyInterval: 1,
      frequencyUnit: "week",
      taskMode: "fixed_schedule",
      softReminderAfterHours: 24,
      repeatReminderEveryHours: 24,
      escalateAfterHours: 48,
      advanceRotationOn: "completed_only",
      cadenceLabel: formatFrequencyLabel(1, "week"),
      reminderEnabled: false,
      isOptionalSubtask: false,
      parentTemplateId: null,
      parentTemplateTitle: null,
      isActive: true
    }
  ];

  const chores: UiChore[] = [
    {
      id: "trash-1",
      title: "Take out trash",
      description: "Bins need to be on the curb before collection.",
      assigneeId: "mayssa",
      assignee: "Mayssa",
      dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      dueLabel: "today at 20:00",
      cadence: "Every Tuesday and Friday",
      area: "Kitchen",
      points: 10,
      reminderEnabled: true,
      taskMode: "rolling_until_done",
      accountabilityState: "escalated",
      resolutionType: null,
      responsibleRoommateId: "mayssa",
      responsibleRoommate: "Mayssa",
      rescuedByRoommateId: null,
      rescuedByRoommate: null,
      escalationLevel: 2,
      strikeApplied: false,
      rescueCreditApplied: false,
      status: "overdue"
    },
    {
      id: "kitchen-1",
      title: "Deep clean kitchen",
      description: "Counters, sink, stove, and floor.",
      assigneeId: "varun",
      assignee: "Varun",
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      dueLabel: "tomorrow at 19:00",
      cadence: "Every Sunday",
      area: "Kitchen",
      points: 20,
      reminderEnabled: true,
      taskMode: "fixed_schedule",
      accountabilityState: "on_track",
      resolutionType: null,
      responsibleRoommateId: "varun",
      responsibleRoommate: "Varun",
      rescuedByRoommateId: null,
      rescuedByRoommate: null,
      escalationLevel: 0,
      strikeApplied: false,
      rescueCreditApplied: false,
      status: "pending"
    },
    {
      id: "bathroom-1",
      title: "Bathroom reset",
      description: "Wipe mirror, scrub sink, replace hand towels.",
      assigneeId: "noah",
      assignee: "Noah",
      dueAt: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
      dueLabel: "Thursday at 18:30",
      cadence: "Every Thursday",
      area: "Bathroom",
      points: 16,
      reminderEnabled: true,
      taskMode: "fixed_schedule",
      accountabilityState: "reminder_sent",
      resolutionType: null,
      responsibleRoommateId: "noah",
      responsibleRoommate: "Noah",
      rescuedByRoommateId: null,
      rescuedByRoommate: null,
      escalationLevel: 1,
      strikeApplied: false,
      rescueCreditApplied: false,
      status: "pending"
    },
    {
      id: "hallway-1",
      title: "Vacuum hallway",
      description: "Quick pass plus entrance mat.",
      assigneeId: "varun",
      assignee: "Varun",
      dueAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      dueLabel: "completed today",
      cadence: "Every Monday",
      area: "Hallway",
      points: 8,
      reminderEnabled: false,
      taskMode: "fixed_schedule",
      accountabilityState: "on_track",
      resolutionType: "done",
      responsibleRoommateId: "varun",
      responsibleRoommate: "Varun",
      rescuedByRoommateId: null,
      rescuedByRoommate: null,
      escalationLevel: 0,
      strikeApplied: false,
      rescueCreditApplied: false,
      status: "done"
    },
    {
      id: "dishwasher-1",
      title: "Unload dishwasher",
      description: "Current owner clears the machine when it fills up.",
      assigneeId: "noah",
      assignee: "Noah",
      dueAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      dueLabel: "rescued by Tracy 1h ago",
      cadence: "Rolling ownership",
      area: "Kitchen",
      points: 12,
      reminderEnabled: true,
      taskMode: "rolling_until_done",
      accountabilityState: "owner_owes_repeat_turn",
      resolutionType: "rescued",
      responsibleRoommateId: "noah",
      responsibleRoommate: "Noah",
      rescuedByRoommateId: "tracy",
      rescuedByRoommate: "Tracy",
      escalationLevel: 2,
      strikeApplied: true,
      rescueCreditApplied: true,
      status: "rescued"
    }
  ];

  const penalties: UiPenaltyEntry[] = [
    {
      id: "penalty-1",
      roommateId: "mayssa",
      roommateName: "Mayssa",
      reason: "Missed trash pickup window",
      amount: 5,
      amountLabel: "EUR 5",
      status: "owed",
      createdAt: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(),
      createdLabel: "Yesterday",
      dueLabel: "due Friday"
    },
    {
      id: "penalty-2",
      roommateId: "varun",
      roommateName: "Varun",
      reason: "Covered a missed bathroom swap",
      amount: 8,
      amountLabel: "EUR 8",
      status: "paid",
      createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(),
      createdLabel: "3 days ago",
      dueLabel: "settled"
    }
  ];

  const expenses: UiExpenseEntry[] = [
    {
      id: "expense-1",
      title: "Toilet paper",
      amount: 3.56,
      amountLabel: "€3.56",
      paidByRoommateId: "varun",
      paidByRoommateName: "Varun",
      note: "",
      createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      createdLabel: "6h ago",
      excludedRoommateIds: ["julia"],
      excludedRoommateNames: ["Julia"],
      shares: [
        { roommateId: "varun", roommateName: "Varun", share: 0.71, shareLabel: "€0.71" },
        { roommateId: "mayssa", roommateName: "Mayssa", share: 0.71, shareLabel: "€0.71" },
        { roommateId: "noah", roommateName: "Noah", share: 0.71, shareLabel: "€0.71" },
        { roommateId: "tracy", roommateName: "Tracy", share: 0.72, shareLabel: "€0.72" },
        { roommateId: "maria", roommateName: "Maria", share: 0.71, shareLabel: "€0.71" }
      ]
    }
  ];

  const balances: UiBalanceEntry[] = [
    {
      fromRoommateId: "mayssa",
      fromRoommateName: "Mayssa",
      toRoommateId: "varun",
      toRoommateName: "Varun",
      amount: 0.71,
      amountLabel: "€0.71"
    }
  ];

  return {
    houseName: "Kreuzberg Flat",
    activeRoommateId: "varun",
    roommates: [
      {
        id: "varun",
        name: "Varun",
        whatsappNumber: "whatsapp:+4917613420040",
        role: "Main renter and rota owner",
        note: "Prefers early evening reminders.",
        isActive: true,
        sortOrder: 1,
        reliability: 94,
        pendingCount: 1,
        completedCount: 4,
        missedCount: 0,
        strikeCount: 0,
        rescueCount: 1,
        reminderPreferences: {
          personalEnabled: true,
          dayBefore: true,
          dayOf: true,
          escalationEnabled: true,
          escalationHours: 3,
          reminderHour: 18,
          reminderLeadHours: 24,
          quietHoursStart: "22:00",
          quietHoursEnd: "07:30"
        }
      },
      {
        id: "mayssa",
        name: "Mayssa",
        whatsappNumber: "whatsapp:+491700000101",
        role: "Kitchen and surfaces",
        note: "Needs direct reminders on due day.",
        isActive: true,
        sortOrder: 2,
        reliability: 61,
        pendingCount: 1,
        completedCount: 2,
        missedCount: 2,
        strikeCount: 2,
        rescueCount: 0,
        reminderPreferences: {
          personalEnabled: true,
          dayBefore: false,
          dayOf: true,
          escalationEnabled: true,
          escalationHours: 1,
          reminderHour: 19,
          reminderLeadHours: 4,
          quietHoursStart: "23:00",
          quietHoursEnd: "08:00"
        }
      },
      {
        id: "noah",
        name: "Noah",
        whatsappNumber: "whatsapp:+491700000102",
        role: "Bathroom and supplies",
        note: "Usually does chores early.",
        isActive: true,
        sortOrder: 3,
        reliability: 88,
        pendingCount: 1,
        completedCount: 3,
        missedCount: 1,
        strikeCount: 1,
        rescueCount: 0,
        reminderPreferences: {
          personalEnabled: true,
          dayBefore: true,
          dayOf: true,
          escalationEnabled: false,
          escalationHours: 2,
          reminderHour: 17,
          reminderLeadHours: 12,
          quietHoursStart: "22:30",
          quietHoursEnd: "07:00"
        }
      },
      {
        id: "julia",
        name: "Julia",
        whatsappNumber: "whatsapp:+491700000103",
        role: "Shared spaces",
        note: "Flexible on timing.",
        isActive: true,
        sortOrder: 4,
        reliability: 82,
        pendingCount: 0,
        completedCount: 2,
        missedCount: 1,
        strikeCount: 1,
        rescueCount: 0,
        reminderPreferences: {
          personalEnabled: true,
          dayBefore: true,
          dayOf: true,
          escalationEnabled: false,
          escalationHours: 2,
          reminderHour: 18,
          reminderLeadHours: 12,
          quietHoursStart: "22:30",
          quietHoursEnd: "07:30"
        }
      },
      {
        id: "tracy",
        name: "Tracy",
        whatsappNumber: "whatsapp:+491700000104",
        role: "Trash and hallway",
        note: "Likes reminders on the same day.",
        isActive: true,
        sortOrder: 5,
        reliability: 79,
        pendingCount: 0,
        completedCount: 1,
        missedCount: 1,
        strikeCount: 0,
        rescueCount: 1,
        reminderPreferences: {
          personalEnabled: true,
          dayBefore: false,
          dayOf: true,
          escalationEnabled: true,
          escalationHours: 2,
          reminderHour: 18,
          reminderLeadHours: 4,
          quietHoursStart: "23:00",
          quietHoursEnd: "08:00"
        }
      },
      {
        id: "maria",
        name: "Maria",
        whatsappNumber: "whatsapp:+491700000105",
        role: "Bathroom backup",
        note: "Usually handles tasks early in the evening.",
        isActive: true,
        sortOrder: 6,
        reliability: 85,
        pendingCount: 0,
        completedCount: 2,
        missedCount: 0,
        strikeCount: 0,
        rescueCount: 0,
        reminderPreferences: {
          personalEnabled: true,
          dayBefore: true,
          dayOf: true,
          escalationEnabled: false,
          escalationHours: 2,
          reminderHour: 17,
          reminderLeadHours: 12,
          quietHoursStart: "22:00",
          quietHoursEnd: "07:00"
        }
      }
    ],
    taskTemplates,
    chores,
    activity: [
      {
        id: "activity-1",
        type: "reminder",
        title: "Reminder sent for trash duty",
        actor: "WhatsApp bot",
        timestamp: formatRelative(new Date(Date.now() - 30 * 60 * 1000).toISOString())
      },
      {
        id: "activity-2",
        type: "escalation",
        title: "Trash duty escalated after sitting full too long",
        actor: "Scoreboard",
        timestamp: formatRelative(new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString())
      },
      {
        id: "activity-3",
        type: "rescue",
        title: "Tracy rescued Noah's dishwasher turn and Noah still owes the next one",
        actor: "House log",
        timestamp: formatRelative(new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
      }
    ],
    penalties,
    expenses,
    balances,
    penaltyRule: {
      id: "rule-1",
      enabled: true,
      label: "Pay into house kitty",
      amount: 5,
      currency: "EUR",
      graceHours: 12,
      strikeThreshold: 1
    },
    settings: {
      autoReminders: true,
      weeklySummary: true,
      escalationEnabled: true,
      summaryDay: "Sunday",
      groupChatName: "Flat Chores",
      weeklyAchievementLabel: "Weekly Win",
      monthlyAchievementLabel: "Monthly House Hero"
    },
    lastSyncLabel: "Preview data"
  };
}

export function cloneSnapshot(snapshot: HouseholdSnapshot) {
  return JSON.parse(JSON.stringify(snapshot)) as HouseholdSnapshot;
}

export function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency
  }).format(amount);
}

export function getHouseSummary(snapshot: HouseholdSnapshot): UiHouseSummary {
  const completed = snapshot.chores.filter((chore) => chore.status === "done").length;
  const overdueCount = snapshot.chores.filter((chore) => chore.status === "overdue").length;
  const pendingCount = snapshot.chores.filter((chore) => chore.status === "pending").length;
  const rescuedCount = snapshot.chores.filter((chore) => chore.resolutionType === "rescued").length;
  const strikeCount = snapshot.roommates.reduce((total, roommate) => total + roommate.strikeCount, 0);
  const upcomingCount = snapshot.chores.filter(
    (chore) => chore.status === "pending" || chore.status === "overdue"
  ).length;
  const scoreboard = getScoreboard(snapshot);
  const weeklyChampion = scoreboard[0]?.roommateName ?? "No one yet";
  const monthlyChampion =
    [...scoreboard].sort((left, right) => right.monthlyScore - left.monthlyScore)[0]?.roommateName ??
    "No one yet";

  return {
    completionRate:
      snapshot.chores.length === 0 ? 0 : Math.round((completed / snapshot.chores.length) * 100),
    overdueCount,
    pendingCount,
    upcomingCount,
    rescuedCount,
    strikeCount,
    topPerformerName: weeklyChampion,
    topPerformerScore: scoreboard[0]?.totalScore ?? 0,
    weeklyChampion,
    monthlyChampion
  };
}

export function getActiveRoommate(snapshot: HouseholdSnapshot) {
  return (
    snapshot.roommates.find((roommate) => roommate.id === snapshot.activeRoommateId) ??
    snapshot.roommates[0]
  );
}

export function getRoommateAssignments(snapshot: HouseholdSnapshot, roommateId: string) {
  return snapshot.chores.filter((chore) => chore.assigneeId === roommateId);
}

export function getOutstandingPenalties(snapshot: HouseholdSnapshot, roommateId?: string) {
  return snapshot.penalties.filter(
    (penalty) =>
      penalty.status === "owed" && (!roommateId || penalty.roommateId === roommateId)
  );
}

export function getScoreboard(snapshot: HouseholdSnapshot): UiScoreboardEntry[] {
  return snapshot.roommates
    .map((roommate) => {
      const streakTimeline = snapshot.chores
        .filter((task) => task.responsibleRoommateId === roommate.id)
        .filter((task) => task.status !== "pending" && task.status !== "overdue")
        .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());

      let currentStreak = 0;
      let bestStreak = 0;
      for (const task of streakTimeline) {
        const successfulCompletion =
          task.responsibleRoommateId === roommate.id &&
          task.status === "done" &&
          !task.strikeApplied;

        if (successfulCompletion) {
          currentStreak += 1;
          bestStreak = Math.max(bestStreak, currentStreak);
        } else {
          currentStreak = 0;
        }
      }

      const weeklyScore =
        roommate.completedCount * 14 -
        roommate.missedCount * 8 -
        roommate.strikeCount * 6 +
        roommate.rescueCount * 10 -
        roommate.pendingCount * 2 +
        Math.round(roommate.reliability / 5) +
        currentStreak * 3;
      const monthlyScore =
        roommate.completedCount * 22 -
        roommate.missedCount * 10 +
        roommate.strikeCount * -10 +
        roommate.rescueCount * 14 +
        Math.round(roommate.reliability * 0.8) +
        bestStreak * 2;
      const streak = currentStreak;
      const totalScore = weeklyScore + monthlyScore;

      let achievementTone: UiScoreboardEntry["achievementTone"] = "neutral";
      let achievementSummary = "Needs a steadier rhythm";

      if (currentStreak >= 5) {
        achievementTone = "success";
        achievementSummary = `On a ${currentStreak} task streak and flying`;
      } else if (roommate.reliability >= 90 && roommate.missedCount === 0 && roommate.strikeCount === 0) {
        achievementTone = "success";
        achievementSummary = "Locked in and carrying the flat";
      } else if (roommate.rescueCount > roommate.strikeCount) {
        achievementTone = "success";
        achievementSummary = "Bails the house out when things slip";
      } else if (roommate.strikeCount >= 2) {
        achievementTone = "warning";
        achievementSummary = "Too many missed ownership turns";
      } else if (roommate.reliability >= 75) {
        achievementTone = "warning";
        achievementSummary = "Reliable with room to level up";
      }

      return {
        roommateId: roommate.id,
        roommateName: roommate.name,
        weeklyScore,
        monthlyScore,
        totalScore,
        reliability: roommate.reliability,
        completedCount: roommate.completedCount,
        missedCount: roommate.missedCount,
        rescueCount: roommate.rescueCount,
        strikeCount: roommate.strikeCount,
        streak,
        bestStreak,
        achievementTone,
        achievementSummary
      };
    })
    .sort((left, right) => right.totalScore - left.totalScore);
}
