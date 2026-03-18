import { ReactNode, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { TextField } from "@/src/components/TextField";
import { useHousehold } from "@/src/context/HouseholdContext";
import { formatTaskMode, getTaskBadge, getTaskHeadline, getTaskTone } from "@/src/lib/task-presentation";
import type { UiChore } from "@/src/lib/types";
import { colors, radii, spacing } from "@/src/theme";

function startOfToday() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export default function TasksScreen() {
  const { activeRoommate, sendAppMessage, snapshot, syncNotice } = useHousehold();
  const [customMessage, setCustomMessage] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const { currentTasks, futureTasks, historyTasks, rescueableTasks } = useMemo(() => {
    const today = startOfToday();
    const mine = snapshot.chores.filter((task) => task.assigneeId === activeRoommate.id);
    const current = mine.filter(
      (task) => new Date(task.dueAt) <= today || task.status === "pending" || task.status === "overdue"
    );
    const future = mine.filter((task) => new Date(task.dueAt) > today && task.status === "pending");
    const history = snapshot.chores
      .filter(
        (task) =>
          task.responsibleRoommateId === activeRoommate.id ||
          task.rescuedByRoommateId === activeRoommate.id ||
          task.assigneeId === activeRoommate.id
      )
      .filter((task) => task.status !== "pending" && task.status !== "overdue")
      .slice(0, 8);
    const rescuePool = snapshot.chores.filter(
      (task) =>
        task.assigneeId !== activeRoommate.id &&
        (task.accountabilityState === "escalated" || task.status === "overdue")
    );

    return {
      currentTasks: current,
      futureTasks: future,
      historyTasks: history,
      rescueableTasks: rescuePool
    };
  }, [activeRoommate.id, snapshot.chores]);

  async function runAction(key: string, message: string) {
    setBusyKey(key);
    try {
      await sendAppMessage(message);
      setCustomMessage("");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="My tasks"
        title={`Hey ${activeRoommate.name}`}
        subtitle="Everything you can say in WhatsApp works here too. Use the quick buttons or just type naturally."
      />

      <SectionCard
        title="Quick message to the house bot"
        subtitle="Examples: I finished the kitchen. I am not home this week. I can rescue Noah's bathroom task."
        tone="accent"
      >
        <TextField
          label="Message"
          multiline
          onChangeText={setCustomMessage}
          placeholder="I won't be home for my task next week, please switch me"
          value={customMessage}
        />
        <ActionButton
          busy={busyKey === "custom"}
          label="Send action"
          onPress={() => {
            if (!customMessage.trim()) {
              return;
            }

            void runAction("custom", customMessage.trim());
          }}
        />
        {syncNotice ? <Text style={styles.notice}>{syncNotice}</Text> : null}
      </SectionCard>

      <SectionCard
        title="My open tasks"
        subtitle="These are the things currently on you, including anything already lined up for later."
      >
        {currentTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            footer={
              <View style={styles.buttonRow}>
                <ActionButton
                  busy={busyKey === `done-${task.id}`}
                  label="Done"
                  onPress={() => void runAction(`done-${task.id}`, `I finished ${task.title}`)}
                />
                <ActionButton
                  busy={busyKey === `swap-${task.id}`}
                  label="Not home / busy"
                  onPress={() =>
                    void runAction(
                      `swap-${task.id}`,
                      `I am not home for ${task.title} this week, please switch me`
                    )
                  }
                  tone="secondary"
                />
              </View>
            }
          />
        ))}
        {currentTasks.length === 0 ? (
          <Text style={styles.emptyCopy}>Nothing urgent is on you right now.</Text>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Coming up for me"
        subtitle="Future weekly turns and extra house jobs already on your schedule."
      >
        {futureTasks.slice(0, 6).map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            footer={
              <View style={styles.buttonRow}>
                <ActionButton
                  busy={busyKey === `future-${task.id}`}
                  label="I won't be home"
                  onPress={() =>
                    void runAction(
                      `future-${task.id}`,
                      `I will not be home for ${task.title} on ${task.dueLabel}, please switch me`
                    )
                  }
                  tone="secondary"
                />
              </View>
            }
          />
        ))}
        {futureTasks.length === 0 ? <Text style={styles.emptyCopy}>No future tasks scheduled yet.</Text> : null}
      </SectionCard>

      <SectionCard
        title="House needs help"
        subtitle="If something is slipping, you can rescue it here and the scoreboard will reflect it."
        tone="warning"
      >
        {rescueableTasks.slice(0, 4).map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            footer={
              <View style={styles.buttonRow}>
                <ActionButton
                  busy={busyKey === `rescue-${task.id}`}
                  label={`Rescue for ${task.assignee}`}
                  onPress={() =>
                    void runAction(
                      `rescue-${task.id}`,
                      `I did ${task.assignee}'s ${task.title} for them`
                    )
                  }
                  tone="danger"
                />
              </View>
            }
          />
        ))}
        {rescueableTasks.length === 0 ? <Text style={styles.emptyCopy}>Nothing needs a rescue right now.</Text> : null}
      </SectionCard>

      <SectionCard title="My recent history" subtitle="Finished, skipped, rescued, and carried tasks stay visible here.">
        {historyTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
        {historyTasks.length === 0 ? <Text style={styles.emptyCopy}>No recent history yet.</Text> : null}
      </SectionCard>
    </AppScreen>
  );
}

function TaskCard({
  task,
  footer
}: {
  task: UiChore;
  footer?: ReactNode;
}) {
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
      <Text style={styles.taskSubline}>{task.cadence} • {task.dueLabel}</Text>
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
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
  taskSubline: {
    color: colors.muted,
    fontSize: 13
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
  buttonRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
