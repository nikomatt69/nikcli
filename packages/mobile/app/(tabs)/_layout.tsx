import { View, StyleSheet } from "react-native"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"

export default function TabsLayout() {
  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
          contentStyle: { backgroundColor: "#fefbff" },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="sessions" />
        <Stack.Screen name="events" />
        <Stack.Screen name="settings" />
        <Stack.Screen
          name="[id]"
          options={{
            headerShown: true,
            headerBackButtonDisplayMode: "minimal",
            headerStyle: {
              backgroundColor: "#fefbff",
            },
            headerTintColor: "#1a1c20",
          }}
        />
      </Stack>
      <StatusBar style="auto" />
    </>
  )
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  tab: {
    alignItems: "center",
    gap: 4,
    padding: 8,
  },
  tabLabel: {
    fontSize: 10,
  },
})
