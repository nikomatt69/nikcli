import { useEffect, useRef, useState } from "react"
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native"
import { Check, ChevronLeft, ChevronRight, Shield, ShieldCheck, X } from "lucide-react-native"
import { triggerHaptic } from "@/lib/haptics"
import { useAppTheme } from "@/lib/theme"
import type { PermissionRequest } from "@/lib/types"

export function ComposerPermissionBar(props: {
  permissions: PermissionRequest[]
  onRespond(id: string, response: "once" | "always" | "reject"): void
}) {
  const { palette, isDark } = useAppTheme()
  const [index, setIndex] = useState(0)
  const slideAnim = useRef(new Animated.Value(0)).current
  const opacityAnim = useRef(new Animated.Value(0)).current

  const count = props.permissions.length
  const current = props.permissions[Math.min(index, count - 1)]

  useEffect(() => {
    if (count === 0) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start()
    } else {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 1,
          useNativeDriver: true,
          damping: 16,
          stiffness: 200,
          mass: 0.9,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
          easing: Easing.out(Easing.ease),
        }),
      ]).start()
      // Reset index if out of bounds
      setIndex((prev) => (prev >= count ? count - 1 : prev))
    }
  }, [count, slideAnim, opacityAnim])

  if (!current) return null

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] })

  function respond(response: "once" | "always" | "reject") {
    void triggerHaptic(response === "reject" ? "error" : "success")
    props.onRespond(current.id, response)
    // Move to previous if we were on the last item
    setIndex((prev) => Math.max(0, Math.min(prev, count - 2)))
  }

  return (
    <Animated.View
      style={{
        opacity: opacityAnim,
        transform: [{ translateY }],
      }}
    >
      <View
        style={{
          marginHorizontal: 14,
          marginBottom: 6,
          borderRadius: 18,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: isDark ? "rgba(255,200,50,0.18)" : "rgba(217,119,6,0.22)",
          backgroundColor: isDark ? "rgba(40,30,10,0.92)" : "rgba(255,251,235,0.96)",
        }}
      >
        {/* Inner tint */}
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(255,180,0,0.04)" : "rgba(217,119,6,0.04)" }]}
          pointerEvents="none"
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 12,
            paddingVertical: 12,
            gap: 10,
          }}
        >
          {/* Icon */}
          <View
            style={{
              borderRadius: 10,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,180,0,0.22)" : "rgba(217,119,6,0.22)",
              backgroundColor: isDark ? "rgba(255,180,0,0.10)" : "rgba(217,119,6,0.10)",
              padding: 7,
              flexShrink: 0,
            }}
          >
            <Shield size={15} color={isDark ? "#fbbf24" : "#d97706"} strokeWidth={2.1} />
          </View>

          {/* Permission text */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: "700",
                letterSpacing: 1.1,
                textTransform: "uppercase",
                color: isDark ? "#fbbf24" : "#d97706",
                marginBottom: 2,
              }}
            >
              {count > 1 ? `Approval ${index + 1}/${count}` : "Approval required"}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 13,
                fontWeight: "500",
                color: isDark ? "rgba(255,255,255,0.82)" : "rgba(30,20,0,0.82)",
              }}
            >
              {current.permission}
            </Text>
          </View>

          {/* Navigation arrows (only when multiple) */}
          {count > 1 && (
            <View style={{ flexDirection: "row", gap: 2 }}>
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  setIndex((prev) => (prev - 1 + count) % count)
                }}
                hitSlop={10}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.5 : 1,
                  padding: 6,
                })}
              >
                <ChevronLeft size={16} color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"} strokeWidth={2.2} />
              </Pressable>
              <Pressable
                onPress={() => {
                  void triggerHaptic("selection")
                  setIndex((prev) => (prev + 1) % count)
                }}
                hitSlop={10}
                style={({ pressed }) => ({
                  opacity: pressed ? 0.5 : 1,
                  padding: 6,
                })}
              >
                <ChevronRight size={16} color={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"} strokeWidth={2.2} />
              </Pressable>
            </View>
          )}

          {/* Divider */}
          <View
            style={{
              width: StyleSheet.hairlineWidth,
              height: 32,
              backgroundColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)",
            }}
          />

          {/* Action buttons */}
          <View style={{ flexDirection: "row", gap: 6, flexShrink: 0 }}>
            {/* Reject */}
            <Pressable
              onPress={() => respond("reject")}
              hitSlop={8}
              style={({ pressed }) => ({
                borderRadius: 11,
                borderWidth: 1,
                borderColor: isDark ? "rgba(248,113,113,0.30)" : "rgba(239,68,68,0.22)",
                backgroundColor: isDark ? "rgba(80,28,28,0.80)" : "rgba(239,68,68,0.08)",
                padding: 11,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <X size={15} color={isDark ? "#f87171" : "#dc2626"} strokeWidth={2.4} />
            </Pressable>

            {/* Allow once */}
            <Pressable
              onPress={() => respond("once")}
              hitSlop={8}
              style={({ pressed }) => ({
                borderRadius: 11,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.78)",
                backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.82)",
                padding: 11,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <Check size={15} color={isDark ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.55)"} strokeWidth={2.4} />
            </Pressable>

            {/* Always allow */}
            <Pressable
              onPress={() => respond("always")}
              hitSlop={8}
              style={({ pressed }) => ({
                borderRadius: 11,
                borderWidth: 1,
                borderColor: isDark ? "rgba(52,211,153,0.28)" : "rgba(16,185,129,0.22)",
                backgroundColor: isDark ? "rgba(6,40,28,0.82)" : "rgba(16,185,129,0.08)",
                padding: 11,
                opacity: pressed ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              })}
            >
              <ShieldCheck size={15} color={isDark ? "#34d399" : "#059669"} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>
      </View>
    </Animated.View>
  )
}
