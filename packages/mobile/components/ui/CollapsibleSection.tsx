import { useState, type ReactNode } from "react"
import { Animated, LayoutAnimation, Pressable, Text, View } from "react-native"
import { ChevronDown } from "lucide-react-native"
import { usePrefersReducedMotion, useToggleAnimation } from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

type CollapsibleSectionProps = {
  label: string
  /** Rendered next to the label ("Completed 3"). Omitted when zero. */
  count?: number
  defaultOpen?: boolean
  /** Right-aligned affordance (a "clear" action, a badge). */
  accessory?: ReactNode
  children: ReactNode
}

/**
 * Quiet section header that folds its content away — the "Running" / "Completed N"
 * groups in the background-activity sheet. The chevron turns instead of swapping,
 * so the open state reads as one continuous control.
 */
export function CollapsibleSection({
  label,
  count,
  defaultOpen = true,
  accessory,
  children,
}: CollapsibleSectionProps) {
  const { palette } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [open, setOpen] = useState(defaultOpen)
  const [pressed, setPressed] = useState(false)
  const turn = useToggleAnimation(open)

  function toggle() {
    if (!prefersReducedMotion) {
      LayoutAnimation.configureNext({
        duration: 220,
        create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity, duration: 180 },
        update: { type: LayoutAnimation.Types.spring, springDamping: 1, duration: 220 },
        delete: { type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity, duration: 120 },
      })
    }
    void triggerHaptic("selection")
    setOpen((value) => !value)
  }

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={count === undefined ? label : `${label} ${count}`}
        onPress={toggle}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 10,
          opacity: pressed ? 0.7 : 1,
        }}
      >
        <Text style={{ color: palette.muted, ...typeStyle(15, { weight: "500" }) }}>
          {label}
          {count === undefined ? "" : ` ${count}`}
        </Text>
        <Animated.View
          style={{
            transform: [
              { rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] }) },
            ],
          }}
        >
          <ChevronDown size={17} color={palette.muted} strokeWidth={2} />
        </Animated.View>
        <View style={{ flex: 1 }} />
        {accessory}
      </Pressable>
      {open ? <View style={{ gap: 12, paddingBottom: 8 }}>{children}</View> : null}
    </View>
  )
}
