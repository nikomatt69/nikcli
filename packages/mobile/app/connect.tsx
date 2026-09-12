import { View } from "react-native"
import { useLocalSearchParams } from "expo-router"
import { ConnectScreen } from "@/components/connect-screen"
import { useAppTheme } from "@/lib/theme"

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/** Explicit pairing screen. Never auto-skips the way `/` does after a successful ping. */
export default function ConnectRoute() {
  const { palette } = useAppTheme()
  const { intent } = useLocalSearchParams<{ intent?: string | string[] }>()
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <ConnectScreen mode={paramValue(intent) === "add" ? "add" : "pair"} />
    </View>
  )
}
