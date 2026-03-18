import { PropsWithChildren } from "react";
import { View, Text, StyleSheet, StyleProp, ViewStyle } from "react-native";

import { colors, radii, spacing } from "@/src/theme";

type SectionCardProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
}>;

export function SectionCard({
  children,
  subtitle,
  style,
  tone = "default",
  title,
}: SectionCardProps) {
  return (
    <View
      style={[
        styles.card,
        tone === "accent"
          ? styles.cardAccent
          : tone === "success"
            ? styles.cardSuccess
            : tone === "warning"
              ? styles.cardWarning
              : tone === "danger"
                ? styles.cardDanger
                : null,
        style
      ]}
    >
      <View
        style={[
          styles.ribbon,
          tone === "accent"
            ? styles.ribbonAccent
            : tone === "success"
              ? styles.ribbonSuccess
              : tone === "warning"
                ? styles.ribbonWarning
                : tone === "danger"
                  ? styles.ribbonDanger
                  : styles.ribbonDefault
        ]}
      />
      {(title || subtitle) && (
        <View style={styles.header}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      )}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    overflow: "hidden",
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  },
  cardAccent: {
    borderColor: "#bfd0ff"
  },
  cardSuccess: {
    borderColor: "#bbe8d3"
  },
  cardWarning: {
    borderColor: "#ffd3b4"
  },
  cardDanger: {
    borderColor: "#ffc1cf"
  },
  ribbon: {
    height: 8,
    marginBottom: spacing.md,
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg
  },
  ribbonDefault: {
    backgroundColor: colors.cardMuted
  },
  ribbonAccent: {
    backgroundColor: colors.accent
  },
  ribbonSuccess: {
    backgroundColor: colors.success
  },
  ribbonWarning: {
    backgroundColor: colors.warning
  },
  ribbonDanger: {
    backgroundColor: colors.danger
  },
  header: {
    gap: 6,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    gap: spacing.sm,
  },
});
