import { Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"

type StatusPillProps = {
  label: string
  value: string
  tone?: "neutral" | "good" | "warn"
  compact?: boolean
}

export function StatusPill({ label, value, tone = "neutral", compact = false }: StatusPillProps) {
  const { palette, isDark } = useAppTheme()

  const pillBg =
    tone === "good"
      ? isDark
        ? "rgba(212,212,212,0.08)"
        : "rgba(34,197,94,0.08)"
      : tone === "warn"
        ? isDark
          ? "rgba(143,143,143,0.08)"
          : "rgba(239,68,68,0.08)"
        : isDark
          ? "rgba(255,255,255,0.05)"
          : "rgba(241,246,251,0.55)"

  const pillBorder =
    tone === "good"
      ? isDark
        ? "rgba(212,212,212,0.16)"
        : "rgba(34,197,94,0.20)"
      : tone === "warn"
        ? isDark
          ? "rgba(143,143,143,0.18)"
          : "rgba(239,68,68,0.22)"
        : isDark
          ? "rgba(255,255,255,0.08)"
          : "rgba(193,208,223,0.8)"

  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: pillBorder,
        backgroundColor: pillBg,
        paddingHorizontal: compact ? 8 : 12,
        paddingVertical: compact ? 6 : 10,
      }}
    >
      <Text
        selectable
        style={{
          fontSize: compact ? 8 : 10,
          fontWeight: "700",
          letterSpacing: 1.3,
          textTransform: "uppercase",
          color: palette.soft,
        }}
      >
        {label}
      </Text>
      <Text
        selectable
        style={{
          marginTop: 2,
          fontSize: compact ? 10 : 12,
          fontWeight: "600",
          color: palette.ink,
        }}
      >
        {value}
      </Text>
    </View>
  )
}
