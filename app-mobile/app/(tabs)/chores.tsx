import { StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/src/components/Screen";
import { RoommateSwitcher } from "@/src/components/RoommateSwitcher";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { getRoommateAssignments } from "@/src/data/mock";
import { useHousehold } from "@/src/context/HouseholdContext";
import { formatTaskMode, getTaskBadge, getTaskHeadline, getTaskTone } from "@/src/lib/task-presentation";
import type { UiChore } from "@/src/lib/types";
import { colors, radii, spacing } from "@/src/theme";

export default function TasksScreen() {
  const { activeRoommate, setActiveRoommate, snapshot } = useHousehold();
  const personalTasks = getRoommateAssignments(snapshot, activeRoommate.id);
  const urgentTasks = snapshot.chores.filter(
    (chore) => chore.accountabilityState === "escalated" || chore.status === "overdue"
  );
  const rescuedTasks = snapshot.chores.filter((chore) => chore.resolutionType === "rescued");

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Task board"
        title="See what needs action"
        subtitle="Rolling and fixed chores now read differently. You can tell at a glance whether a task is simply upcoming, already reminded, fully escalated, or rescued."
      />

      <SectionCard title="View roommate queue" subtitle="Every roommate sees the same visual system." tone="accent">
        <RoommateSwitcher
          activeRoommateId={activeRoommate.id}
          onSelect={setActiveRoommate}
          roommates={snapshot.roommates}
        />
      </SectionCard>

      <SectionCard
        title={`Assigned to ${activeRoommate.name}`}
        subtitle="This feed combines due timing with accountability state."
      >
        {personalTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {personalTasks.length === 0 ? <Text style={styles.emptyCopy}>No tasks assigned here right now.</Text> : null}
      </SectionCard>

      <SectionCard title="Escalated now" subtitle="These are the tasks the house should notice immediately." tone="danger">
        {urgentTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {urgentTasks.length === 0 ? <Text style={styles.emptyCopy}>Nothing is escalated right now.</Text> : null}
      </SectionCard>

      <SectionCard
        title="Rescue log"
        subtitle="If someone else covers a missed turn, the rescuer gets credit and the original owner keeps the debt."
        tone="warning"
      >
        {rescuedTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {rescuedTasks.length === 0 ? <Text style={styles.emptyCopy}>No rescues logged this round.</Text> : null}
      </SectionCard>
    </AppScreen>
  );
}

function TaskCard({ task }: { task: UiChore }) {
  const tone = getTaskTone(task);

  return (
    <View style={styles.taskCard}>
      <View style={styles.taskTop}>
        <View style={styles.taskCopy}>
          <Text style={styles.taskTitle}>{task.title}</Text>
          <Text style={styles.taskMeta}>
            {task.assignee} • {formatTaskMode(task.taskMode)} • {task.points} pts
          </Text>
        </View>
        <View
          style={[
            styles.badge,
            tone === "danger"
              ? styles.badgeDanger
              : tone === "warning"
                ? styles.badgeWarning
                : tone === "success"
                  ? styles.badgeSuccess
                  : tone === "accent"
                    ? styles.badgeAccent
                    : styles.badgeNeutral
          ]}
        >
          <Text style={styles.badgeText}>{getTaskBadge(task)}</Text>
        </View>
      </View>
      <Text style={styles.taskDescription}>{task.description}</Text>
      <Text style={styles.taskHeadline}>{getTaskHeadline(task)}</Text>
      <View style={styles.metaStrip}>
        <Text style={styles.metaStripText}>{task.cadence}</Text>
        <Text style={styles.metaStripText}>{task.dueLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  taskCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  taskTop: {
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  taskCopy: {
    flex: 1,
    gap: 4
  },
  taskTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  },
  taskMeta: {
    color: colors.muted,
    fontSize: 13
  },
  taskDescription: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20
  },
  taskHeadline: {
    color: colors.accentStrong,
    fontSize: 14,
    fontWeight: "800"
  },
  metaStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  metaStripText: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceStrong
  },
  badgeAccent: {
    backgroundColor: colors.accent
  },
  badgeSuccess: {
    backgroundColor: colors.success
  },
  badgeWarning: {
    backgroundColor: colors.warning
  },
  badgeDanger: {
    backgroundColor: colors.danger
  },
  badgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900"
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
