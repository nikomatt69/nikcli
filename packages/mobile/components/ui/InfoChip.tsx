import { Text, View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"

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
      ? hexToRgba(palette.success, 0.12)
      : tone === "warn"
        ? hexToRgba(palette.warn, 0.12)
        : tone === "accent"
          ? hexToRgba(palette.ink, 0.08)
          : hexToRgba(palette.ink, 0.05)

  const textColor =
    tone === "good" ? palette.success : tone === "warn" ? palette.warn : tone === "accent" ? palette.ink : palette.soft

  return (
    <View
      style={{
        borderRadius: 999,
        backgroundColor,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <Text
        selectable
        style={{
          color: textColor,
          fontSize: 12,
          fontWeight: "500",
          fontVariant: ["tabular-nums"],
        }}
      >
        {label}
      </Text>
    </View>
  )
}
