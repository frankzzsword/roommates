import * as Haptics from "expo-haptics";

export async function triggerSelectionFeedback() {
  try {
    await Haptics.selectionAsync();
  } catch {
    // Ignore haptics failures on unsupported devices.
  }
}

export async function triggerImpactFeedback(
  style: "light" | "medium" | "heavy" = "light"
) {
  try {
    const impactStyle =
      style === "heavy"
        ? Haptics.ImpactFeedbackStyle.Heavy
        : style === "medium"
          ? Haptics.ImpactFeedbackStyle.Medium
          : Haptics.ImpactFeedbackStyle.Light;
    await Haptics.impactAsync(impactStyle);
  } catch {
    // Ignore haptics failures on unsupported devices.
  }
}

export async function triggerSuccessFeedback() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // Ignore haptics failures on unsupported devices.
  }
}

export async function triggerErrorFeedback() {
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // Ignore haptics failures on unsupported devices.
  }
}
