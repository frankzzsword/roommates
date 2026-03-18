import { PropsWithChildren } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing } from "@/src/theme";

export function AppScreen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.safe}>
      <View pointerEvents="none" style={styles.glowOne} />
      <View pointerEvents="none" style={styles.glowTwo} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stack}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1
  },
  glowOne: {
    backgroundColor: colors.spotlight,
    borderRadius: 180,
    height: 220,
    opacity: 0.65,
    position: "absolute",
    right: -60,
    top: -30,
    width: 220
  },
  glowTwo: {
    backgroundColor: colors.infoSoft,
    borderRadius: 180,
    height: 180,
    left: -60,
    opacity: 0.85,
    position: "absolute",
    top: 160,
    width: 180
  },
  content: {
    paddingBottom: spacing.xxxl
  },
  stack: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  }
});
