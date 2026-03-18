import { StyleSheet, Text, View } from "react-native";

import { AppScreen } from "@/src/components/Screen";
import { MetricCard } from "@/src/components/MetricCard";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { getScoreboard } from "@/src/data/mock";
import { useHousehold } from "@/src/context/HouseholdContext";
import { colors, radii, spacing } from "@/src/theme";

export default function ScoreboardScreen() {
  const { activeRoommate, snapshot } = useHousehold();
  const scoreboard = getScoreboard(snapshot);
  const weeklyLeader = scoreboard[0];
  const monthlyLeader = [...scoreboard].sort((left, right) => right.monthlyScore - left.monthlyScore)[0];
  const personalEntry = scoreboard.find((entry) => entry.roommateId === activeRoommate.id);

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Scoreboard"
        title="Recognition over fines"
        subtitle="Misses and rescues are visible, but the house energy comes from momentum, streaks, and clearly earned titles."
      />

      <View style={styles.metricRow}>
        <MetricCard
          label={snapshot.settings.weeklyAchievementLabel}
          tone="success"
          value={weeklyLeader?.roommateName ?? "TBD"}
        />
        <MetricCard
          label={snapshot.settings.monthlyAchievementLabel}
          tone="warning"
          value={monthlyLeader?.roommateName ?? "TBD"}
        />
      </View>

      <SectionCard
        title={`Your standing: ${activeRoommate.name}`}
        subtitle="The mix of reliability, rescues, and strikes that shapes this roommate's current standing."
        tone="accent"
      >
        {personalEntry ? (
          <View style={styles.personalRow}>
            <View style={styles.personalCopy}>
              <Text style={styles.personalTitle}>{personalEntry.achievementSummary}</Text>
              <Text style={styles.personalMeta}>
                {personalEntry.weeklyScore} weekly • {personalEntry.monthlyScore} monthly • {personalEntry.totalScore} total
              </Text>
              <Text style={styles.personalMeta}>
                {personalEntry.rescueCount} rescues • {personalEntry.strikeCount} strikes • {personalEntry.streak} streak
              </Text>
            </View>
            <View style={styles.personalBadge}>
              <Text style={styles.personalBadgeValue}>{personalEntry.totalScore}</Text>
              <Text style={styles.personalBadgeLabel}>score</Text>
            </View>
          </View>
        ) : (
          <Text style={styles.emptyCopy}>No score yet for this roommate.</Text>
        )}
      </SectionCard>

      <SectionCard
        title="House ranking"
        subtitle="Sorted by overall impact. Rescuing the house helps. Missing your own turn hurts."
      >
        {scoreboard.map((entry, index) => (
          <View key={entry.roommateId} style={styles.rankRow}>
            <View style={[styles.rankBadge, index === 0 ? styles.rankBadgeLeader : null]}>
              <Text style={styles.rankBadgeText}>{index + 1}</Text>
            </View>
            <View style={styles.rankCopy}>
              <Text style={styles.rankName}>{entry.roommateName}</Text>
              <Text style={styles.rankMeta}>
                {entry.completedCount} done • {entry.rescueCount} rescues • {entry.strikeCount} strikes
              </Text>
              <Text
                style={[
                  styles.rankSummary,
                  entry.achievementTone === "success"
                    ? styles.rankSummarySuccess
                    : entry.achievementTone === "warning"
                      ? styles.rankSummaryWarning
                      : styles.rankSummaryNeutral
                ]}
              >
                {entry.achievementSummary}
              </Text>
            </View>
            <View style={styles.rankScore}>
              <Text style={styles.rankScoreValue}>{entry.totalScore}</Text>
              <Text style={styles.rankScoreMeta}>
                {entry.weeklyScore}W / {entry.monthlyScore}M
              </Text>
            </View>
          </View>
        ))}
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  metricRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  personalRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  personalCopy: {
    flex: 1,
    gap: 4
  },
  personalTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900"
  },
  personalMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  personalBadge: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    justifyContent: "center",
    minWidth: 90,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  personalBadgeValue: {
    color: colors.white,
    fontSize: 26,
    fontWeight: "900"
  },
  personalBadgeLabel: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "800"
  },
  rankRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  rankBadge: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  rankBadgeLeader: {
    backgroundColor: colors.warning
  },
  rankBadgeText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "900"
  },
  rankCopy: {
    flex: 1,
    gap: 4
  },
  rankName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  rankMeta: {
    color: colors.muted,
    fontSize: 13
  },
  rankSummary: {
    fontSize: 13,
    fontWeight: "800"
  },
  rankSummarySuccess: {
    color: colors.success
  },
  rankSummaryWarning: {
    color: colors.warning
  },
  rankSummaryNeutral: {
    color: colors.muted
  },
  rankScore: {
    alignItems: "flex-end",
    gap: 2
  },
  rankScoreValue: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "900"
  },
  rankScoreMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800"
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14
  }
});
