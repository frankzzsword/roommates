import { useState } from "react";
import { KeyboardTypeOptions, StyleSheet, Text, TextInput, View } from "react-native";

import { triggerSelectionFeedback } from "@/src/lib/feedback";
import { colors, radii, spacing } from "@/src/theme";

export function TextField({
  label,
  keyboardType,
  multiline = false,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  value
}: {
  label: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  value: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        onChangeText={onChangeText}
        onBlur={() => setFocused(false)}
        onFocus={() => {
          setFocused(true);
          void triggerSelectionFeedback();
        }}
        keyboardType={keyboardType}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={secureTextEntry}
        style={[
          styles.input,
          multiline ? styles.multiline : null,
          focused ? styles.inputFocused : null
        ]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs
  },
  label: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase"
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md
  },
  inputFocused: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 18
  },
  multiline: {
    minHeight: 84,
    textAlignVertical: "top"
  }
});
