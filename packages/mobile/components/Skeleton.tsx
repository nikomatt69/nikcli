import { useEffect, useRef } from "react"
import { Animated, Easing, type DimensionValue, type ViewStyle } from "react-native"
import { usePrefersReducedMotion } from "@/lib/animation"
import { useAppTheme } from "@/lib/theme"

export function SkeletonBox({
  width,
  height,
  borderRadius = 12,
  style,
}: {
  width: DimensionValue
  height: number
  borderRadius?: number
  style?: ViewStyle
}) {
  const { palette, isDark } = useAppTheme()
  const opacityRef = useRef<Animated.Value | null>(null)
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(0.48)
  const opacity = opacityRef.current
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (prefersReducedMotion) {
      opacity.setValue(0.58)
      return undefined
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.85,
          duration: 460,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.38,
          duration: 460,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [opacity, prefersReducedMotion])

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          opacity,
          backgroundColor: isDark ? palette.surfaceRaised : palette.panel,
        },
        style,
      ]}
    />
  )
}
