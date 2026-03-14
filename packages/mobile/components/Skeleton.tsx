import React, { useEffect } from "react"
import { View, type DimensionValue, type ViewStyle } from "react-native"
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated"

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
  const opacity = useSharedValue(0.4)

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true)
  }, [opacity])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: "#1d344d" }, animatedStyle, style]}
    />
  )
}

export function SessionListSkeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={{
            borderRadius: 28,
            backgroundColor: "#0d2035",
            padding: 16,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: "#162840",
          }}
        >
          <SkeletonBox width={80} height={10} borderRadius={6} />
          <SkeletonBox width="85%" height={18} borderRadius={8} style={{ marginTop: 8 }} />
          <SkeletonBox width="60%" height={14} borderRadius={6} style={{ marginTop: 6 }} />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <SkeletonBox width={70} height={28} borderRadius={14} />
            <SkeletonBox width={90} height={28} borderRadius={14} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
            <SkeletonBox width={120} height={12} borderRadius={6} />
            <SkeletonBox width={40} height={12} borderRadius={6} />
          </View>
        </View>
      ))}
    </>
  )
}

export function RepoCardSkeleton({ count = 1 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={{
            borderRadius: 28,
            backgroundColor: "#0d2035",
            padding: 16,
            borderWidth: 1,
            borderColor: "#162840",
          }}
        >
          <SkeletonBox width="70%" height={18} borderRadius={8} />
          <SkeletonBox width="90%" height={14} borderRadius={6} style={{ marginTop: 8 }} />
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <SkeletonBox width={60} height={24} borderRadius={12} />
            <SkeletonBox width={60} height={24} borderRadius={12} />
          </View>
        </View>
      ))}
    </>
  )
}
