import { AlertTriangle } from "lucide-react-native"
import { Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"

export function ErrorBanner(props: { message: string }) {
  const { palette, isDark } = useAppTheme()

  return (
    <View
      className="overflow-hidden rounded-[8px] border px-4 py-4"
      style={{
        borderColor: isDark ? "rgba(251,113,133,0.24)" : "rgba(239,68,68,0.24)",
        backgroundColor: isDark ? "rgba(251,113,133,0.10)" : "rgba(239,68,68,0.08)",
      }}
    >
      <View className="flex-row items-start gap-3">
        <View className="mt-0.5 rounded-[8px] border border-danger/25 bg-danger/15 p-2">
          <AlertTriangle size={14} color={palette.danger} strokeWidth={2.1} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-[11px] font-semibold uppercase tracking-[1.6px] text-danger">Needs attention</Text>
          <Text selectable className="text-sm leading-6 text-soft">
            {props.message}
          </Text>
        </View>
      </View>
    </View>
  )
}
