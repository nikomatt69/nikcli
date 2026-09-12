import { Text, View } from "react-native"
import { hexToRgba, useAppTheme, type ThemeColors } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

/** Selectable option chip (theme / execution / MCP type). Fill comes from the palette so NativeWind never drops it. */
export function optionChipStyle(palette: ThemeColors, active: boolean) {
  return {
    borderColor: active ? hexToRgba(palette.accent, 0.3) : hexToRgba(palette.ink, 0.12),
    backgroundColor: active ? hexToRgba(palette.accent, 0.12) : palette.background,
    minHeight: 44,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  }
}

export function optionChipTextColor(palette: ThemeColors, active: boolean) {
  return active ? palette.accentLight : palette.ink
}

type InfoChipProps = {
  label: string
  tone?: "neutral" | "accent" | "good" | "warn"
}

/**
 * Borderless soft pill status badge: tinted background, medium-weight text.
 * All tints derive from the active theme palette.
 */
export function InfoChip({ label, tone = "neutral" }: InfoChipProps) {
  const { palette } = useAppTheme()

  const backgroundColor =
    tone === "good"
      ? hexToRgba(palette.success, 0.14)
      : tone === "warn"
        ? hexToRgba(palette.warn, 0.14)
        : tone === "accent"
          ? hexToRgba(palette.accent, 0.16)
          : hexToRgba(palette.ink, 0.06)

  const textColor =
    tone === "good" ? palette.success : tone === "warn" ? palette.warn : tone === "accent" ? palette.accent : palette.soft

  return (
    <View
      style={{
        borderRadius: 999,
        borderCurve: "continuous",
        backgroundColor,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <Text
        selectable
        style={{
          color: textColor,
          fontVariant: ["tabular-nums"],
          ...typeStyle(12, { weight: "500" }),
        }}
      >
        {label}
      </Text>
    </View>
  )
}
