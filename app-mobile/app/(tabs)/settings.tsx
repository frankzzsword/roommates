import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { TextField } from "@/src/components/TextField";
import { ToggleRow } from "@/src/components/ToggleRow";
import { useHousehold } from "@/src/context/HouseholdContext";
import { getApiBaseUrl } from "@/src/lib/api";
import { colors, radii, spacing } from "@/src/theme";

export default function SettingsScreen() {
  const {
    activeRoommate,
    reload,
    snapshot,
    syncNotice,
    updateReminderSettings
  } = useHousehold();
  const [refreshing, setRefreshing] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState({
    reminderHour: String(activeRoommate.reminderPreferences.reminderHour),
    reminderLeadHours: String(activeRoommate.reminderPreferences.reminderLeadHours),
    escalationHours: String(activeRoommate.reminderPreferences.escalationHours)
  });

  useEffect(() => {
    setScheduleDraft({
      reminderHour: String(activeRoommate.reminderPreferences.reminderHour),
      reminderLeadHours: String(activeRoommate.reminderPreferences.reminderLeadHours),
      escalationHours: String(activeRoommate.reminderPreferences.escalationHours)
    });
  }, [
    activeRoommate.id,
    activeRoommate.reminderPreferences.escalationHours,
    activeRoommate.reminderPreferences.reminderHour,
    activeRoommate.reminderPreferences.reminderLeadHours
  ]);

  const preferences = activeRoommate.reminderPreferences;

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Settings"
        title="Tune reminders and house rules"
        subtitle="Roommates manage their own reminder rhythm here. House-wide labels and automation move to a dedicated full-screen editor."
      />

      <SectionCard
        title={`Reminder profile for ${activeRoommate.name}`}
        subtitle={`Direct target: ${activeRoommate.whatsappNumber}`}
        tone="accent"
      >
        <ToggleRow
          description="Allow the bot to DM this person directly."
          onToggle={() =>
            void updateReminderSettings(activeRoommate.id, {
              personalEnabled: !preferences.personalEnabled
            })
          }
          title="Direct WhatsApp reminders"
          value={preferences.personalEnabled}
        />
        <ToggleRow
          description="Send a reminder before the due window starts."
          onToggle={() =>
            void updateReminderSettings(activeRoommate.id, {
              dayBefore: !preferences.dayBefore
            })
          }
          title="Early heads-up"
          value={preferences.dayBefore}
        />
        <ToggleRow
          description="Escalate when the task is still open after the expected window."
          onToggle={() =>
            void updateReminderSettings(activeRoommate.id, {
              escalationEnabled: !preferences.escalationEnabled
            })
          }
          title="Escalation reminders"
          value={preferences.escalationEnabled}
        />

        <View style={styles.inlineInputs}>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label="Reminder hour"
              onChangeText={(value) =>
                setScheduleDraft((current) => ({ ...current, reminderHour: value }))
              }
              value={scheduleDraft.reminderHour}
            />
          </View>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label="Lead hours"
              onChangeText={(value) =>
                setScheduleDraft((current) => ({ ...current, reminderLeadHours: value }))
              }
              value={scheduleDraft.reminderLeadHours}
            />
          </View>
        </View>

        <TextField
          keyboardType="number-pad"
          label="Escalation hours"
          onChangeText={(value) =>
            setScheduleDraft((current) => ({ ...current, escalationHours: value }))
          }
          value={scheduleDraft.escalationHours}
        />

        <View style={styles.quietCard}>
          <Text style={styles.quietTitle}>Quiet hours</Text>
          <Text style={styles.quietCopy}>
            {preferences.quietHoursStart} to {preferences.quietHoursEnd}
          </Text>
        </View>

        <ActionButton
          busy={savingSchedule}
          label="Save personal rhythm"
          onPress={() => {
            setSavingSchedule(true);
            const reminderHour = Math.max(0, Math.min(23, Number(scheduleDraft.reminderHour) || 18));
            const reminderLeadHours = Math.max(1, Number(scheduleDraft.reminderLeadHours) || 4);
            const escalationHours = Math.max(1, Number(scheduleDraft.escalationHours) || 2);

            void updateReminderSettings(activeRoommate.id, {
              reminderHour,
              reminderLeadHours,
              escalationHours,
              dayBefore: reminderLeadHours >= 12,
              dayOf: true
            }).finally(() => {
              setSavingSchedule(false);
            });
          }}
        />
      </SectionCard>

      <SectionCard
        title="House-wide automation"
        subtitle="Titles, reminder toggles, and weekly summary behaviour now live behind a dedicated editor screen."
      >
        <View style={styles.ruleRow}>
          <Text style={styles.ruleTitle}>{snapshot.settings.weeklyAchievementLabel}</Text>
          <Text style={styles.ruleMeta}>weekly title</Text>
        </View>
        <View style={styles.ruleRow}>
          <Text style={styles.ruleTitle}>{snapshot.settings.monthlyAchievementLabel}</Text>
          <Text style={styles.ruleMeta}>monthly title</Text>
        </View>
        <ActionButton
          label="Open house rules"
          onPress={() => router.push("/house-rules-editor")}
          tone="secondary"
        />
      </SectionCard>

      <SectionCard title="Connection" subtitle="Use this to verify the app is actually reading your backend." tone="warning">
        <Text style={styles.connectionTitle}>{getApiBaseUrl() || "No API URL configured"}</Text>
        <Text style={styles.connectionMeta}>{syncNotice ?? snapshot.lastSyncLabel}</Text>
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
  inlineInputs: {
    flexDirection: "row",
    gap: spacing.md
  },
  inlineInput: {
    flex: 1
  },
  quietCard: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.lg,
    padding: spacing.md
  },
  quietTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 4,
    textTransform: "uppercase"
  },
  quietCopy: {
    color: colors.muted,
    fontSize: 14
  },
  ruleRow: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md
  },
  ruleTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  ruleMeta: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 4
  },
  connectionTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  connectionMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  }
});
