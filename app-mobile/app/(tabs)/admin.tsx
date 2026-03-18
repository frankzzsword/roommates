import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/src/components/Screen";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { useHousehold } from "@/src/context/HouseholdContext";
import { colors, radii, spacing } from "@/src/theme";

function startOfWeek(date: Date) {
  const value = new Date(date);
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setDate(value.getDate() + diff);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfWeek(date: Date) {
  const value = startOfWeek(date);
  value.setDate(value.getDate() + 6);
  value.setHours(23, 59, 59, 999);
  return value;
}

export default function WeeklyBoardScreen() {
  const { snapshot } = useHousehold();

  const { thisWeek, thisWeekDone, weeklyLeisureRoommate, carryOvers } = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);
    const thisWeekAssignments = snapshot.chores.filter((task) => {
      const due = new Date(task.dueAt);
      return due >= weekStart && due <= weekEnd;
    });

    const open = thisWeekAssignments.filter((task) => task.status === "pending" || task.status === "overdue");
    const done = thisWeekAssignments.filter((task) => task.status !== "pending" && task.status !== "overdue");
    const assignedIds = new Set(open.map((task) => task.assigneeId));
    const freeRoommate =
      snapshot.roommates.find((roommate) => !assignedIds.has(roommate.id)) ?? null;
    const carryOver = open.filter((task) => task.description.toLowerCase().includes("carry"));

    return {
      thisWeek: open,
      thisWeekDone: done,
      weeklyLeisureRoommate: freeRoommate,
      carryOvers: carryOver
    };
  }, [snapshot]);

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Weekly board"
        title="This week's house rota"
        subtitle="This is the shared Tuesday to Friday board, including who is free this week, what is still open, and what already got finished."
      />

      <SectionCard
        title="Free this week"
        subtitle="This roommate is the first swap-in if someone says they are away or busy before Friday."
        tone="accent"
      >
        <Text style={styles.freeName}>{weeklyLeisureRoommate?.name ?? "No free slot this week"}</Text>
        <Text style={styles.freeMeta}>
          {weeklyLeisureRoommate
            ? `${weeklyLeisureRoommate.name} is the standby roommate for this week.`
            : "This week is fully packed because one roommate is already away."}
        </Text>
      </SectionCard>

      <SectionCard
        title="Open this week"
        subtitle="The house can see who owns each weekly cleaning task and whether anything is under pressure."
      >
        {thisWeek.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <View style={styles.taskCopy}>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.taskMeta}>
                {task.assignee} • {task.dueLabel}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                task.status === "overdue" || task.accountabilityState === "escalated"
                  ? styles.statusDanger
                  : styles.statusNeutral
              ]}
            >
              <Text style={styles.statusText}>{task.status === "overdue" ? "Overdue" : "Open"}</Text>
            </View>
          </View>
        ))}
        {thisWeek.length === 0 ? <Text style={styles.emptyCopy}>No open weekly tasks right now.</Text> : null}
      </SectionCard>

      <SectionCard
        title="Finished this week"
        subtitle="This makes it easy to see who handled what without digging through the whole history."
        tone="success"
      >
        {thisWeekDone.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <View style={styles.taskCopy}>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.taskMeta}>
                {task.assignee}
                {task.rescuedByRoommate ? ` • rescued by ${task.rescuedByRoommate}` : ""}
              </Text>
            </View>
            <Text style={styles.doneStatus}>{task.status}</Text>
          </View>
        ))}
        {thisWeekDone.length === 0 ? <Text style={styles.emptyCopy}>Nothing finished yet this week.</Text> : null}
      </SectionCard>

      <SectionCard
        title="Carry over priority"
        subtitle="If a weekly task could not be covered, it gets pushed harder next week."
        tone="warning"
      >
        {carryOvers.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <View style={styles.taskCopy}>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.taskMeta}>{task.description}</Text>
            </View>
          </View>
        ))}
        {carryOvers.length === 0 ? <Text style={styles.emptyCopy}>No carry over tasks are queued right now.</Text> : null}
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  freeName: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900"
  },
  freeMeta: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  taskRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md
  },
  taskCopy: {
    flex: 1,
    gap: 4
  },
  taskTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  taskMeta: {
    color: colors.muted,
    fontSize: 13
  },
  statusPill: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  statusNeutral: {
    backgroundColor: colors.surfaceStrong
  },
  statusDanger: {
    backgroundColor: colors.danger
  },
  statusText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900"
  },
  doneStatus: {
    color: colors.success,
    fontSize: 13,
    fontWeight: "900"
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14
  }
});
