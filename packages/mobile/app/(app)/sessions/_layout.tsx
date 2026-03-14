import { Stack } from "expo-router"

export default function SessionsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#06121f" },
        animation: "slide_from_right",
      }}
    />
  )
}
