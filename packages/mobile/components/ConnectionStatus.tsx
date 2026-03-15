import { Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"

export function ConnectionStatus(props: { connected: boolean; label: string }) {
  const { palette } = useAppTheme()
  const label = props.label || (props.connected ? "Online" : "Offline")
  const tone = props.connected
    ? {
        border: "border-success/20",
        background: "bg-success/10",
        text: "text-emerald-200",
        dot: palette.success,
      }
    : {
        border: "border-danger/20",
        background: "bg-danger/10",
        text: "text-rose-200",
        dot: palette.danger,
      }

  return (
    <View className={`flex-row items-center gap-3 rounded-full border px-4 py-2.5 ${tone.border} ${tone.background}`}>
      <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone.dot }} />
      <Text className={`text-[11px] font-semibold uppercase tracking-[2px] ${tone.text}`}>{label}</Text>
    </View>
  )
}
