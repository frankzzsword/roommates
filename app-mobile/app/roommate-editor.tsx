import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { TextField } from "@/src/components/TextField";
import { ToggleRow } from "@/src/components/ToggleRow";
import { useHousehold } from "@/src/context/HouseholdContext";
import { triggerSelectionFeedback } from "@/src/lib/feedback";
import type { ReminderPreferences, RoommateDraft } from "@/src/lib/types";
import { colors, radii, spacing } from "@/src/theme";

function buildReminderPreferences(): ReminderPreferences {
  return {
    personalEnabled: true,
    dayBefore: false,
    dayOf: true,
    escalationEnabled: true,
    escalationHours: 2,
    reminderHour: 18,
    reminderLeadHours: 4,
    quietHoursStart: "22:30",
    quietHoursEnd: "07:30"
  };
}

function buildDraft(): RoommateDraft {
  return {
    name: "",
    whatsappNumber: "",
    note: "",
    isActive: true,
    reminderPreferences: buildReminderPreferences()
  };
}

export default function RoommateEditorScreen() {
  const { roommateId } = useLocalSearchParams<{ roommateId?: string }>();
  const { createRoommate, snapshot, updateRoommate } = useHousehold();
  const existingRoommate = useMemo(
    () => snapshot.roommates.find((roommate) => roommate.id === roommateId),
    [roommateId, snapshot.roommates]
  );
  const [draft, setDraft] = useState<RoommateDraft>(() =>
    existingRoommate
      ? {
          name: existingRoommate.name,
          whatsappNumber: existingRoommate.whatsappNumber,
          note: existingRoommate.note,
          isActive: existingRoommate.isActive,
          sortOrder: existingRoommate.sortOrder,
          reminderPreferences: { ...existingRoommate.reminderPreferences }
        }
      : buildDraft()
  );
  const [busy, setBusy] = useState(false);

  const canSave = draft.name.trim().length > 1 && draft.whatsappNumber.trim().length > 7;

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow={existingRoommate ? "Editing roommate" : "New roommate"}
        title={existingRoommate ? existingRoommate.name : "Add roommate"}
        subtitle="This is the profile that powers assignment order, WhatsApp reminders, and scoreboard identity."
        accessory={<ActionButton label="Close" onPress={() => router.back()} tone="ghost" />}
      />

      <SectionCard title="Identity" subtitle="Name and WhatsApp number are the core routing fields.">
        <TextField
          label="Full name"
          onChangeText={(value) => setDraft((current) => ({ ...current, name: value }))}
          placeholder="Noah"
          value={draft.name}
        />
        <TextField
          label="WhatsApp number"
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, whatsappNumber: value }))
          }
          placeholder="whatsapp:+49176..."
          value={draft.whatsappNumber}
        />
        <TextField
          label="Role or note"
          multiline
          onChangeText={(value) => setDraft((current) => ({ ...current, note: value }))}
          placeholder="Bathroom rotation, prefers evening reminders"
          value={draft.note}
        />
      </SectionCard>

      <SectionCard title="Reminder rhythm" subtitle="Make reminders feel personal instead of generic.">
        <View style={styles.inlineInputs}>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label="Reminder hour"
              onChangeText={(value) =>
                setDraft((current) => ({
                  ...current,
                  reminderPreferences: {
                    ...current.reminderPreferences,
                    reminderHour: Math.max(
                      0,
                      Math.min(23, Number(value) || current.reminderPreferences.reminderHour)
                    )
                  }
                }))
              }
              value={String(draft.reminderPreferences.reminderHour)}
            />
          </View>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label="Lead hours"
              onChangeText={(value) =>
                setDraft((current) => ({
                  ...current,
                  reminderPreferences: {
                    ...current.reminderPreferences,
                    reminderLeadHours: Math.max(
                      1,
                      Number(value) || current.reminderPreferences.reminderLeadHours
                    )
                  }
                }))
              }
              value={String(draft.reminderPreferences.reminderLeadHours)}
            />
          </View>
        </View>

        <View style={styles.inlineInputs}>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label="Escalate after hours"
              onChangeText={(value) =>
                setDraft((current) => ({
                  ...current,
                  reminderPreferences: {
                    ...current.reminderPreferences,
                    escalationHours: Math.max(
                      1,
                      Number(value) || current.reminderPreferences.escalationHours
                    )
                  }
                }))
              }
              value={String(draft.reminderPreferences.escalationHours)}
            />
          </View>
          <View style={styles.inlineInput}>
            <Text style={styles.helperLabel}>Quiet window</Text>
            <View style={styles.quietRow}>
              {[
                draft.reminderPreferences.quietHoursStart,
                draft.reminderPreferences.quietHoursEnd
              ].map((value, index) => (
                <Pressable
                  key={`${value}-${index}`}
                  onPress={() => {
                    void triggerSelectionFeedback();
                  }}
                  style={styles.quietBadge}
                >
                  <Text style={styles.quietBadgeText}>{value}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Delivery and roster state" subtitle="Inactive roommates stay visible, but stop getting new nudges.">
        <ToggleRow
          description="Enable direct WhatsApp reminders for this person."
          onToggle={() =>
            setDraft((current) => ({
              ...current,
              reminderPreferences: {
                ...current.reminderPreferences,
                personalEnabled: !current.reminderPreferences.personalEnabled
              }
            }))
          }
          title="Direct reminders"
          value={draft.reminderPreferences.personalEnabled}
        />
        <ToggleRow
          description="Keep this person in the active house rotation."
          onToggle={() =>
            setDraft((current) => ({
              ...current,
              isActive: !current.isActive
            }))
          }
          title="Active roommate"
          value={draft.isActive}
        />
      </SectionCard>

      <SectionCard title="Save changes" subtitle="Saving updates this roommate everywhere in the app.">
        <ActionButton
          busy={busy}
          disabled={!canSave}
          label={existingRoommate ? "Save roommate" : "Create roommate"}
          onPress={() => {
            setBusy(true);
            const action = existingRoommate
              ? updateRoommate(existingRoommate.id, {
                  name: draft.name,
                  whatsappNumber: draft.whatsappNumber,
                  note: draft.note,
                  role: draft.note || existingRoommate.role,
                  isActive: draft.isActive,
                  reminderPreferences: draft.reminderPreferences
                })
              : createRoommate(draft);

            void action.finally(() => {
              setBusy(false);
              router.back();
            });
          }}
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
    flex: 1,
    gap: spacing.xs
  },
  helperLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  quietRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  quietBadge: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  quietBadgeText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800"
  }
});
