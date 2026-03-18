import { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";

import { useHousehold } from "@/src/context/HouseholdContext";
import {
  triggerErrorFeedback,
  triggerSelectionFeedback,
  triggerSuccessFeedback
} from "@/src/lib/feedback";
import { colors, radii, spacing } from "@/src/theme";

export function FeedbackToast() {
  const { clearSyncNotice, syncNotice } = useHousehold();
  const lastMessageRef = useRef<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    if (!syncNotice) {
      Animated.parallel([
        Animated.timing(opacity, {
          duration: 160,
          toValue: 0,
          useNativeDriver: true
        }),
        Animated.timing(translateY, {
          duration: 160,
          toValue: 16,
          useNativeDriver: true
        })
      ]).start();
      return;
    }

    Animated.parallel([
      Animated.spring(opacity, {
        damping: 18,
        mass: 0.9,
        stiffness: 180,
        toValue: 1,
        useNativeDriver: true
      }),
      Animated.spring(translateY, {
        damping: 18,
        mass: 0.9,
        stiffness: 180,
        toValue: 0,
        useNativeDriver: true
      })
    ]).start();
  }, [opacity, syncNotice, translateY]);

  useEffect(() => {
    if (!syncNotice || lastMessageRef.current === syncNotice) {
      return;
    }

    lastMessageRef.current = syncNotice;
    const looksLikeError = /unable|failed|error|sandbox/i.test(syncNotice);

    if (looksLikeError) {
      void triggerErrorFeedback();
      return;
    }

    void triggerSuccessFeedback();
  }, [syncNotice]);

  if (!syncNotice) {
    return null;
  }

  const looksLikeError = /unable|failed|error|sandbox/i.test(syncNotice);

  return (
    <View pointerEvents="box-none" style={styles.container}>
      <Animated.View
        style={[
          styles.toastWrap,
          {
            opacity,
            transform: [{ translateY }]
          }
        ]}
      >
        <Pressable
          onPress={() => {
            void triggerSelectionFeedback();
            clearSyncNotice();
          }}
          style={({ pressed }) => [
            styles.toast,
            looksLikeError ? styles.toastError : styles.toastSuccess,
            pressed ? styles.toastPressed : null
          ]}
        >
          <View style={[styles.dot, looksLikeError ? styles.dotError : styles.dotSuccess]} />
          <Text style={styles.message}>{syncNotice}</Text>
          <Text style={styles.dismiss}>Dismiss</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    bottom: spacing.lg,
    left: spacing.lg,
    position: "absolute",
    right: spacing.lg
  },
  toastWrap: {
    alignSelf: "stretch"
  },
  toast: {
    alignItems: "center",
    borderRadius: radii.xl,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24
  },
  toastSuccess: {
    backgroundColor: colors.ink
  },
  toastError: {
    backgroundColor: colors.danger
  },
  toastPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }]
  },
  dot: {
    borderRadius: radii.pill,
    height: 10,
    width: 10
  },
  dotSuccess: {
    backgroundColor: colors.success
  },
  dotError: {
    backgroundColor: colors.spotlight
  },
  message: {
    color: colors.white,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  dismiss: {
    color: "#d7c7b7",
    fontSize: 12,
    fontWeight: "800"
  }
});
