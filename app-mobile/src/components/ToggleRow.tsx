import { Pressable, StyleSheet, Text, View } from "react-native";

import { triggerSelectionFeedback } from "@/src/lib/feedback";
import { colors, radii, spacing } from "@/src/theme";

export function ToggleRow({
  description,
  onToggle,
  title,
  value
}: {
  description: string;
  onToggle: () => void;
  title: string;
  value: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        void triggerSelectionFeedback();
        onToggle();
      }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
      </View>
      <View style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}>
        <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.lg,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  rowPressed: {
    backgroundColor: colors.cardMuted
  },
  copy: {
    flex: 1,
    gap: 3
  },
  title: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  description: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  },
  toggle: {
    borderRadius: radii.pill,
    height: 32,
    justifyContent: "center",
    width: 58
  },
  toggleOn: {
    backgroundColor: colors.accent
  },
  toggleOff: {
    backgroundColor: colors.border
  },
  knob: {
    backgroundColor: colors.white,
    borderRadius: radii.pill,
    height: 24,
    width: 24
  },
  knobOn: {
    alignSelf: "flex-end",
    marginRight: 4
  },
  knobOff: {
    alignSelf: "flex-start",
    marginLeft: 4
  }
});
