import { Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"

type InfoChipProps = {
  label: string
  tone?: "neutral" | "accent" | "good" | "warn"
}

export function InfoChip({ label, tone = "neutral" }: InfoChipProps) {
  const { palette, isDark } = useAppTheme()

  const backgroundColor =
    tone === "accent"
      ? isDark
        ? "rgba(255,255,255,0.08)"
        : "rgba(14,165,233,0.10)"
      : tone === "good"
        ? isDark
          ? "rgba(212,212,212,0.08)"
          : "rgba(34,197,94,0.10)"
        : tone === "warn"
          ? isDark
            ? "rgba(143,143,143,0.08)"
            : "rgba(239,68,68,0.10)"
          : isDark
            ? "rgba(255,255,255,0.05)"
            : "rgba(241,246,251,0.8)"

  const borderColor =
    tone === "accent"
      ? isDark
        ? "rgba(255,255,255,0.12)"
        : "rgba(14,165,233,0.18)"
      : tone === "good"
        ? isDark
          ? "rgba(212,212,212,0.16)"
          : "rgba(34,197,94,0.22)"
        : tone === "warn"
          ? isDark
            ? "rgba(143,143,143,0.16)"
            : "rgba(239,68,68,0.22)"
          : isDark
            ? "rgba(255,255,255,0.08)"
            : "rgba(193,208,223,0.72)"

  const textColor =
    tone === "accent"
      ? palette.accentLight
      : tone === "good"
        ? palette.success
        : tone === "warn"
          ? palette.danger
          : palette.ink
  const dotColor = tone === "accent" ? palette.accent : tone === "good" ? palette.success : palette.danger

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor,
        backgroundColor,
        paddingHorizontal: 11,
        paddingVertical: 7,
      }}
    >
      {tone !== "neutral" ? (
        <View
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            backgroundColor: dotColor,
          }}
        />
      ) : null}
      <Text
        selectable
        style={{
          color: textColor,
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.15,
          fontVariant: ["tabular-nums"],
        }}
      >
        {label}
      </Text>
    </View>
  )
}
