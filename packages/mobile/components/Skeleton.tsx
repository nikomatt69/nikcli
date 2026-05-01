import React, { useEffect, useRef } from "react"
import { Animated, Easing, View, type DimensionValue, type ViewStyle } from "react-native"
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
  const opacity = useRef(new Animated.Value(0.48)).current

  useEffect(() => {
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
  }, [opacity])

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

export function SessionListSkeleton() {
  const { palette, isDark } = useAppTheme()
  const style = {
    borderRadius: 30,
    backgroundColor: palette.surfaceRaised,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: palette.border,
  } as const

  return (
    <>
      {[0, 1, 2, 3, 4].map((value) => (
        <View key={value} style={style}>
          <SkeletonBox width={84} height={10} borderRadius={6} />
          <SkeletonBox width="85%" height={18} borderRadius={8} style={{ marginTop: 8 }} />
          <SkeletonBox width="60%" height={14} borderRadius={6} style={{ marginTop: 6 }} />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <SkeletonBox width={74} height={28} borderRadius={14} />
            <SkeletonBox width={96} height={28} borderRadius={14} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
            <SkeletonBox width={128} height={12} borderRadius={6} />
            <SkeletonBox width={44} height={12} borderRadius={6} />
          </View>
        </View>
      ))}
    </>
  )
}

export function RepoCardSkeleton({ count = 1 }: { count?: number }) {
  const { palette } = useAppTheme()
  const style = {
    borderRadius: 30,
    backgroundColor: palette.surface,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: palette.border,
  } as const

  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={style}>
          <SkeletonBox width="70%" height={18} borderRadius={8} />
          <SkeletonBox width="90%" height={14} borderRadius={6} style={{ marginTop: 8 }} />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <SkeletonBox width={64} height={24} borderRadius={12} />
            <SkeletonBox width={68} height={24} borderRadius={12} />
          </View>
        </View>
      ))}
    </>
  )
}
