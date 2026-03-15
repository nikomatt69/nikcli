import React, { useEffect, useRef } from "react"
import { Animated, View, type DimensionValue, type ViewStyle } from "react-native"

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
  const opacity = useRef(new Animated.Value(0.48)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 820, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.48, duration: 820, useNativeDriver: true }),
      ]),
    )
    animation.start()

    return () => {
      animation.stop()
    }
  }, [opacity])

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius,
          opacity,
          backgroundColor: "#1d344d",
        },
        style,
      ]}
    />
  )
}

function cardStyle() {
  return {
    borderRadius: 30,
    backgroundColor: "#0d2035",
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#162840",
  } as const
}

export function SessionListSkeleton() {
  return (
    <>
      {[0, 1, 2, 3, 4].map((value) => (
        <View key={value} style={cardStyle()}>
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
  return (
    <>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={cardStyle()}>
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
