import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { triggerImpactFeedback } from "@/src/lib/feedback";
import { colors, radii, spacing } from "@/src/theme";

export function ActionButton({
  disabled = false,
  busy = false,
  label,
  onPress,
  tone = "primary"
}: {
  disabled?: boolean;
  busy?: boolean;
  label: string;
  onPress: () => void;
  tone?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={() => {
        void triggerImpactFeedback(tone === "primary" ? "medium" : "light");
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        tone === "secondary"
          ? styles.secondary
          : tone === "danger"
            ? styles.danger
          : tone === "ghost"
            ? styles.ghost
            : styles.primary,
        (disabled || busy) ? styles.disabled : null,
        pressed ? styles.pressed : null
      ]}
    >
      <View style={styles.content}>
        {busy ? (
          <ActivityIndicator
            color={tone === "primary" || tone === "danger" ? colors.white : colors.ink}
            size="small"
          />
        ) : null}
        <Text
          style={[
            styles.label,
            tone === "secondary" ? styles.secondaryLabel : null,
            tone === "danger" ? styles.primaryLabel : null,
            tone === "ghost" ? styles.ghostLabel : null
          ]}
        >
          {busy ? "Working..." : label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.lg,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20
  },
  content: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  primary: {
    backgroundColor: colors.accent
  },
  secondary: {
    backgroundColor: colors.white,
    borderColor: colors.accent,
    borderWidth: 1
  },
  danger: {
    backgroundColor: colors.danger
  },
  ghost: {
    backgroundColor: colors.surfaceStrong,
    shadowOpacity: 0
  },
  disabled: {
    opacity: 0.55
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }]
  },
  label: {
    color: colors.white,
    fontSize: 15,
    fontWeight: "800"
  },
  primaryLabel: {
    color: colors.white
  },
  secondaryLabel: {
    color: colors.accentStrong
  },
  ghostLabel: {
    color: colors.ink
  }
});
