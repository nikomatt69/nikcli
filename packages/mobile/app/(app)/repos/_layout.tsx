import { Stack } from "expo-router"
import { useAppTheme } from "@/lib/theme"

export default function ReposLayout() {
  const { palette } = useAppTheme()

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
      }}
    />
  )
}
