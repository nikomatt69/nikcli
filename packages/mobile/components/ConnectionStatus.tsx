import { Text, View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

export function ConnectionStatus(props: { connected: boolean; label: string }) {
  const { palette } = useAppTheme()
  const label = props.label || (props.connected ? "Online" : "Offline")
  const color = props.connected ? palette.success : palette.danger

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(color, 0.28),
        backgroundColor: hexToRgba(color, 0.12),
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: color }} />
      <Text selectable style={{ color, fontWeight: "600", ...typeStyle(12) }}>
        {label}
      </Text>
    </View>
  )
}
