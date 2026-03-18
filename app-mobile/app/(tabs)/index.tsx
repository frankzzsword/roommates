import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/src/components/Screen";
import { MetricCard } from "@/src/components/MetricCard";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { useHousehold } from "@/src/context/HouseholdContext";
import { getScoreboard } from "@/src/data/mock";
import { getTaskBadge, getTaskHeadline, getTaskTone } from "@/src/lib/task-presentation";
import { colors, radii, spacing } from "@/src/theme";

export default function HomeScreen() {
  const { activeRoommate, snapshot, summary, syncNotice } = useHousehold();

  const myOpenTasks = snapshot.chores.filter(
    (task) => task.assigneeId === activeRoommate.id && (task.status === "pending" || task.status === "overdue")
  );
  const spotlightTask =
    myOpenTasks.find((task) => task.accountabilityState === "escalated") ??
    myOpenTasks.find((task) => task.status === "overdue") ??
    myOpenTasks[0];
  const scoreboard = useMemo(() => getScoreboard(snapshot), [snapshot]);
  const leader = scoreboard[0];
  const myEntry = scoreboard.find((entry) => entry.roommateId === activeRoommate.id);

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="My house view"
        title={`Welcome back, ${activeRoommate.name}`}
        subtitle="This is your own dashboard now: your tasks, your standing, and what the flat needs this week."
      />

      <SectionCard style={styles.heroCard} tone="accent">
        <Text style={styles.heroEyebrow}>Right now</Text>
        <View style={styles.heroRow}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>{activeRoommate.name}</Text>
            <Text style={styles.heroSubline}>{activeRoommate.note}</Text>
            <Text style={styles.heroSubline}>{syncNotice ?? snapshot.lastSyncLabel}</Text>
          </View>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeValue}>{activeRoommate.reliability}%</Text>
            <Text style={styles.heroBadgeLabel}>reliable</Text>
          </View>
        </View>
        {spotlightTask ? (
          <View
            style={[
              styles.spotlight,
              getTaskTone(spotlightTask) === "danger"
                ? styles.spotlightDanger
                : getTaskTone(spotlightTask) === "warning"
                  ? styles.spotlightWarning
                  : styles.spotlightNeutral
            ]}
          >
            <View style={styles.spotlightCopy}>
              <Text style={styles.spotlightTitle}>{spotlightTask.title}</Text>
              <Text style={styles.spotlightMeta}>{getTaskHeadline(spotlightTask)}</Text>
            </View>
            <Text style={styles.spotlightBadge}>{getTaskBadge(spotlightTask)}</Text>
          </View>
        ) : (
          <Text style={styles.heroEmpty}>Nothing urgent is on you right now.</Text>
        )}
      </SectionCard>

      <View style={styles.metricRow}>
        <MetricCard label="My open tasks" value={myOpenTasks.length} />
        <MetricCard label="House overdue" tone="danger" value={summary.overdueCount} />
      </View>
      <View style={styles.metricRow}>
        <MetricCard label="My strikes" tone="warning" value={activeRoommate.strikeCount} />
        <MetricCard label="My rescues" tone="success" value={activeRoommate.rescueCount} />
      </View>

      <SectionCard
        title="My momentum"
        subtitle="This is the mix of completed turns, rescues, and strikes shaping your standing."
      >
        {myEntry ? (
          <View style={styles.personalCard}>
            <Text style={styles.personalTitle}>{myEntry.achievementSummary}</Text>
            <Text style={styles.personalMeta}>
              {myEntry.weeklyScore} weekly • {myEntry.monthlyScore} monthly • {myEntry.totalScore} total
            </Text>
            <Text style={styles.personalMeta}>
              {myEntry.completedCount} done • {myEntry.rescueCount} rescues • {myEntry.strikeCount} strikes
            </Text>
          </View>
        ) : (
          <Text style={styles.heroEmpty}>Your score will show up once tasks start moving.</Text>
        )}
      </SectionCard>

      <SectionCard
        title="Who is carrying the week"
        subtitle={`${snapshot.settings.weeklyAchievementLabel}: ${summary.weeklyChampion}`}
        tone="success"
      >
        {leader ? (
          <View style={styles.leaderRow}>
            <View style={styles.leaderCopy}>
              <Text style={styles.leaderName}>{leader.roommateName}</Text>
              <Text style={styles.leaderMeta}>
                {leader.weeklyScore} weekly • {leader.rescueCount} rescues • {leader.streak} streak
              </Text>
            </View>
            <Text style={styles.leaderScore}>{leader.totalScore}</Text>
          </View>
        ) : null}
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
  heroTitle: {
    color: colors.white,
    fontSize: 34,
    fontWeight: "900"
  },
  heroSubline: {
    color: "#d7e2ff",
    fontSize: 14,
    lineHeight: 20
  },
  heroBadge: {
    alignItems: "center",
    backgroundColor: colors.warning,
    borderRadius: radii.lg,
    justifyContent: "center",
    minWidth: 104,
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
    borderRadius: radii.lg,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  spotlightNeutral: {
    backgroundColor: "#1b2340"
  },
  spotlightWarning: {
    backgroundColor: "#4a2f00"
  },
  spotlightDanger: {
    backgroundColor: "#4c1120"
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
    color: colors.white,
    fontSize: 13,
    fontWeight: "900"
  },
  heroEmpty: {
    color: "#d7e2ff",
    fontSize: 14
  },
  metricRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  personalCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 4,
    padding: spacing.md
  },
  personalTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  personalMeta: {
    color: colors.muted,
    fontSize: 13
  },
  leaderRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md
  },
  leaderCopy: {
    gap: 4
  },
  leaderName: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  leaderMeta: {
    color: colors.muted,
    fontSize: 13
  },
  leaderScore: {
    color: colors.ink,
    fontSize: 30,
    fontWeight: "900"
  }
});
