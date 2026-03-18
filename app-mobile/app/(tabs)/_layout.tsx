import { Feather } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";

import { useHousehold } from "@/src/context/HouseholdContext";
import { triggerSelectionFeedback } from "@/src/lib/feedback";
import { colors } from "@/src/theme";

export default function TabsLayout() {
  const { isAuthenticated } = useHousehold();

  if (!isAuthenticated) {
    return <Redirect href="/login" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          height: 82,
          paddingBottom: 12,
          paddingTop: 12,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "700",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        listeners={{
          tabPress: () => {
            void triggerSelectionFeedback();
          }
        }}
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Feather color={color} name="home" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="chores"
        listeners={{
          tabPress: () => {
            void triggerSelectionFeedback();
          }
        }}
        options={{
          title: "Tasks",
          tabBarIcon: ({ color, size }) => (
            <Feather color={color} name="check-square" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="penalties"
        listeners={{
          tabPress: () => {
            void triggerSelectionFeedback();
          }
        }}
        options={{
          title: "Money",
          tabBarIcon: ({ color, size }) => (
            <Feather color={color} name="credit-card" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="admin"
        listeners={{
          tabPress: () => {
            void triggerSelectionFeedback();
          }
        }}
        options={{
          title: "Weekly",
          tabBarIcon: ({ color, size }) => (
            <Feather color={color} name="calendar" size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        listeners={{
          tabPress: () => {
            void triggerSelectionFeedback();
          }
        }}
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Feather color={color} name="sliders" size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
