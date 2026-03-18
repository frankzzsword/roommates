import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { triggerSelectionFeedback } from "@/src/lib/feedback";
import type { UiRoommate } from "@/src/lib/types";
import { colors, radii, spacing } from "@/src/theme";

export function RoommateSwitcher({
  activeRoommateId,
  onSelect,
  roommates
}: {
  activeRoommateId: string;
  onSelect: (roommateId: string) => void;
  roommates: UiRoommate[];
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.row}>
        {roommates.map((roommate) => {
          const active = roommate.id === activeRoommateId;

          return (
            <Pressable
              key={roommate.id}
              onPress={() => {
                void triggerSelectionFeedback();
                onSelect(roommate.id);
              }}
              style={({ pressed }) => [
                styles.chip,
                active ? styles.chipActive : styles.chipIdle,
                pressed ? styles.chipPressed : null
              ]}
            >
              <View style={[styles.avatar, active ? styles.avatarActive : styles.avatarIdle]}>
                <Text style={[styles.avatarText, active ? styles.avatarTextActive : null]}>
                  {roommate.name.slice(0, 1)}
                </Text>
              </View>
              <View style={styles.copy}>
                <Text style={[styles.name, active ? styles.nameActive : null]}>
                  {roommate.name}
                </Text>
                <Text style={[styles.meta, active ? styles.metaActive : null]}>
                  {roommate.pendingCount} open • {roommate.rescueCount} rescues
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm
  },
  chip: {
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 168,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18
  },
  chipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  chipIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.border
  },
  chipPressed: {
    transform: [{ scale: 0.98 }]
  },
  avatar: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  avatarActive: {
    backgroundColor: colors.white
  },
  avatarIdle: {
    backgroundColor: colors.cardMuted
  },
  avatarText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800"
  },
  avatarTextActive: {
    color: colors.accentStrong
  },
  copy: {
    gap: 2
  },
  name: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700"
  },
  nameActive: {
    color: colors.white
  },
  meta: {
    color: colors.muted,
    fontSize: 12
  },
  metaActive: {
    color: "#dfe7ff"
  }
});
