import { Stack } from "expo-router"

export default function ReposLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#06121f" },
      }}
    />
  )
}
