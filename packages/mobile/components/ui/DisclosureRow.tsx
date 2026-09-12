import type { ReactNode } from "react"
import { Pressable, Text, View } from "react-native"
import { ChevronRight } from "lucide-react-native"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

type DisclosureRowProps = {
  label: string
  /** Leading glyph — a tool icon, an agent diamond. */
  icon?: ReactNode
  /** The lead-in reads normally and the rest stays quiet: "Ran" + "5 commands". */
  emphasis?: string
  tone?: "muted" | "ink"
  onPress?(): void
}

/**
 * Collapsed transcript affordance: one quiet line with a chevron that opens the
 * detail behind it ("Session initialized", "Ran 5 commands", "Agent run").
 * Deliberately not a card — these sit between messages and must stay recessive.
 */
export function DisclosureRow({ label, icon, emphasis, tone = "muted", onPress }: DisclosureRowProps) {
  const { palette } = useAppTheme()
  const color = tone === "ink" ? palette.ink : palette.muted

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={emphasis ? `${emphasis} ${label}` : label}
      disabled={!onPress}
      onPress={() => {
        void triggerHaptic("selection")
        onPress?.()
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 9,
        opacity: pressed ? 0.62 : 1,
      })}
    >
      {icon}
      <View style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 5 }}>
        {emphasis ? (
          <Text numberOfLines={1} style={{ color: palette.ink, ...typeStyle(15, { weight: "500" }) }}>
            {emphasis}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={{ color, flexShrink: 1, ...typeStyle(15) }}>
          {label}
        </Text>
      </View>
      {onPress ? <ChevronRight size={16} color={palette.muted} strokeWidth={2} /> : null}
    </Pressable>
  )
}
