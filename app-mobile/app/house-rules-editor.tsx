import { router } from "expo-router";
import { useEffect, useState } from "react";

import { ActionButton } from "@/src/components/ActionButton";
import { AppScreen } from "@/src/components/Screen";
import { ScreenHeader } from "@/src/components/ScreenHeader";
import { SectionCard } from "@/src/components/SectionCard";
import { TextField } from "@/src/components/TextField";
import { ToggleRow } from "@/src/components/ToggleRow";
import { useHousehold } from "@/src/context/HouseholdContext";

export default function HouseRulesEditorScreen() {
  const { snapshot, updateHouseSettings } = useHousehold();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    weeklyAchievementLabel: snapshot.settings.weeklyAchievementLabel,
    monthlyAchievementLabel: snapshot.settings.monthlyAchievementLabel,
    autoReminders: snapshot.settings.autoReminders,
    weeklySummary: snapshot.settings.weeklySummary
  });

  useEffect(() => {
    setDraft({
      weeklyAchievementLabel: snapshot.settings.weeklyAchievementLabel,
      monthlyAchievementLabel: snapshot.settings.monthlyAchievementLabel,
      autoReminders: snapshot.settings.autoReminders,
      weeklySummary: snapshot.settings.weeklySummary
    });
  }, [snapshot.settings]);

  return (
    <AppScreen>
      <ScreenHeader
        eyebrow="House rules"
        title="Configure titles and automation"
        subtitle="This editor controls the house-wide language, summary behaviour, and reminder automation."
        accessory={<ActionButton label="Close" onPress={() => router.back()} tone="ghost" />}
      />

      <SectionCard title="Achievement titles" subtitle="Make the scoreboard feel like your flat, not a generic chores app.">
        <TextField
          label="Weekly title"
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, weeklyAchievementLabel: value }))
          }
          value={draft.weeklyAchievementLabel}
        />
        <TextField
          label="Monthly title"
          onChangeText={(value) =>
            setDraft((current) => ({ ...current, monthlyAchievementLabel: value }))
          }
          value={draft.monthlyAchievementLabel}
        />
      </SectionCard>

      <SectionCard title="Automation" subtitle="These switches apply to everyone in the house.">
        <ToggleRow
          description="Let the bot nudge people automatically when tasks age into reminder windows."
          onToggle={() =>
            setDraft((current) => ({ ...current, autoReminders: !current.autoReminders }))
          }
          title="Automatic reminders"
          value={draft.autoReminders}
        />
        <ToggleRow
          description="Send the weekly recap with misses, rescues, and who is carrying the house."
          onToggle={() =>
            setDraft((current) => ({ ...current, weeklySummary: !current.weeklySummary }))
          }
          title="Weekly summary"
          value={draft.weeklySummary}
        />
      </SectionCard>

      <SectionCard title="Save changes" subtitle="These settings update the whole house immediately.">
        <ActionButton
          busy={busy}
          label="Save house rules"
          onPress={() => {
            setBusy(true);
            void updateHouseSettings(draft).finally(() => {
              setBusy(false);
              router.back();
            });
          }}
        />
      </SectionCard>
    </AppScreen>
  );
}
