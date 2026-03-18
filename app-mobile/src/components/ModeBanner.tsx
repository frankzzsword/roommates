import { StyleSheet, Text, View } from "react-native";

import { SectionCard } from "@/src/components/SectionCard";
import { colors, radii, spacing } from "@/src/theme";

export function ModeBanner({
  mode,
  message
}: {
  mode: "preview" | "live" | "hybrid";
  message: string;
}) {
  const copy =
    mode === "live"
      ? "Live household data"
      : mode === "hybrid"
        ? "Live chores, local config"
        : "Preview mode";

  return (
    <SectionCard>
      <View style={styles.row}>
        <View style={[styles.dot, mode === "live" ? styles.live : styles.preview]} />
        <View style={styles.copy}>
          <Text style={styles.title}>{copy}</Text>
          <Text style={styles.subtitle}>{message}</Text>
        </View>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  dot: {
    borderRadius: radii.pill,
    height: 14,
    width: 14
  },
  live: {
    backgroundColor: colors.success
  },
  preview: {
    backgroundColor: colors.warning
  },
  copy: {
    flex: 1,
    gap: 2
  },
  title: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18
  }
});
