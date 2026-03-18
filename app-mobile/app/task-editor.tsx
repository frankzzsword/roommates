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
import { suggestAiSubtasks } from "@/src/lib/api";
import type {
  AdvanceRotationOn,
  AiSubtaskSuggestion,
  FrequencyUnit,
  TaskMode,
  UiTaskTemplate
} from "@/src/lib/types";
import { colors, radii, spacing } from "@/src/theme";

const frequencyUnits: Array<{ label: string; value: FrequencyUnit }> = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" }
];

const taskModes: Array<{ label: string; value: TaskMode; description: string }> = [
  {
    label: "Fixed",
    value: "fixed_schedule",
    description: "Weekly or monthly chores on a steady cadence."
  },
  {
    label: "Rolling",
    value: "rolling_until_done",
    description: "Trash and dishwasher ownership that rotates only when resolved."
  }
];

const rotationOptions: Array<{
  label: string;
  value: AdvanceRotationOn;
  description: string;
}> = [
  {
    label: "Advance on completion",
    value: "completed_only",
    description: "Use this for fixed chores and neutral handoffs."
  },
  {
    label: "Keep owner after rescue",
    value: "rescue_keeps_owner",
    description: "Use this for trash or dishwasher so the missed turn still counts."
  }
];

function formatCadenceLabel(interval: number, unit: FrequencyUnit) {
  if (interval === 1) {
    return `Every ${unit}`;
  }

  return `Every ${interval} ${unit}s`;
}

function buildTaskDraft(roommateId: string, roommateName: string): UiTaskTemplate {
  return {
    id: "",
    title: "",
    description: "",
    area: "Kitchen",
    assigneeId: roommateId,
    assignee: roommateName,
    frequencyInterval: 1,
    frequencyUnit: "week",
    taskMode: "fixed_schedule",
    softReminderAfterHours: 24,
    repeatReminderEveryHours: 24,
    escalateAfterHours: 48,
    advanceRotationOn: "completed_only",
    cadenceLabel: "Every week",
    reminderEnabled: true,
    isOptionalSubtask: false,
    parentTemplateId: null,
    parentTemplateTitle: null,
    isActive: true
  };
}

export default function TaskEditorScreen() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { activeRoommate, saveTaskTemplateDraft, snapshot } = useHousehold();
  const existingTask = useMemo(
    () => snapshot.taskTemplates.find((template) => template.id === taskId),
    [snapshot.taskTemplates, taskId]
  );
  const [draft, setDraft] = useState<UiTaskTemplate>(() =>
    existingTask ? { ...existingTask } : buildTaskDraft(activeRoommate.id, activeRoommate.name)
  );
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSource, setAiSource] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiSubtaskSuggestion[]>([]);

  const isRolling = draft.taskMode === "rolling_until_done";
  const canCreateAiSubtasks = Boolean(existingTask?.id);
  const parentOptions = snapshot.taskTemplates.filter(
    (template) => !template.parentTemplateId && template.id !== draft.id
  );

  function updateDraft(patch: Partial<UiTaskTemplate>) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      return {
        ...next,
        cadenceLabel: formatCadenceLabel(next.frequencyInterval, next.frequencyUnit)
      };
    });
  }

  const canSave = draft.title.trim().length > 1 && draft.area.trim().length > 1;

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow={existingTask ? "Editing task" : "New task"}
        title={existingTask ? existingTask.title : "Create recurring task"}
        subtitle="This editor is full-screen on purpose. You should always know when you are changing house automation."
        accessory={
          <ActionButton
            label="Close"
            onPress={() => router.back()}
            tone="ghost"
          />
        }
      />

      <SectionCard title="Task identity" subtitle="Make the chore easy to recognise in the group.">
        <TextField
          label="Task title"
          onChangeText={(value) => updateDraft({ title: value })}
          placeholder="Take out trash"
          value={draft.title}
        />
        <TextField
          label="Description"
          multiline
          onChangeText={(value) => updateDraft({ description: value })}
          placeholder="What counts as done?"
          value={draft.description}
        />
        <TextField
          label="Area"
          onChangeText={(value) => updateDraft({ area: value })}
          placeholder="Kitchen"
          value={draft.area}
        />
      </SectionCard>

      <SectionCard
        title="Responsibility model"
        subtitle="Rolling chores stay with the same owner after rescue. Fixed chores move on normally."
        tone="accent"
      >
        <View style={styles.segmentRow}>
          {taskModes.map((mode) => {
            const selected = draft.taskMode === mode.value;
            return (
              <Pressable
                key={mode.value}
                onPress={() => {
                  void triggerSelectionFeedback();
                  updateDraft({
                    taskMode: mode.value,
                    advanceRotationOn:
                      mode.value === "rolling_until_done"
                        ? "rescue_keeps_owner"
                        : "completed_only"
                  });
                }}
                style={({ pressed }) => [
                  styles.segment,
                  selected ? styles.segmentActive : styles.segmentIdle,
                  pressed ? styles.segmentPressed : null
                ]}
              >
                <Text style={[styles.segmentTitle, selected ? styles.segmentTitleActive : null]}>
                  {mode.label}
                </Text>
                <Text style={[styles.segmentDescription, selected ? styles.segmentDescriptionActive : null]}>
                  {mode.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard
        title="Rotation owner"
        subtitle="Choose who is next in line. Rolling tasks keep this owner after a rescue if you enable the stricter rule."
      >
        <View style={styles.chipRow}>
          {snapshot.roommates.map((roommate) => {
            const selected = draft.assigneeId === roommate.id;
            return (
              <Pressable
                key={roommate.id}
                onPress={() => {
                  void triggerSelectionFeedback();
                  updateDraft({ assigneeId: roommate.id, assignee: roommate.name });
                }}
                style={({ pressed }) => [
                  styles.choiceChip,
                  selected ? styles.choiceChipActive : null,
                  pressed ? styles.segmentPressed : null
                ]}
              >
                <Text style={[styles.choiceChipLabel, selected ? styles.choiceChipLabelActive : null]}>
                  {roommate.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.helperCopy}>
          Current cadence: {draft.cadenceLabel}. Next up: {draft.assignee}.
        </Text>
      </SectionCard>

      <SectionCard title="Timing" subtitle="Fixed tasks use cadence. Rolling tasks use reminder age.">
        <View style={styles.inlineInputs}>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label="Every"
              onChangeText={(value) =>
                updateDraft({
                  frequencyInterval: Math.max(1, Number(value) || draft.frequencyInterval)
                })
              }
              value={String(draft.frequencyInterval)}
            />
          </View>
          <View style={styles.inlineInput}>
            <Text style={styles.fieldLabel}>Unit</Text>
            <View style={styles.chipRow}>
              {frequencyUnits.map((unit) => {
                const selected = draft.frequencyUnit === unit.value;
                return (
                  <Pressable
                    key={unit.value}
                    onPress={() => {
                      void triggerSelectionFeedback();
                      updateDraft({ frequencyUnit: unit.value });
                    }}
                    style={[
                      styles.smallChip,
                      selected ? styles.smallChipActive : styles.smallChipIdle
                    ]}
                  >
                    <Text style={[styles.smallChipLabel, selected ? styles.smallChipLabelActive : null]}>
                      {unit.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.inlineInputs}>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label={isRolling ? "Soft reminder after hours" : "Soft reminder after hours"}
              onChangeText={(value) =>
                updateDraft({
                  softReminderAfterHours: Math.max(1, Number(value) || draft.softReminderAfterHours)
                })
              }
              value={String(draft.softReminderAfterHours)}
            />
          </View>
          <View style={styles.inlineInput}>
            <TextField
              keyboardType="number-pad"
              label="Repeat every hours"
              onChangeText={(value) =>
                updateDraft({
                  repeatReminderEveryHours: Math.max(
                    1,
                    Number(value) || draft.repeatReminderEveryHours
                  )
                })
              }
              value={String(draft.repeatReminderEveryHours)}
            />
          </View>
        </View>

        <TextField
          keyboardType="number-pad"
          label="Escalate after hours"
          onChangeText={(value) =>
            updateDraft({
              escalateAfterHours: Math.max(1, Number(value) || draft.escalateAfterHours)
            })
          }
          value={String(draft.escalateAfterHours)}
        />
      </SectionCard>

      <SectionCard
        title="Rescue rule"
        subtitle="Choose whether a rescue advances the rotation or makes the original owner repeat the same duty."
        tone={isRolling ? "warning" : "default"}
      >
        <View style={styles.optionStack}>
          {rotationOptions.map((option) => {
            const selected = draft.advanceRotationOn === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => {
                  void triggerSelectionFeedback();
                  updateDraft({ advanceRotationOn: option.value });
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  selected ? styles.optionRowActive : null,
                  pressed ? styles.segmentPressed : null
                ]}
              >
                <View style={styles.optionDotWrap}>
                  <View style={[styles.optionDot, selected ? styles.optionDotActive : null]} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{option.label}</Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard title="Subtask and visibility" subtitle="Optional monthly deep-clean items can sit under a weekly parent.">
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => {
              void triggerSelectionFeedback();
              updateDraft({ parentTemplateId: null, parentTemplateTitle: null });
            }}
            style={[styles.smallChip, !draft.parentTemplateId ? styles.smallChipActive : styles.smallChipIdle]}
          >
            <Text style={[styles.smallChipLabel, !draft.parentTemplateId ? styles.smallChipLabelActive : null]}>
              Standalone
            </Text>
          </Pressable>
          {parentOptions.map((template) => {
            const selected = draft.parentTemplateId === template.id;
            return (
              <Pressable
                key={template.id}
                onPress={() => {
                  void triggerSelectionFeedback();
                  updateDraft({
                    parentTemplateId: template.id,
                    parentTemplateTitle: template.title
                  });
                }}
                style={[styles.smallChip, selected ? styles.smallChipActive : styles.smallChipIdle]}
              >
                <Text style={[styles.smallChipLabel, selected ? styles.smallChipLabelActive : null]}>
                  {template.title}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ToggleRow
          description="Use this for monthly deep cleans that matter, but not every single week."
          onToggle={() => updateDraft({ isOptionalSubtask: !draft.isOptionalSubtask })}
          title="Optional subtask"
          value={draft.isOptionalSubtask}
        />
        <ToggleRow
          description="Turn this off to keep the template in history without assigning new turns."
          onToggle={() => updateDraft({ isActive: !draft.isActive })}
          title="Task active"
          value={draft.isActive}
        />
      </SectionCard>

      <SectionCard
        title="AI subtask ideas"
        subtitle="Use AI to break a chore into realistic companion tasks. Save the parent first if this is a brand new task."
        tone="warning"
      >
        <ActionButton
          busy={aiBusy}
          disabled={!draft.title.trim() || !canCreateAiSubtasks}
          label={canCreateAiSubtasks ? "Suggest subtasks with AI" : "Save parent task first"}
          onPress={() => {
            if (!canCreateAiSubtasks) {
              return;
            }

            setAiBusy(true);
            void suggestAiSubtasks({
              title: draft.title,
              description: draft.description,
              area: draft.area,
              taskMode: draft.taskMode
            })
              .then((result) => {
                setAiSource(result.model ? `${result.source} • ${result.model}` : result.source);
                setAiSuggestions(result.suggestions);
              })
              .finally(() => {
                setAiBusy(false);
              });
          }}
        />
        {aiSource ? <Text style={styles.aiMeta}>Source: {aiSource}</Text> : null}
        {aiSuggestions.map((suggestion, index) => (
          <View key={`${suggestion.title}-${index}`} style={styles.aiCard}>
            <View style={styles.aiTop}>
              <View style={styles.aiCopy}>
                <Text style={styles.aiTitle}>{suggestion.title}</Text>
                <Text style={styles.aiDescription}>{suggestion.description}</Text>
              </View>
              <View style={styles.aiBadge}>
                <Text style={styles.aiBadgeText}>
                  Every {suggestion.frequencyInterval} {suggestion.frequencyUnit}
                  {suggestion.frequencyInterval === 1 ? "" : "s"}
                </Text>
              </View>
            </View>
            <Text style={styles.aiRationale}>{suggestion.rationale}</Text>
            <ActionButton
              label="Create this subtask"
              onPress={() => {
                void saveTaskTemplateDraft({
                  id: "",
                  title: suggestion.title,
                  description: suggestion.description,
                  area: suggestion.area,
                  assigneeId: draft.assigneeId,
                  assignee: draft.assignee,
                  frequencyInterval: suggestion.frequencyInterval,
                  frequencyUnit: suggestion.frequencyUnit,
                  taskMode: "fixed_schedule",
                  softReminderAfterHours: 24,
                  repeatReminderEveryHours: 24,
                  escalateAfterHours: 48,
                  advanceRotationOn: "completed_only",
                  cadenceLabel: formatCadenceLabel(
                    suggestion.frequencyInterval,
                    suggestion.frequencyUnit
                  ),
                  reminderEnabled: true,
                  isOptionalSubtask: suggestion.isOptionalSubtask,
                  parentTemplateId: draft.id || existingTask?.id || null,
                  parentTemplateTitle: draft.title,
                  isActive: true
                });
              }}
              tone="secondary"
            />
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Save changes" subtitle="Saving will immediately update the recurring task library.">
        <ActionButton
          busy={busy}
          disabled={!canSave}
          label={existingTask ? "Save task changes" : "Create task"}
          onPress={() => {
            setBusy(true);
            void saveTaskTemplateDraft(draft).finally(() => {
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
  segmentRow: {
    gap: spacing.md
  },
  segment: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: 6,
    padding: spacing.lg
  },
  segmentIdle: {
    backgroundColor: colors.white,
    borderColor: colors.border
  },
  segmentActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  segmentPressed: {
    transform: [{ scale: 0.985 }]
  },
  segmentTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  segmentTitleActive: {
    color: colors.white
  },
  segmentDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19
  },
  segmentDescriptionActive: {
    color: "#dce6ff"
  },
  inlineInputs: {
    flexDirection: "row",
    gap: spacing.md
  },
  inlineInput: {
    flex: 1,
    gap: spacing.xs
  },
  fieldLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  choiceChip: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  choiceChipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
  },
  choiceChipLabel: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800"
  },
  choiceChipLabelActive: {
    color: colors.white
  },
  helperCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  aiMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  aiCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  aiTop: {
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  aiCopy: {
    flex: 1,
    gap: 4
  },
  aiTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  aiDescription: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20
  },
  aiBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  aiBadgeText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800"
  },
  aiRationale: {
    color: colors.accentStrong,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19
  },
  smallChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  smallChipIdle: {
    backgroundColor: colors.white,
    borderColor: colors.border
  },
  smallChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  smallChipLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800"
  },
  smallChipLabelActive: {
    color: colors.white
  },
  optionStack: {
    gap: spacing.sm
  },
  optionRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  optionRowActive: {
    borderColor: colors.warning,
    backgroundColor: colors.warningSoft
  },
  optionDotWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 24
  },
  optionDot: {
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    height: 14,
    width: 14
  },
  optionDotActive: {
    backgroundColor: colors.warning
  },
  optionCopy: {
    flex: 1,
    gap: 4
  },
  optionTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  optionDescription: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  }
});
