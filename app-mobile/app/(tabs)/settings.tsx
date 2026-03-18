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
    logout,
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
        title="Account and reminders"
        subtitle="This is your own reminder rhythm, your WhatsApp target, and your quick account actions."
      />

      <SectionCard
        title={activeRoommate.name}
        subtitle={activeRoommate.whatsappNumber}
        tone="accent"
      >
        <Text style={styles.roleLabel}>{activeRoommate.note}</Text>
        <ActionButton label="Log out" onPress={logout} tone="ghost" />
      </SectionCard>

      <SectionCard title="My reminder rhythm" subtitle="This controls when the bot nudges you before a task becomes a problem.">
        <ToggleRow
          description="Allow direct reminders for this roommate."
          onToggle={() =>
            void updateReminderSettings(activeRoommate.id, {
              personalEnabled: !preferences.personalEnabled
            })
          }
          title="Direct reminders"
          value={preferences.personalEnabled}
        />
        <ToggleRow
          description="Send the early heads up before the due window."
          onToggle={() =>
            void updateReminderSettings(activeRoommate.id, {
              dayBefore: !preferences.dayBefore
            })
          }
          title="Start of week / early heads up"
          value={preferences.dayBefore}
        />
        <ToggleRow
          description="Send a firmer nudge when something is still open."
          onToggle={() =>
            void updateReminderSettings(activeRoommate.id, {
              escalationEnabled: !preferences.escalationEnabled
            })
          }
          title="Escalation messages"
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

        <ActionButton
          busy={savingSchedule}
          label="Save my reminder rhythm"
          onPress={() => {
            setSavingSchedule(true);
            const reminderHour = Math.max(0, Math.min(23, Number(scheduleDraft.reminderHour) || 18));
            const reminderLeadHours = Math.max(1, Number(scheduleDraft.reminderLeadHours) || 4);
            const escalationHours = Math.max(1, Number(scheduleDraft.escalationHours) || 12);

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

      <SectionCard title="Connection" subtitle="The web app and WhatsApp both talk to the same live backend.">
        <Text style={styles.connectionTitle}>{getApiBaseUrl()}</Text>
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
  roleLabel: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  inlineInputs: {
    flexDirection: "row",
    gap: spacing.md
  },
  inlineInput: {
    flex: 1
  },
  connectionTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  connectionMeta: {
    color: colors.muted,
    fontSize: 13
  }
});
