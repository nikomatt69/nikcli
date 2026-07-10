import type { ReactNode } from "react"
import { Animated, Pressable, View } from "react-native"
import { Settings } from "lucide-react-native"
import { router } from "expo-router"
import { InfoChip } from "@/components/ui/InfoChip"
import { usePressAnimation } from "@/lib/animation"
import { useAppTheme } from "@/lib/theme"

export type HeaderChip = {
  label: string
  tone?: "neutral" | "accent" | "good" | "warn"
}

type AppHeaderProps = {
  /** Metadata chips rendered as a wrapping row. Falsy entries are skipped so callers can inline conditionals. */
  chips?: (HeaderChip | null | false | undefined)[]
  /** Optional content rendered below the chip row (search fields, primary actions, error banners). */
  children?: ReactNode
  /** Override the container spacing. Defaults to list-screen spacing; pass "gap-3" inside gap-managed scroll views. */
  className?: string
}

/**
 * Shared in-content header for the app tab screens. Standardizes the chip row +
 * action block that every screen previously hand-rolled, keeping spacing and
 * chip rendering consistent everywhere.
 */
export function AppHeader({ chips, children, className = "gap-3 pb-5" }: AppHeaderProps) {
  const visibleChips = (chips ?? []).filter((chip): chip is HeaderChip => Boolean(chip))

  return (
    <View className={className}>
      {visibleChips.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {visibleChips.map((chip, index) => (
            <InfoChip key={`${chip.label}-${index}`} label={chip.label} tone={chip.tone} />
          ))}
        </View>
      ) : null}
      {children}
    </View>
  )
}

/**
 * Settings gear for a Stack `headerRight`. Lives here so every tab can wire the
 * same accessible control instead of duplicating the Pressable.
 */
/**
 * Bare gear icon for a Stack `headerRight`. On iOS 26+ the system wraps
 * header items in a native liquid-glass capsule, so no custom container:
 * just the icon, tinted from the theme.
 */
export function SettingsHeaderButton() {
  const { palette } = useAppTheme()
  const press = usePressAnimation()

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open settings"
        hitSlop={12}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        onPress={() => router.push("/more/settings")}
        style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}
      >
        <Settings size={20} color={palette.ink} strokeWidth={2} />
      </Pressable>
    </Animated.View>
  )
}
