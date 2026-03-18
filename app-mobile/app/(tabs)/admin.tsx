import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { RoommateSwitcher } from "@/src/components/RoommateSwitcher";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { TextField } from "@/src/components/TextField";
import { ToggleRow } from "@/src/components/ToggleRow";
import { useHousehold } from "@/src/context/HouseholdContext";
import { triggerSelectionFeedback } from "@/src/lib/feedback";
import { analyzeHouseWithAi } from "@/src/lib/api";
import { formatTaskMode } from "@/src/lib/task-presentation";
import type { AiHouseInsight, FrequencyUnit, UiRoommate, UiTaskTemplate } from "@/src/lib/types";
import { colors, radii, spacing } from "@/src/theme";

const frequencyUnits: Array<{ label: string; value: FrequencyUnit }> = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" }
];

function sortRoommatesByRotation(roommates: UiRoommate[]) {
  return [...roommates].sort((left, right) => {
    if (left.sortOrder === right.sortOrder) {
      return left.name.localeCompare(right.name);
    }

    return left.sortOrder - right.sortOrder;
  });
}

function formatCadenceLabel(interval: number, unit: FrequencyUnit) {
  if (interval === 1) {
    return `Every ${unit}`;
  }

  return `Every ${interval} ${unit}s`;
}

function buildTaskRotationOrder(roommates: UiRoommate[], nextRoommateId: string) {
  const activeRoommates = sortRoommatesByRotation(roommates).filter((roommate) => roommate.isActive);
  const ordered = activeRoommates.length > 0 ? activeRoommates : sortRoommatesByRotation(roommates);
  const startIndex = ordered.findIndex((roommate) => roommate.id === nextRoommateId);

  if (startIndex === -1) {
    return ordered;
  }

  return [...ordered.slice(startIndex), ...ordered.slice(0, startIndex)];
}

function TaskRotationTrack({
  nextRoommateId,
  roommates
}: {
  nextRoommateId: string;
  roommates: UiRoommate[];
}) {
  const ordered = buildTaskRotationOrder(roommates, nextRoommateId);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.trackRow}>
        {ordered.map((roommate, index) => {
          const isNext = index === 0;

          return (
            <View key={`${nextRoommateId}-${roommate.id}`} style={styles.trackItem}>
              <View style={[styles.trackCircle, isNext ? styles.trackCircleNext : null]}>
                <Text style={[styles.trackCircleLabel, isNext ? styles.trackCircleLabelNext : null]}>
                  {roommate.name}
                </Text>
              </View>
              {index < ordered.length - 1 ? (
                <Feather
                  color={isNext ? colors.accent : colors.muted}
                  name="arrow-right"
                  size={18}
                  style={styles.trackArrow}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function TaskInlineEditor({
  draft,
  onChange,
  onCycleOwner,
  onSave,
  roommates,
  saving
}: {
  draft: UiTaskTemplate;
  onChange: (patch: Partial<UiTaskTemplate>) => void;
  onCycleOwner: () => void;
  onSave: () => void;
  roommates: UiRoommate[];
  saving: boolean;
}) {
  return (
    <View style={styles.inlineEditor}>
      <View style={styles.inlineEditorHeader}>
        <Text style={styles.inlineEditorTitle}>Quick edit</Text>
        <ActionButton label="Save inline" onPress={onSave} busy={saving} />
      </View>

      <TextField
        label="Task title"
        onChangeText={(value) => onChange({ title: value })}
        value={draft.title}
      />

      <TextField
        label="Short description"
        onChangeText={(value) => onChange({ description: value })}
        value={draft.description}
      />

      <View style={styles.inlineEditorSection}>
        <Text style={styles.inlineEditorLabel}>Next up in rotation</Text>
        <View style={styles.inlineChipRow}>
          {roommates.map((roommate) => {
            const selected = draft.assigneeId === roommate.id;
            return (
              <Pressable
                key={`${draft.id}-${roommate.id}`}
                onPress={() => {
                  void triggerSelectionFeedback();
                  onChange({
                    assigneeId: roommate.id,
                    assignee: roommate.name
                  });
                }}
                style={[styles.inlineChip, selected ? styles.inlineChipActive : styles.inlineChipIdle]}
              >
                <Text style={[styles.inlineChipLabel, selected ? styles.inlineChipLabelActive : null]}>
                  {roommate.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ActionButton label="Cycle to next roommate" onPress={onCycleOwner} tone="secondary" />
      </View>

      <View style={styles.inlineEditorSection}>
        <Text style={styles.inlineEditorLabel}>Cadence</Text>
        <View style={styles.inlineRow}>
          <View style={styles.inlineGrow}>
            <TextField
              keyboardType="number-pad"
              label="Every"
              onChangeText={(value) =>
                onChange({
                  frequencyInterval: Math.max(1, Number(value) || draft.frequencyInterval)
                })
              }
              value={String(draft.frequencyInterval)}
            />
          </View>
          <View style={styles.inlineGrow}>
            <Text style={styles.inlineFieldLabel}>Unit</Text>
            <View style={styles.inlineChipRow}>
              {frequencyUnits.map((unit) => {
                const selected = draft.frequencyUnit === unit.value;
                return (
                  <Pressable
                    key={`${draft.id}-${unit.value}`}
                    onPress={() => {
                      void triggerSelectionFeedback();
                      onChange({ frequencyUnit: unit.value });
                    }}
                    style={[
                      styles.inlineMiniChip,
                      selected ? styles.inlineMiniChipActive : styles.inlineMiniChipIdle
                    ]}
                  >
                    <Text
                      style={[
                        styles.inlineMiniChipLabel,
                        selected ? styles.inlineMiniChipLabelActive : null
                      ]}
                    >
                      {unit.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.inlineEditorSection}>
        <Text style={styles.inlineEditorLabel}>Task type</Text>
        <View style={styles.inlineChipRow}>
          {[
            { label: "Fixed", value: "fixed_schedule" as const },
            { label: "Rolling", value: "rolling_until_done" as const }
          ].map((option) => {
            const selected = draft.taskMode === option.value;
            return (
              <Pressable
                key={`${draft.id}-${option.value}`}
                onPress={() => {
                  void triggerSelectionFeedback();
                  onChange({
                    taskMode: option.value,
                    advanceRotationOn:
                      option.value === "rolling_until_done"
                        ? "rescue_keeps_owner"
                        : "completed_only"
                  });
                }}
                style={[styles.inlineChip, selected ? styles.inlineChipActive : styles.inlineChipIdle]}
              >
                <Text style={[styles.inlineChipLabel, selected ? styles.inlineChipLabelActive : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.inlineRow}>
        <View style={styles.inlineGrow}>
          <TextField
            keyboardType="number-pad"
            label="Remind after hours"
            onChangeText={(value) =>
              onChange({
                softReminderAfterHours: Math.max(1, Number(value) || draft.softReminderAfterHours)
              })
            }
            value={String(draft.softReminderAfterHours)}
          />
        </View>
        <View style={styles.inlineGrow}>
          <TextField
            keyboardType="number-pad"
            label="Escalate after hours"
            onChangeText={(value) =>
              onChange({
                escalateAfterHours: Math.max(1, Number(value) || draft.escalateAfterHours)
              })
            }
            value={String(draft.escalateAfterHours)}
          />
        </View>
      </View>

      <ToggleRow
        description="Turn this off to pause new assignments without deleting the template."
        onToggle={() => onChange({ isActive: !draft.isActive })}
        title="Task active"
        value={draft.isActive}
      />
    </View>
  );
}

export default function AdminScreen() {
  const {
    activeRoommate,
    saveTaskTemplateDraft,
    setActiveRoommate,
    snapshot,
    triggerTestReminder,
    updateRoommate
  } = useHousehold();
  const [busyAction, setBusyAction] = useState<null | "testReminder" | `move-${string}`>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<UiTaskTemplate | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAuditSource, setAiAuditSource] = useState<string | null>(null);
  const [aiInsights, setAiInsights] = useState<AiHouseInsight[]>([]);

  const orderedRoommates = useMemo(
    () => sortRoommatesByRotation(snapshot.roommates),
    [snapshot.roommates]
  );
  const activeTemplates = snapshot.taskTemplates.filter((template) => template.isActive);
  const rollingTemplates = activeTemplates.filter(
    (template) => template.taskMode === "rolling_until_done"
  );
  const fixedTemplates = activeTemplates.filter(
    (template) => template.taskMode === "fixed_schedule"
  );
  const coverage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const template of activeTemplates.filter((template) => !template.parentTemplateId)) {
      counts.set(template.assigneeId, (counts.get(template.assigneeId) ?? 0) + 1);
    }
    return counts;
  }, [activeTemplates]);

  async function moveRoommate(roommateId: string, direction: -1 | 1) {
    const currentIndex = orderedRoommates.findIndex((roommate) => roommate.id === roommateId);
    const swapIndex = currentIndex + direction;
    if (currentIndex === -1 || swapIndex < 0 || swapIndex >= orderedRoommates.length) {
      return;
    }

    const current = orderedRoommates[currentIndex];
    const target = orderedRoommates[swapIndex];
    const busyKey = `move-${roommateId}` as const;
    setBusyAction(busyKey);

    try {
      await updateRoommate(current.id, { sortOrder: target.sortOrder });
      await updateRoommate(target.id, { sortOrder: current.sortOrder });
    } finally {
      setBusyAction((value) => (value === busyKey ? null : value));
    }
  }

  function openInlineTaskEditor(template: UiTaskTemplate) {
    if (editingTaskId === template.id) {
      setEditingTaskId(null);
      setTaskDraft(null);
      return;
    }

    setEditingTaskId(template.id);
    setTaskDraft({ ...template });
  }

  function updateTaskDraft(patch: Partial<UiTaskTemplate>) {
    setTaskDraft((current) => {
      if (!current) {
        return current;
      }

      const next = {
        ...current,
        ...patch
      };

      return {
        ...next,
        cadenceLabel: formatCadenceLabel(next.frequencyInterval, next.frequencyUnit)
      };
    });
  }

  function cycleTaskOwner(template: UiTaskTemplate) {
    const ordered = buildTaskRotationOrder(orderedRoommates, template.assigneeId);
    if (ordered.length <= 1) {
      return;
    }

    const nextRoommate = ordered[1];
    updateTaskDraft({
      assigneeId: nextRoommate.id,
      assignee: nextRoommate.name
    });
  }

  async function saveInlineTask() {
    if (!taskDraft) {
      return;
    }

    setSavingTaskId(taskDraft.id);
    try {
      await saveTaskTemplateDraft(taskDraft);
      setEditingTaskId(null);
      setTaskDraft(null);
    } finally {
      setSavingTaskId(null);
    }
  }

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="Control room"
        title="Run the house like a system"
        subtitle="Use clear editors, visible rotation order, and strong accountability rules. No more hidden forms tucked below the fold."
      />

      <SectionCard
        title="Acting on behalf of"
        subtitle="You can preview the whole experience as any roommate."
        tone="accent"
      >
        <RoommateSwitcher
          activeRoommateId={activeRoommate.id}
          onSelect={setActiveRoommate}
          roommates={orderedRoommates}
        />
      </SectionCard>

      <SectionCard
        title="Launch actions"
        subtitle="Everything important now opens its own screen instead of editing inline."
      >
        <View style={styles.actionGrid}>
          <ActionButton
            label="Create task"
            onPress={() => router.push("/task-editor")}
          />
          <ActionButton
            label="Add roommate"
            onPress={() => router.push("/roommate-editor")}
            tone="secondary"
          />
          <ActionButton
            label="Edit house rules"
            onPress={() => router.push("/house-rules-editor")}
            tone="ghost"
          />
        </View>
      </SectionCard>

      <SectionCard
        title="AI flow audit"
        subtitle="Run an automatic product-level check for setup friction, rotation confusion, and chores that should probably be rolling."
        tone="warning"
      >
        <ActionButton
          busy={aiBusy}
          label="Run AI analysis"
          onPress={() => {
            setAiBusy(true);
            void analyzeHouseWithAi()
              .then((result) => {
                setAiAuditSource(result.model ? `${result.source} • ${result.model}` : result.source);
                setAiInsights(result.insights);
              })
              .finally(() => {
                setAiBusy(false);
              });
          }}
        />
        {aiAuditSource ? <Text style={styles.auditMeta}>Source: {aiAuditSource}</Text> : null}
        {aiInsights.map((insight, index) => (
          <View key={`${insight.title}-${index}`} style={styles.auditCard}>
            <View style={styles.auditTop}>
              <Text style={styles.auditTitle}>{insight.title}</Text>
              <View
                style={[
                  styles.auditImpactBadge,
                  insight.impact === "high"
                    ? styles.auditImpactHigh
                    : insight.impact === "medium"
                      ? styles.auditImpactMedium
                      : styles.auditImpactLow
                ]}
              >
                <Text
                  style={[
                    styles.auditImpactText,
                    insight.impact === "low" ? styles.auditImpactTextLow : null
                  ]}
                >
                  {insight.impact}
                </Text>
              </View>
            </View>
            <Text style={styles.auditRecommendation}>{insight.recommendation}</Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard
        title="House rotation lane"
        subtitle="This is the master order. Rolling chores pull from this sequence when a turn actually completes."
        tone="warning"
      >
        <View style={styles.rotationLane}>
          {orderedRoommates.map((roommate, index) => {
            const doubleLoad = (coverage.get(roommate.id) ?? 0) > 1;
            return (
              <View key={roommate.id} style={styles.rotationCard}>
                <View style={styles.rotationIndex}>
                  <Text style={styles.rotationIndexText}>{index + 1}</Text>
                </View>
                <View style={styles.rotationCopy}>
                  <Text style={styles.rotationName}>{roommate.name}</Text>
                  <Text style={styles.rotationMeta}>
                    {coverage.get(roommate.id) ?? 0} primary task
                    {(coverage.get(roommate.id) ?? 0) === 1 ? "" : "s"} • {roommate.rescueCount} rescues
                  </Text>
                  {doubleLoad ? (
                    <Text style={styles.warningCopy}>Double load warning on this round</Text>
                  ) : null}
                </View>
                <View style={styles.rotationActions}>
                  <Pressable
                    disabled={index === 0 || busyAction === `move-${roommate.id}`}
                    onPress={() => void moveRoommate(roommate.id, -1)}
                    style={({ pressed }) => [
                      styles.iconButton,
                      pressed ? styles.iconButtonPressed : null,
                      index === 0 ? styles.iconButtonDisabled : null
                    ]}
                  >
                    <Feather color={colors.ink} name="arrow-up" size={18} />
                  </Pressable>
                  <Pressable
                    disabled={
                      index === orderedRoommates.length - 1 || busyAction === `move-${roommate.id}`
                    }
                    onPress={() => void moveRoommate(roommate.id, 1)}
                    style={({ pressed }) => [
                      styles.iconButton,
                      pressed ? styles.iconButtonPressed : null,
                      index === orderedRoommates.length - 1 ? styles.iconButtonDisabled : null
                    ]}
                  >
                    <Feather color={colors.ink} name="arrow-down" size={18} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      </SectionCard>

      <SectionCard
        title="Rolling ownership tasks"
        subtitle="Use this for dishwasher, trash, recycling, and anything that should stick to an owner until someone actually resolves it."
        tone="danger"
      >
        {rollingTemplates.map((template) => (
          <Pressable
            key={template.id}
            onPress={() => {
              void triggerSelectionFeedback();
              openInlineTaskEditor(template);
            }}
            style={({ pressed }) => [styles.templateCard, pressed ? styles.templateCardPressed : null]}
          >
            <View style={styles.templateTop}>
              <View style={styles.templateTitleWrap}>
                <Text style={styles.templateTitle}>{template.title}</Text>
                <Text style={styles.templateMeta}>
                  Next up: {template.assignee} • rescue rule: keep owner
                </Text>
              </View>
              <View style={[styles.modeBadge, styles.modeBadgeDanger]}>
                <Text style={styles.modeBadgeText}>Rolling</Text>
              </View>
            </View>
            <Text style={styles.templateDescription}>{template.description}</Text>
            <View style={styles.trackWrap}>
              <Text style={styles.trackLabel}>Turn order</Text>
              <TaskRotationTrack nextRoommateId={template.assigneeId} roommates={orderedRoommates} />
            </View>
            <View style={styles.templateActions}>
              <ActionButton
                label={editingTaskId === template.id ? "Close inline editor" : "Edit inline"}
                onPress={() => openInlineTaskEditor(template)}
                tone="secondary"
              />
              <ActionButton
                label="Open full editor"
                onPress={() =>
                  router.push({ pathname: "/task-editor", params: { taskId: template.id } })
                }
                tone="ghost"
              />
            </View>
            {editingTaskId === template.id && taskDraft ? (
              <TaskInlineEditor
                draft={taskDraft}
                onChange={updateTaskDraft}
                onCycleOwner={() => cycleTaskOwner(taskDraft)}
                onSave={() => {
                  void saveInlineTask();
                }}
                roommates={orderedRoommates}
                saving={savingTaskId === template.id}
              />
            ) : null}
          </Pressable>
        ))}
        {rollingTemplates.length === 0 ? (
          <Text style={styles.emptyCopy}>No rolling tasks yet. Create one for trash or dishwasher.</Text>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Fixed recurring tasks"
        subtitle="Bathrooms, floors, and monthly deep-clean items stay on a steady cadence."
      >
        {fixedTemplates.map((template) => (
          <Pressable
            key={template.id}
            onPress={() => {
              void triggerSelectionFeedback();
              openInlineTaskEditor(template);
            }}
            style={({ pressed }) => [styles.templateCard, pressed ? styles.templateCardPressed : null]}
          >
            <View style={styles.templateTop}>
              <View style={styles.templateTitleWrap}>
                <Text style={styles.templateTitle}>{template.title}</Text>
                <Text style={styles.templateMeta}>
                  {template.cadenceLabel} • {template.assignee}
                </Text>
              </View>
              <View style={styles.modeBadge}>
                <Text style={styles.modeBadgeText}>{formatTaskMode(template.taskMode)}</Text>
              </View>
            </View>
            <Text style={styles.templateDescription}>{template.description}</Text>
            <View style={styles.trackWrap}>
              <Text style={styles.trackLabel}>Turn order</Text>
              <TaskRotationTrack nextRoommateId={template.assigneeId} roommates={orderedRoommates} />
            </View>
            <View style={styles.templateActions}>
              <ActionButton
                label={editingTaskId === template.id ? "Close inline editor" : "Edit inline"}
                onPress={() => openInlineTaskEditor(template)}
                tone="secondary"
              />
              <ActionButton
                label="Open full editor"
                onPress={() =>
                  router.push({ pathname: "/task-editor", params: { taskId: template.id } })
                }
                tone="ghost"
              />
            </View>
            {editingTaskId === template.id && taskDraft ? (
              <TaskInlineEditor
                draft={taskDraft}
                onChange={updateTaskDraft}
                onCycleOwner={() => cycleTaskOwner(taskDraft)}
                onSave={() => {
                  void saveInlineTask();
                }}
                roommates={orderedRoommates}
                saving={savingTaskId === template.id}
              />
            ) : null}
          </Pressable>
        ))}
      </SectionCard>

      <SectionCard
        title="Roommate roster"
        subtitle="Edit each person on a dedicated screen. Scores, strikes, and rescues stay visible here."
      >
        {orderedRoommates.map((roommate) => (
          <Pressable
            key={roommate.id}
            onPress={() => {
              void triggerSelectionFeedback();
              router.push({ pathname: "/roommate-editor", params: { roommateId: roommate.id } });
            }}
            style={({ pressed }) => [styles.roommateRow, pressed ? styles.templateCardPressed : null]}
          >
            <View style={styles.roommateAvatar}>
              <Text style={styles.roommateAvatarText}>{roommate.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.roommateCopy}>
              <Text style={styles.roommateName}>{roommate.name}</Text>
              <Text style={styles.roommateMeta}>
                {roommate.pendingCount} open • {roommate.strikeCount} strikes • {roommate.rescueCount} rescues
              </Text>
            </View>
            <Feather color={colors.accent} name="chevron-right" size={20} />
          </Pressable>
        ))}
      </SectionCard>

      <SectionCard
        title="Messaging check"
        subtitle="Send a real reminder to verify the Twilio flow before roommates rely on it."
        tone="success"
      >
        <Text style={styles.messagingCopy}>
          Current test target: {activeRoommate.name} at {activeRoommate.whatsappNumber}
        </Text>
        <ActionButton
          busy={busyAction === "testReminder"}
          label="Send test reminder"
          onPress={() => {
            setBusyAction("testReminder");
            void triggerTestReminder(activeRoommate.id).finally(() => {
              setBusyAction((value) => (value === "testReminder" ? null : value));
            });
          }}
        />
      </SectionCard>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  actionGrid: {
    gap: spacing.sm
  },
  auditMeta: {
    color: colors.muted,
    fontSize: 13
  },
  auditCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  auditTop: {
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  auditTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: "900"
  },
  auditImpactBadge: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  auditImpactHigh: {
    backgroundColor: colors.danger
  },
  auditImpactMedium: {
    backgroundColor: colors.warning
  },
  auditImpactLow: {
    backgroundColor: colors.surfaceStrong
  },
  auditImpactText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase"
  },
  auditImpactTextLow: {
    color: colors.ink
  },
  auditRecommendation: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20
  },
  rotationLane: {
    gap: spacing.sm
  },
  rotationCard: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  rotationIndex: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  rotationIndexText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "900"
  },
  rotationCopy: {
    flex: 1,
    gap: 4
  },
  rotationName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  rotationMeta: {
    color: colors.muted,
    fontSize: 13
  },
  warningCopy: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: "800"
  },
  rotationActions: {
    gap: spacing.sm
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  iconButtonPressed: {
    transform: [{ scale: 0.96 }]
  },
  iconButtonDisabled: {
    opacity: 0.35
  },
  templateCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  templateCardPressed: {
    transform: [{ scale: 0.988 }]
  },
  templateTop: {
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  templateTitleWrap: {
    flex: 1,
    gap: 4
  },
  templateTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "900"
  },
  templateMeta: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  templateDescription: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 20
  },
  templateActions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  trackWrap: {
    gap: spacing.sm,
    paddingTop: spacing.xs
  },
  trackLabel: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase"
  },
  trackRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs
  },
  trackItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs
  },
  trackCircle: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 58,
    minWidth: 58,
    paddingHorizontal: spacing.md
  },
  trackCircleNext: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  trackCircleLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center"
  },
  trackCircleLabelNext: {
    color: colors.white
  },
  trackArrow: {
    marginHorizontal: 2
  },
  inlineEditor: {
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md
  },
  inlineEditorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between"
  },
  inlineEditorTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  inlineEditorSection: {
    gap: spacing.sm
  },
  inlineEditorLabel: {
    color: colors.accentStrong,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase"
  },
  inlineFieldLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: "uppercase"
  },
  inlineChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm
  },
  inlineChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  inlineChipIdle: {
    backgroundColor: colors.white,
    borderColor: colors.border
  },
  inlineChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  inlineChipLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800"
  },
  inlineChipLabelActive: {
    color: colors.white
  },
  inlineMiniChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  inlineMiniChipIdle: {
    backgroundColor: colors.white,
    borderColor: colors.border
  },
  inlineMiniChipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
  },
  inlineMiniChipLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800"
  },
  inlineMiniChipLabelActive: {
    color: colors.white
  },
  inlineRow: {
    flexDirection: "row",
    gap: spacing.md
  },
  inlineGrow: {
    flex: 1
  },
  modeBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  modeBadgeDanger: {
    backgroundColor: colors.dangerSoft
  },
  modeBadgeText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800"
  },
  roommateRow: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md
  },
  roommateAvatar: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  roommateAvatarText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "900"
  },
  roommateCopy: {
    flex: 1,
    gap: 4
  },
  roommateName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900"
  },
  roommateMeta: {
    color: colors.muted,
    fontSize: 13
  },
  messagingCopy: {
    color: colors.ink,
    fontSize: 15,
    lineHeight: 22
  },
  emptyCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  }
});
