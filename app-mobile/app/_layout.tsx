import "react-native-reanimated";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { FeedbackToast } from "@/src/components/FeedbackToast";
import { HouseholdProvider } from "@/src/context/HouseholdContext";

export default function RootLayout() {
  return (
    <HouseholdProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="task-editor"
          options={{ animation: "slide_from_right", presentation: "card" }}
        />
        <Stack.Screen
          name="roommate-editor"
          options={{ animation: "slide_from_right", presentation: "card" }}
        />
        <Stack.Screen
          name="house-rules-editor"
          options={{ animation: "slide_from_bottom", presentation: "modal" }}
        />
      </Stack>
      <FeedbackToast />
    </HouseholdProvider>
  );
}
