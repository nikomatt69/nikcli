import { useEffect, useRef, useState } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { ArrowDown } from "lucide-react-native"
import { SPRING_MICRO, usePrefersReducedMotion } from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"

/**
 * Floating "scroll to latest" pill for the session transcript. Shown when the
 * user has scrolled away from the bottom; stays mounted while the exit spring
 * plays so it leaves along the same path it entered.
 */
export function JumpToLatestPill(props: { visible: boolean; count: number; onPress(): void }) {
  const { palette } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [rendered, setRendered] = useState(props.visible)
  const animRef = useRef<Animated.Value | null>(null)
  if (animRef.current === null) animRef.current = new Animated.Value(props.visible ? 1 : 0)
  const anim = animRef.current

  useEffect(() => {
    if (props.visible) setRendered(true)
    if (prefersReducedMotion) {
      anim.setValue(props.visible ? 1 : 0)
      if (!props.visible) setRendered(false)
      return
    }
    const spring = Animated.spring(anim, {
      toValue: props.visible ? 1 : 0,
      ...SPRING_MICRO,
    })
    spring.start(({ finished }) => {
      if (finished && !props.visible) setRendered(false)
    })
    return () => spring.stop()
  }, [anim, prefersReducedMotion, props.visible])

  if (!rendered) return null

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 12,
        alignItems: "center",
      }}
    >
      <Animated.View
        style={{
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [14, 0],
              }),
            },
            {
              scale: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        }}
      >
        <Pressable
          onPress={() => {
            void triggerHaptic("selection")
            props.onPress()
          }}
          accessibilityRole="button"
          accessibilityLabel={
            props.count > 0
              ? `Scroll to latest, ${props.count} new ${props.count === 1 ? "message" : "messages"}`
              : "Scroll to latest"
          }
          hitSlop={8}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            borderRadius: 999,
            paddingVertical: 7,
            paddingLeft: 11,
            paddingRight: 13,
            backgroundColor: hexToRgba(palette.ink, 0.92),
            borderWidth: 1,
            borderColor: hexToRgba(palette.background, 0.14),
            shadowColor: palette.shadow,
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.22,
            shadowRadius: 12,
            opacity: pressed ? 0.8 : 1,
            transform: [{ scale: pressed ? 0.95 : 1 }],
          })}
        >
          <ArrowDown size={12} color={palette.background} strokeWidth={2.6} />
          <Text
            style={{
              color: palette.background,
              fontSize: 11.5,
              fontWeight: "600",
            }}
          >
            Latest messages
          </Text>
          {props.count > 0 ? (
            <View
              style={{
                minWidth: 22,
                height: 18,
                borderRadius: 999,
                paddingHorizontal: 6,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: palette.background,
              }}
            >
              <Text
                style={{
                  color: palette.ink,
                  fontSize: 10,
                  lineHeight: 13,
                  fontWeight: "800",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {props.count}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  )
}
