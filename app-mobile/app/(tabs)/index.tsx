import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { MetricCard } from "@/src/components/MetricCard";
import { ModeBanner } from "@/src/components/ModeBanner";
import { RoommateSwitcher } from "@/src/components/RoommateSwitcher";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { getRoommateAssignments, getScoreboard } from "@/src/data/mock";
import { useHousehold } from "@/src/context/HouseholdContext";
import { getTaskBadge, getTaskHeadline, getTaskTone } from "@/src/lib/task-presentation";
import { colors, radii, spacing } from "@/src/theme";

export default function HomeScreen() {
  const {
    activeRoommate,
    mode,
    reload,
    setActiveRoommate,
    snapshot,
    summary,
    syncNotice
  } = useHousehold();
  const [refreshing, setRefreshing] = useState(false);

  const myTasks = getRoommateAssignments(snapshot, activeRoommate.id);
  const spotlightTask =
    myTasks.find((task) => task.accountabilityState === "escalated") ??
    myTasks.find((task) => task.status === "overdue") ??
    myTasks.find((task) => task.accountabilityState === "reminder_sent") ??
    myTasks[0];
  const scoreboard = useMemo(() => getScoreboard(snapshot), [snapshot]);
  const leader = scoreboard[0];

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="House status"
        title={snapshot.houseName}
        subtitle="Everyone can see the pressure points, the rescues, and who is actually carrying the flat this week."
      />

      <ModeBanner
        message={
          syncNotice ??
          snapshot.lastSyncLabel ??
          (mode === "preview" ? "Preview mode" : "Live state connected")
        }
        mode={mode}
      />

      <SectionCard title="View the app as" subtitle="Switch perspective to any roommate instantly." tone="accent">
        <RoommateSwitcher
          activeRoommateId={activeRoommate.id}
          onSelect={setActiveRoommate}
          roommates={snapshot.roommates}
        />
      </SectionCard>

      <SectionCard style={styles.heroCard} tone="accent">
        <Text style={styles.heroEyebrow}>Right now</Text>
        <View style={styles.heroRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroName}>{activeRoommate.name}</Text>
            <Text style={styles.heroNote}>{activeRoommate.note}</Text>
          </View>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeValue}>{activeRoommate.reliability}%</Text>
            <Text style={styles.heroBadgeLabel}>reliable</Text>
          </View>
        </View>
        {spotlightTask ? (
          <View style={styles.spotlight}>
            <View style={styles.spotlightCopy}>
              <Text style={styles.spotlightTitle}>{spotlightTask.title}</Text>
              <Text style={styles.spotlightMeta}>{getTaskHeadline(spotlightTask)}</Text>
            </View>
            <View
              style={[
                styles.spotlightBadge,
                getTaskTone(spotlightTask) === "danger"
                  ? styles.spotlightDanger
                  : getTaskTone(spotlightTask) === "warning"
                    ? styles.spotlightWarning
                    : styles.spotlightNeutral
              ]}
            >
              <Text style={styles.spotlightBadgeText}>{getTaskBadge(spotlightTask)}</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.heroNoTask}>No open tasks. This roommate is clear right now.</Text>
        )}
      </SectionCard>

      <View style={styles.metricRow}>
        <MetricCard label="Urgent now" tone="danger" value={summary.overdueCount} />
        <MetricCard label="Rescues logged" tone="warning" value={summary.rescuedCount} />
      </View>
      <View style={styles.metricRow}>
        <MetricCard label="Pending" value={summary.pendingCount} />
        <MetricCard label="House strikes" tone="warning" value={summary.strikeCount} />
      </View>

      <SectionCard
        title="Who is carrying the week"
        subtitle={`${snapshot.settings.weeklyAchievementLabel}: ${summary.weeklyChampion} • ${snapshot.settings.monthlyAchievementLabel}: ${summary.monthlyChampion}`}
        tone="success"
      >
        {leader ? (
          <View style={styles.leaderRow}>
            <View style={styles.leaderCopy}>
              <Text style={styles.leaderTitle}>{leader.roommateName}</Text>
              <Text style={styles.leaderMeta}>
                {leader.weeklyScore} weekly • {leader.monthlyScore} monthly • {leader.rescueCount} rescues
              </Text>
              <Text style={styles.leaderSummary}>{leader.achievementSummary}</Text>
            </View>
            <Text style={styles.leaderScore}>{leader.totalScore}</Text>
          </View>
        ) : null}
      </SectionCard>

      <SectionCard
        title={`Pressure points for ${activeRoommate.name}`}
        subtitle="Urgency is visual now: reminders, escalations, rescues, and clean completions all read differently."
      >
        {myTasks.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <View style={styles.taskCopy}>
              <Text style={styles.taskTitle}>{task.title}</Text>
              <Text style={styles.taskMeta}>
                {task.area} • {task.cadence} • {task.points} pts
              </Text>
              <Text style={styles.taskSubMeta}>{getTaskHeadline(task)}</Text>
            </View>
            <View
              style={[
                styles.taskBadge,
                getTaskTone(task) === "danger"
                  ? styles.taskBadgeDanger
                  : getTaskTone(task) === "warning"
                    ? styles.taskBadgeWarning
                    : getTaskTone(task) === "success"
                      ? styles.taskBadgeSuccess
                      : getTaskTone(task) === "accent"
                        ? styles.taskBadgeAccent
                        : styles.taskBadgeNeutral
              ]}
            >
              <Text style={styles.taskBadgeText}>{getTaskBadge(task)}</Text>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Live feed" subtitle="This is where reminder sends, rescues, and misses become public." tone="warning">
        {snapshot.activity.slice(0, 4).map((entry) => (
          <View key={entry.id} style={styles.activityRow}>
            <View
              style={[
                styles.activityDot,
                entry.type === "completed"
                  ? styles.activitySuccess
                  : entry.type === "rescue"
                    ? styles.activityAccent
                    : entry.type === "escalation" || entry.type === "missed"
                      ? styles.activityDanger
                      : styles.activityNeutral
              ]}
            />
            <View style={styles.activityCopy}>
              <Text style={styles.activityTitle}>{entry.title}</Text>
              <Text style={styles.activityMeta}>
                {entry.actor} • {entry.timestamp}
              </Text>
            </View>
          </View>
        ))}
        <ActionButton
          busy={refreshing}
          label="Refresh live state"
          onPress={() => {
            setRefreshing(true);
            void reload({ showNotice: true }).finally(() => {
              setRefreshing(false);
            });
          }}
          tone="secondary"
        />
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    backgroundColor: colors.ink
  },
  heroEyebrow: {
    color: "#d7e2ff",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  heroRow: {
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  heroCopy: {
    flex: 1,
    gap: 6
  },
  heroName: {
    color: colors.white,
    fontSize: 34,
    fontWeight: "900"
  },
  heroNote: {
    color: "#d7e2ff",
    fontSize: 15,
    lineHeight: 22
  },
  heroBadge: {
    alignItems: "center",
    backgroundColor: colors.warning,
    borderRadius: radii.lg,
    justifyContent: "center",
    minWidth: 100,
    paddingHorizontal: spacing.md
  },
  heroBadgeValue: {
    color: colors.white,
    fontSize: 24,
    fontWeight: "900"
  },
  heroBadgeLabel: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "800"
  },
  spotlight: {
    alignItems: "center",
    backgroundColor: "#1b2340",
    borderRadius: radii.lg,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  spotlightCopy: {
    flex: 1,
    gap: 4
  },
  spotlightTitle: {
    color: colors.white,
    fontSize: 18,
    fontWeight: "900"
  },
  spotlightMeta: {
    color: "#d7e2ff",
    fontSize: 14,
    lineHeight: 20
  },
  spotlightBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  spotlightNeutral: {
    backgroundColor: colors.surfaceStrong
  },
  spotlightDanger: {
    backgroundColor: colors.danger
  },
  spotlightWarning: {
    backgroundColor: colors.warning
  },
  spotlightBadgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900"
  },
  heroNoTask: {
    color: "#d7e2ff",
    fontSize: 15
  },
  metricRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  leaderRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  leaderCopy: {
    flex: 1,
    gap: 4
  },
  leaderTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  leaderMeta: {
    color: colors.muted,
    fontSize: 13
  },
  leaderSummary: {
    color: colors.success,
    fontSize: 13,
    fontWeight: "800"
  },
  leaderScore: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: "900"
  },
  taskRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
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
  taskSubMeta: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20
  },
  taskBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  taskBadgeNeutral: {
    backgroundColor: colors.surfaceStrong
  },
  taskBadgeAccent: {
    backgroundColor: colors.accent
  },
  taskBadgeSuccess: {
    backgroundColor: colors.success
  },
  taskBadgeWarning: {
    backgroundColor: colors.warning
  },
  taskBadgeDanger: {
    backgroundColor: colors.danger
  },
  taskBadgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "900"
  },
  activityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  activityDot: {
    borderRadius: radii.pill,
    height: 14,
    width: 14
  },
  activitySuccess: {
    backgroundColor: colors.success
  },
  activityAccent: {
    backgroundColor: colors.accent
  },
  activityDanger: {
    backgroundColor: colors.danger
  },
  activityNeutral: {
    backgroundColor: colors.border
  },
  activityCopy: {
    flex: 1,
    gap: 3
  },
  activityTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  activityMeta: {
    color: colors.muted,
    fontSize: 13
  }
});
