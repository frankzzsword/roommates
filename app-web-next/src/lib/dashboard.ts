import type {
  CalendarPreviewBucket,
  DayAgendaBucket,
  HouseholdSnapshot,
  HouseholdTimelineRow,
  HouseholdWeekEntry,
  MoneySummary,
  NotificationFeedItem,
  RescueRequestItem,
  RoommateActivityBreakdown,
  ScoreExplanationItem,
  SharedDutyEntry,
  SharedHouseSnapshot,
  TaskPointRow,
  UiChore,
  UiScoreboardEntry,
  UiTaskTemplate
} from "./types";

const WEEKLY_TASKS = new Set(["Bathroom", "Kitchen", "Hallway", "Living Room", "Toilet"]);
const SHARED_DUTIES = [
  "Running Dishwasher",
  "Emptying Dishwasher",
  "Taking Out Trash",
  "Washing Towels",
  "Plastic and Glass Trash"
] as const;

function toDate(value: string) {
  return new Date(value);
}

function startOfDay(value = new Date()) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(value = new Date()) {
  const next = startOfDay(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfWeek(value = new Date()) {
  const next = new Date(value);
  const day = next.getDay();
  const mondayOffset = (day + 6) % 7;
  next.setDate(next.getDate() - mondayOffset);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfWeek(value = new Date()) {
  const next = startOfWeek(value);
  next.setDate(next.getDate() + 6);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfMonth(value = new Date()) {
  const next = new Date(value);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfMonth(value = new Date()) {
  const next = startOfMonth(value);
  next.setMonth(next.getMonth() + 1);
  next.setDate(0);
  next.setHours(23, 59, 59, 999);
  return next;
}

function isOpenTask(task: UiChore) {
  return task.status === "pending" || task.status === "overdue";
}

function isWithinRange(dateInput: string, start: Date, end: Date) {
  const date = toDate(dateInput);
  return !Number.isNaN(date.getTime()) && date >= start && date <= end;
}

function compareByDue(left: UiChore, right: UiChore) {
  return toDate(left.dueAt).getTime() - toDate(right.dueAt).getTime();
}

function compareTemplates(left: UiTaskTemplate, right: UiTaskTemplate) {
  return (left.nextDueAt ?? "").localeCompare(right.nextDueAt ?? "");
}

function getRoommateTasks(snapshot: HouseholdSnapshot, roommateId?: string) {
  return snapshot.chores.filter((task) => !roommateId || task.assigneeId === roommateId);
}

function getTuesdayOfTaskWeek(task: UiChore) {
  const due = toDate(task.dueAt);
  const weekStart = startOfWeek(due);
  weekStart.setDate(weekStart.getDate() + 1);
  return startOfDay(weekStart);
}

function isTaskVisibleOnDay(task: UiChore, date: Date) {
  const explicitWindowStart = task.windowStartAt ? startOfDay(toDate(task.windowStartAt)) : null;
  const explicitWindowEnd = task.windowEndAt ? endOfDay(toDate(task.windowEndAt)) : null;
  const windowStart = explicitWindowStart ?? getTuesdayOfTaskWeek(task);
  const windowEnd = explicitWindowEnd ?? endOfDay(toDate(task.dueAt));
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);
  return windowStart <= dayEnd && windowEnd >= dayStart;
}

export function getDueNowTasks(snapshot: HouseholdSnapshot, roommateId?: string) {
  const end = endOfDay();
  return getRoommateTasks(snapshot, roommateId)
    .filter((task) => isOpenTask(task) && toDate(task.dueAt) <= end)
    .sort(compareByDue);
}

export function getTomorrowTasks(snapshot: HouseholdSnapshot, roommateId?: string) {
  const start = startOfDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const end = endOfDay(start);
  return getRoommateTasks(snapshot, roommateId)
    .filter((task) => isOpenTask(task) && isWithinRange(task.dueAt, start, end))
    .sort(compareByDue);
}

export function getThisWeekTasks(snapshot: HouseholdSnapshot, roommateId?: string) {
  const start = startOfWeek();
  const end = endOfWeek();
  return getRoommateTasks(snapshot, roommateId)
    .filter((task) => isOpenTask(task) && isWithinRange(task.dueAt, start, end))
    .sort(compareByDue);
}

export function getLaterThisWeekTasks(snapshot: HouseholdSnapshot, roommateId?: string) {
  const dueNowIds = new Set(getDueNowTasks(snapshot, roommateId).map((task) => task.id));
  const tomorrowIds = new Set(getTomorrowTasks(snapshot, roommateId).map((task) => task.id));

  return getThisWeekTasks(snapshot, roommateId).filter(
    (task) => !dueNowIds.has(task.id) && !tomorrowIds.has(task.id)
  );
}

export function getRollingTasks(snapshot: HouseholdSnapshot, roommateId?: string) {
  return getRoommateTasks(snapshot, roommateId)
    .filter((task) => task.taskMode === "rolling_until_done" && isOpenTask(task))
    .sort(compareByDue);
}

export function getWeekAgenda(snapshot: HouseholdSnapshot, roommateId?: string): DayAgendaBucket[] {
  const base = startOfWeek();
  const offsets = [1, 2, 3, 4, 5, 6];
  const labels = ["Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekTasks = getThisWeekTasks(snapshot, roommateId).filter(
    (task) => task.taskMode === "fixed_schedule"
  );

  return offsets.map((offset, index) => {
    const date = new Date(base);
    date.setDate(base.getDate() + offset);
    return {
      key: startOfDay(date).toISOString(),
      label: labels[index],
      date,
      tasks: weekTasks.filter((task) => isTaskVisibleOnDay(task, date))
    };
  });
}

export function getHouseWeekAgenda(snapshot: HouseholdSnapshot) {
  return getWeekAgenda(snapshot);
}

export function getCompletedThisWeekTasks(snapshot: HouseholdSnapshot, roommateId?: string) {
  const start = startOfWeek();
  const end = endOfWeek();

  return snapshot.chores
    .filter((task) => isWithinRange(task.dueAt, start, end))
    .filter((task) => {
      if (!roommateId) {
        return task.status === "done" || task.status === "rescued";
      }

      const completedOwnAssignment =
        task.responsibleRoommateId === roommateId && task.status === "done";
      const rescuedByMe =
        task.rescuedByRoommateId === roommateId && task.status === "rescued";
      return completedOwnAssignment || rescuedByMe;
    })
    .sort(compareByDue);
}

function getActiveRoommates(snapshot: HouseholdSnapshot) {
  return [...snapshot.roommates]
    .filter((roommate) => roommate.isActive)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function getCurrentWeekRotaAssignments(snapshot: HouseholdSnapshot) {
  return getRotaAssignmentsForWeekOffset(snapshot, 0);
}

function getRotaAssignmentsForWeekOffset(snapshot: HouseholdSnapshot, weekOffset: number) {
  const start = startOfWeek();
  start.setDate(start.getDate() + weekOffset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return snapshot.chores
    .filter(
      (task) =>
        task.taskMode === "fixed_schedule" &&
        WEEKLY_TASKS.has(task.title) &&
        isWithinRange(task.dueAt, start, end)
    )
    .sort(compareByDue);
}

function getWeeklyRotaTemplates(snapshot: HouseholdSnapshot) {
  return snapshot.taskTemplates
    .filter(
      (task) =>
        task.taskMode === "fixed_schedule" &&
        task.frequencyUnit === "week" &&
        WEEKLY_TASKS.has(task.title)
    )
    .sort(compareTemplates);
}

export function getHouseholdWeekBoard(snapshot: HouseholdSnapshot): HouseholdWeekEntry[] {
  const grouped = new Map<string, HouseholdWeekEntry>();
  const activeRoommates = getActiveRoommates(snapshot);

  for (const roommate of activeRoommates) {
    grouped.set(roommate.id, {
      roommateId: roommate.id,
      roommateName: roommate.name,
      tasks: []
    });
  }

  const currentAssignments = getCurrentWeekRotaAssignments(snapshot);
  const sourceTasks = currentAssignments.length
    ? currentAssignments.map((task) => ({
        id: task.id,
        assigneeId: task.assigneeId,
        title: task.title,
        dueLabel: task.dueLabel,
        status: task.status as import("./types").ChoreStatus | "template",
      }))
    : getWeeklyRotaTemplates(snapshot).map((task) => ({
        id: task.id,
        assigneeId: task.assigneeId,
        title: task.title,
        dueLabel: task.nextDueLabel,
        status: "template" as const,
      }));

  for (const task of sourceTasks) {
    grouped.get(task.assigneeId)?.tasks.push({
      id: task.id,
      title: task.title,
      dueLabel: task.dueLabel,
      status: task.status,
    });
  }

  return activeRoommates.map((roommate) => grouped.get(roommate.id)!).filter(Boolean);
}

function getRotatedRoommate(snapshot: HouseholdSnapshot, currentRoommateId: string, offset: number) {
  const activeRoommates = getActiveRoommates(snapshot);
  const currentIndex = activeRoommates.findIndex((roommate) => roommate.id === currentRoommateId);
  if (currentIndex === -1 || activeRoommates.length === 0) return null;
  return activeRoommates[(currentIndex + offset) % activeRoommates.length] ?? null;
}

export function getProjectedHouseholdWeekBoard(snapshot: HouseholdSnapshot, weekOffset: number) {
  const activeRoommates = getActiveRoommates(snapshot);
  const grouped = new Map<string, HouseholdWeekEntry>();

  for (const roommate of activeRoommates) {
    grouped.set(roommate.id, {
      roommateId: roommate.id,
      roommateName: roommate.name,
      tasks: []
    });
  }

  const assignedForRequestedWeek = getRotaAssignmentsForWeekOffset(snapshot, weekOffset);
  if (assignedForRequestedWeek.length > 0) {
    for (const task of assignedForRequestedWeek) {
      grouped.get(task.assigneeId)?.tasks.push({
        id: task.id,
        title: task.title,
        dueLabel: task.dueLabel,
        status: task.status as import("./types").ChoreStatus | "template",
      });
    }

    return activeRoommates.map((roommate) => grouped.get(roommate.id)!).filter(Boolean);
  }

  for (const task of getWeeklyRotaTemplates(snapshot)) {
    const projectedRoommate = getRotatedRoommate(snapshot, task.assigneeId, weekOffset);
    if (!projectedRoommate) continue;
    grouped.get(projectedRoommate.id)?.tasks.push({
      id: `${task.id}-${weekOffset}`,
      title: task.title,
      dueLabel: task.nextDueLabel,
      status: "template" as const,
    });
  }

  return activeRoommates.map((roommate) => grouped.get(roommate.id)!).filter(Boolean);
}

export function getSharedDutyOverview(snapshot: HouseholdSnapshot): SharedDutyEntry[] {
  const byTitle = new Map<string, SharedDutyEntry>();
  const openAssignments = snapshot.chores
    .filter((task) => isOpenTask(task) && SHARED_DUTIES.includes(task.title as never))
    .sort(compareByDue);

  for (const task of openAssignments) {
    if (!byTitle.has(task.title)) {
      byTitle.set(task.title, {
        choreId: task.id,
        title: task.title,
        assignee: task.assignee,
        dueLabel: task.dueLabel,
        taskMode: task.taskMode
      });
    }
  }

  for (const task of snapshot.taskTemplates
    .filter((entry) => SHARED_DUTIES.includes(entry.title as never))
    .sort(compareTemplates)) {
    if (!byTitle.has(task.title)) {
      byTitle.set(task.title, {
        choreId: task.id,
        title: task.title,
        assignee: task.assignee,
        dueLabel: task.nextDueLabel,
        taskMode: task.taskMode
      });
    }
  }

  return SHARED_DUTIES.map((title) => byTitle.get(title)).filter(Boolean) as SharedDutyEntry[];
}

export function getProjectedSharedDutyOverview(snapshot: HouseholdSnapshot, weekOffset: number) {
  const active = getSharedDutyOverview(snapshot);
  if (weekOffset === 0) return active;

  return snapshot.taskTemplates
    .filter((task) => SHARED_DUTIES.includes(task.title as never) && task.taskMode === "fixed_schedule")
    .map((task) => ({
      choreId: `${task.id}-${weekOffset}`,
      title: task.title,
      assignee: getRotatedRoommate(snapshot, task.assigneeId, weekOffset)?.name ?? task.assignee,
      dueLabel: task.nextDueLabel,
      taskMode: task.taskMode
    }));
}

export function getProjectedWeeklyTimeline(snapshot: HouseholdSnapshot, weekOffset = 0): HouseholdTimelineRow[] {
  const board = weekOffset === 0
    ? getHouseholdWeekBoard(snapshot)
    : getProjectedHouseholdWeekBoard(snapshot, weekOffset);
  const labels = ["Tue", "Wed", "Thu", "Fri"];

  return board.map((entry) => ({
    roommateId: entry.roommateId,
    roommateName: entry.roommateName,
    freeWeek: entry.tasks.length === 0,
    days: labels.map((label) => ({
      key: `${entry.roommateId}-${label}`,
      label,
      tasks: entry.tasks.map((task) => task.title)
    }))
  }));
}

export function getUpcomingCalendar(snapshot: HouseholdSnapshot, roommateId?: string): CalendarPreviewBucket[] {
  const nextWeekStart = startOfWeek();
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const bucketCount = 6;
  const buckets: CalendarPreviewBucket[] = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const weekStart = new Date(nextWeekStart);
    weekStart.setDate(nextWeekStart.getDate() + index * 7);
    const friday = new Date(weekStart);
    friday.setDate(weekStart.getDate() + 4);
    const board = getProjectedHouseholdWeekBoard(snapshot, index + 1);
    const timeline = getProjectedWeeklyTimeline(snapshot, index + 1);
    const sharedDuties = getProjectedSharedDutyOverview(snapshot, index + 1);
    const myBoard = roommateId ? board.find((entry) => entry.roommateId === roommateId) : null;
    const roomieFree = board.find((entry) => entry.tasks.length === 0);
    const tasks = snapshot.chores
      .filter((task) => {
        if (!roommateId) return false;
        return task.assigneeId === roommateId && task.taskMode === "fixed_schedule";
      })
      .filter((task) => {
        const due = toDate(task.dueAt);
        return due >= weekStart && due <= endOfDay(new Date(friday));
      });

    buckets.push({
      key: weekStart.toISOString(),
      dayLabel: new Intl.DateTimeFormat("en-GB", { weekday: "short" }).format(friday),
      dateLabel: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(friday),
      weekLabel: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(weekStart),
      count: myBoard?.tasks.length ?? tasks.length,
      tasks,
      emptyLabel: myBoard && myBoard.tasks.length === 0 ? "Free week" : undefined,
      freeWeekRoommateName: roomieFree?.roommateName ?? null,
      weeklyBoard: board,
      sharedDuties,
      timeline
    });
  }

  return buckets;
}

export function getMoneySummary(snapshot: HouseholdSnapshot, roommateId: string): MoneySummary {
  const monthStart = startOfMonth();
  return {
    youOwe: snapshot.balances
      .filter((entry) => entry.fromRoommateId === roommateId)
      .reduce((total, entry) => total + entry.amount, 0),
    owedToYou: snapshot.balances
      .filter((entry) => entry.toRoommateId === roommateId)
      .reduce((total, entry) => total + entry.amount, 0),
    unsettledCount: snapshot.balances.filter(
      (entry) => entry.fromRoommateId === roommateId || entry.toRoommateId === roommateId
    ).length,
    monthlySpend: snapshot.expenses
      .filter((entry) => entry.paidByRoommateId === roommateId && toDate(entry.createdAt) >= monthStart)
      .reduce((total, entry) => total + entry.amount, 0)
  };
}

export function getScoreboard(snapshot: HouseholdSnapshot): UiScoreboardEntry[] {
  const weekStart = startOfWeek();
  const weekEnd = endOfWeek();
  const monthStart = startOfMonth();
  const monthEnd = endOfMonth();

  return snapshot.roommates
    .map((roommate) => {
      const roommateTasks = snapshot.chores.filter((task) => task.responsibleRoommateId === roommate.id);
      const weeklyTasks = roommateTasks.filter((task) => isWithinRange(task.dueAt, weekStart, weekEnd));
      const monthlyTasks = roommateTasks.filter((task) => isWithinRange(task.dueAt, monthStart, monthEnd));

      const weeklyDonePoints = weeklyTasks
        .filter((task) => task.status === "done" && !task.strikeApplied)
        .reduce((total, task) => total + task.points, 0);
      const weeklyStrikePenalty = weeklyTasks
        .filter((task) => task.strikeApplied || task.status === "skipped")
        .reduce((total, task) => total + Math.max(1, task.points), 0);
      const weeklyRescuePoints = snapshot.chores
        .filter((task) => task.rescuedByRoommateId === roommate.id)
        .filter((task) => isWithinRange(task.dueAt, weekStart, weekEnd))
        .reduce((total, task) => total + task.points, 0);

      const monthlyDonePoints = monthlyTasks
        .filter((task) => task.status === "done" && !task.strikeApplied)
        .reduce((total, task) => total + task.points, 0);
      const monthlyStrikePenalty = monthlyTasks
        .filter((task) => task.strikeApplied || task.status === "skipped")
        .reduce((total, task) => total + Math.max(1, task.points), 0);
      const monthlyRescuePoints = snapshot.chores
        .filter((task) => task.rescuedByRoommateId === roommate.id)
        .filter((task) => isWithinRange(task.dueAt, monthStart, monthEnd))
        .reduce((total, task) => total + task.points, 0);

      const allDonePoints = roommateTasks
        .filter((task) => task.status === "done" && !task.strikeApplied)
        .reduce((total, task) => total + task.points, 0);
      const allStrikePenalty = roommateTasks
        .filter((task) => task.strikeApplied || task.status === "skipped")
        .reduce((total, task) => total + Math.max(1, task.points), 0);
      const allRescuePoints = snapshot.chores
        .filter((task) => task.rescuedByRoommateId === roommate.id)
        .reduce((total, task) => total + task.points, 0);

      const streakTimeline = roommateTasks
        .filter((task) => task.status !== "pending" && task.status !== "overdue")
        .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());

      let streak = 0;
      let bestStreak = 0;
      for (const task of streakTimeline) {
        const successful = task.status === "done" && !task.strikeApplied;
        if (successful) {
          streak += 1;
          bestStreak = Math.max(bestStreak, streak);
        } else {
          streak = 0;
        }
      }

      const completedCount = roommateTasks.filter((task) => task.status === "done").length;
      const rescueCount = snapshot.chores.filter((task) => task.rescuedByRoommateId === roommate.id).length;
      const strikeCount = roommateTasks.filter((task) => task.strikeApplied || task.status === "skipped").length;
      const weeklyScore = weeklyDonePoints + weeklyRescuePoints - weeklyStrikePenalty;
      const monthlyScore = monthlyDonePoints + monthlyRescuePoints - monthlyStrikePenalty;
      const totalScore = allDonePoints + allRescuePoints - allStrikePenalty;
      const hasHistory = completedCount + rescueCount + strikeCount > 0;

      return {
        roommateId: roommate.id,
        roommateName: roommate.name,
        weeklyScore,
        monthlyScore,
        totalScore,
        reliability: roommate.reliability,
        hasHistory,
        completedCount,
        missedCount: strikeCount,
        rescueCount,
        strikeCount,
        streak,
        bestStreak,
        achievementTone:
          weeklyScore > 0
            ? ("success" as const)
            : strikeCount > 0
              ? ("warning" as const)
              : ("neutral" as const),
        achievementSummary:
          weeklyScore > 0
            ? "Carrying the week"
            : strikeCount > 0
              ? "Lost points on a miss"
              : "No points earned yet"
      };
    })
    .sort((left, right) => {
      if (right.weeklyScore !== left.weeklyScore) return right.weeklyScore - left.weeklyScore;
      if (right.monthlyScore !== left.monthlyScore) return right.monthlyScore - left.monthlyScore;
      return right.totalScore - left.totalScore;
    });
}

export function getSharedHouseSnapshot(snapshot: HouseholdSnapshot): SharedHouseSnapshot {
  const scoreboard = getScoreboard(snapshot);
  const weeklyLeader = scoreboard.find((entry) => entry.weeklyScore > 0) ?? null;
  const board = getHouseholdWeekBoard(snapshot);
  const freeWeek = board.find((entry) => entry.tasks.length === 0);
  const nextTurnTask = [...snapshot.taskTemplates]
    .filter((task) => task.nextDueAt)
    .sort((left, right) => (left.nextDueAt ?? "").localeCompare(right.nextDueAt ?? ""))[0];

  return {
    weeklyLeader,
    houseOverdueCount: snapshot.chores.filter((task) => task.status === "overdue").length,
    freeWeekRoommateName: freeWeek?.roommateName ?? null,
    nextTurnLabel: nextTurnTask ? `${nextTurnTask.title} · ${nextTurnTask.assignee}` : "No upcoming turn"
  };
}

export function getNotificationFeed(snapshot: HouseholdSnapshot, roommateId?: string, limit = 6): NotificationFeedItem[] {
  return snapshot.activity
    .filter((entry) => entry.eventType !== "WHATSAPP_ROUTE_INTERPRETED")
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      meta: `${entry.actor} • ${entry.timestamp}`,
      tone:
        entry.type === "completed"
          ? "success"
          : entry.type === "rescue"
            ? "accent"
            : entry.type === "missed" || entry.type === "escalation"
              ? "warning"
              : "default"
    }));
}

export function getOpenRescueRequests(snapshot: HouseholdSnapshot, roommateId: string): RescueRequestItem[] {
  return snapshot.activity
    .filter((entry) => entry.eventType === "RESCUE_REQUEST_OPENED")
    .map((entry) => {
      const task = snapshot.chores.find((item) => item.id === entry.assignmentId);
      if (!task) return null;
      const candidateIds = Array.isArray(entry.payload?.candidateRoommateIds)
        ? entry.payload.candidateRoommateIds.map(String)
        : [];
      if (!candidateIds.includes(roommateId)) return null;

      return {
        id: entry.id,
        assignmentId: task.id,
        title: task.title,
        requestedBy: task.responsibleRoommate,
        dueMeta: task.dueLabel,
        reason: typeof entry.payload?.reason === "string" ? entry.payload.reason : null
      };
    })
    .filter(Boolean) as RescueRequestItem[];
}

export function getRoommateActivityBreakdowns(snapshot: HouseholdSnapshot): RoommateActivityBreakdown[] {
  return snapshot.roommates.map((roommate) => {
    const assigned = snapshot.chores.filter((t) => t.responsibleRoommateId === roommate.id);
    const rescued  = snapshot.chores.filter((t) => t.rescuedByRoommateId === roommate.id);

    const events: import("./types").RoommateActivityEvent[] = [];

    // Completed tasks
    for (const task of assigned) {
      if (task.status === "done" && !task.strikeApplied) {
        events.push({
          id: `done-${task.id}`,
          kind: "completed",
          title: task.title,
          detail: `Due ${task.dueLabel}`,
          delta: task.points,
          timestamp: task.dueAt,
        });
      }
    }

    // Skipped / struck tasks
    for (const task of assigned) {
      if (task.strikeApplied || task.status === "skipped") {
        events.push({
          id: `skip-${task.id}`,
          kind: task.status === "skipped" ? "skipped" : "missed",
          title: task.title,
          detail: task.status === "skipped" ? "Skipped" : "Missed window — strike applied",
          delta: -Math.max(1, task.points),
          timestamp: task.dueAt,
        });
      }
    }

    // Rescue credits
    for (const task of rescued) {
      events.push({
        id: `rescue-${task.id}`,
        kind: "rescued",
        title: task.title,
        detail: `Rescued for ${task.responsibleRoommate}`,
        delta: task.points,
        timestamp: task.dueAt,
      });
    }

    // Sort newest first
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Streak calc
    const streakTimeline = assigned
      .filter((t) => t.status !== "pending" && t.status !== "overdue")
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    let streak = 0, bestStreak = 0;
    for (const task of streakTimeline) {
      if (task.status === "done" && !task.strikeApplied) {
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
      } else {
        streak = 0;
      }
    }

    const weekStart = startOfWeek();
    const weekEnd   = endOfWeek();
    const weeklyTasks = assigned.filter((t) => isWithinRange(t.dueAt, weekStart, weekEnd));
    const weeklyDone  = weeklyTasks.filter((t) => t.status === "done" && !t.strikeApplied).reduce((s, t) => s + t.points, 0);
    const weeklyLost  = weeklyTasks.filter((t) => t.strikeApplied || t.status === "skipped").reduce((s, t) => s + Math.max(1, t.points), 0);
    const weeklyRescue = snapshot.chores
      .filter((t) => t.rescuedByRoommateId === roommate.id && isWithinRange(t.dueAt, weekStart, weekEnd))
      .reduce((s, t) => s + t.points, 0);

    return {
      roommateId: roommate.id,
      roommateName: roommate.name,
      streak,
      bestStreak,
      weeklyScore: weeklyDone + weeklyRescue - weeklyLost,
      events,
    };
  });
}

export function getTaskPointTable(snapshot: HouseholdSnapshot): TaskPointRow[] {
  return [...snapshot.taskTemplates]
    .filter((t) => t.isActive)
    .sort((a, b) => b.points - a.points)
    .map((t) => ({
      id: t.id,
      title: t.title,
      area: t.area,
      points: t.points,
      penalty: Math.max(1, t.points),
      cadenceLabel: t.cadenceLabel,
      taskMode: t.taskMode,
    }));
}

export function getScoreExplainer(snapshot: HouseholdSnapshot): ScoreExplanationItem[] {
  return [
    {
      id: "completion",
      delta: "+pts",
      label: "Completing your turn",
      detail: "Points land only when you finish your assigned turn.",
      tone: "success"
    },
    {
      id: "miss",
      delta: "−pts",
      label: "Skipping or missing",
      detail: "The task's full point value is deducted when you skip.",
      tone: "warning"
    },
    {
      id: "rescue",
      delta: "+pts",
      label: "Rescuing a teammate",
      detail: "You earn the task's points when you step in for someone.",
      tone: "accent"
    }
  ];
}
