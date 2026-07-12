import { AlertTriangle } from "lucide-react-native"
import { Pressable, Text, View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"

export function ErrorBanner(props: { message: string; actionLabel?: string; onAction?(): void }) {
  const { palette } = useAppTheme()

  return (
    <View
      className="overflow-hidden p-4"
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.danger, 0.2),
        backgroundColor: hexToRgba(palette.danger, 0.08),
      }}
    >
      <View className="flex-row items-start gap-3">
        <AlertTriangle size={16} color={palette.danger} strokeWidth={2.1} style={{ marginTop: 2 }} />
        <View className="flex-1 gap-1">
          <Text style={{ fontSize: 13, fontWeight: "600", color: palette.danger }}>Needs attention</Text>
          <Text selectable className="text-sm leading-5 text-soft">
            {props.message}
          </Text>
          {props.actionLabel && props.onAction ? (
            <Pressable
              onPress={props.onAction}
              accessibilityRole="button"
              accessibilityLabel={props.actionLabel}
              style={({ pressed }) => ({ marginTop: 8, opacity: pressed ? 0.75 : 1, alignSelf: "flex-start" })}
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: palette.danger }}>{props.actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  )
}
