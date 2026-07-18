import { useEffect, useRef } from "react"
import { AlertTriangle } from "lucide-react-native"
import { Animated, Pressable, Text, View } from "react-native"
import { DURATION_MS, Ease, usePrefersReducedMotion } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"

export function ErrorBanner(props: { message: string; actionLabel?: string; onAction?(): void }) {
  const { palette } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const animRef = useRef<Animated.Value | null>(null)
  if (animRef.current === null) animRef.current = new Animated.Value(0)
  const anim = animRef.current

  useEffect(() => {
    const animation = Animated.timing(anim, {
      toValue: 1,
      duration: DURATION_MS.snappy,
      easing: Ease.decelerate,
      useNativeDriver: true,
    })
    animation.start()
    return () => animation.stop()
  }, [anim])

  return (
    <Animated.View
      className="overflow-hidden p-4"
      style={{
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor: hexToRgba(palette.danger, 0.2),
        backgroundColor: hexToRgba(palette.danger, 0.08),
        opacity: anim,
        transform: prefersReducedMotion
          ? undefined
          : [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
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
    </Animated.View>
  )
}
