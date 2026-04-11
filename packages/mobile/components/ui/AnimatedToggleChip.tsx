import { useEffect, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { useAppTheme } from "@/lib/theme"
import { triggerHaptic } from "@/lib/haptics"
import { PRESS_SPRING } from "@/lib/animation"

type AnimatedToggleChipProps = {
  label: string
  sublabel?: string
  active: boolean
  onToggle: () => void
  tone?: "accent" | "good" | "warn" | "neutral"
}

export function AnimatedToggleChip({ label, sublabel, active, onToggle, tone = "accent" }: AnimatedToggleChipProps) {
  const { palette, isDark } = useAppTheme()
  const scale = useRef(new Animated.Value(1)).current
  const toggleProgress = useRef(new Animated.Value(active ? 1 : 0)).current

  useEffect(() => {
    Animated.spring(toggleProgress, {
      toValue: active ? 1 : 0,
      damping: 18,
      stiffness: 200,
      mass: 0.5,
      useNativeDriver: false,
    }).start()
  }, [active, toggleProgress])

  function handlePressIn() {
    Animated.spring(scale, { toValue: 0.96, ...PRESS_SPRING }).start()
  }

  function handlePressOut() {
    Animated.spring(scale, { toValue: 1, ...PRESS_SPRING }).start()
  }

  function handlePress() {
    void triggerHaptic("selection")
    onToggle()
  }

  const borderColor = toggleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.72)",
      tone === "accent"
        ? isDark
          ? "rgba(14,165,233,0.45)"
          : "rgba(14,165,233,0.35)"
        : tone === "good"
          ? isDark
            ? "rgba(34,197,94,0.45)"
            : "rgba(34,197,94,0.35)"
          : tone === "warn"
            ? isDark
              ? "rgba(239,68,68,0.45)"
              : "rgba(239,68,68,0.35)"
            : isDark
              ? "rgba(255,255,255,0.12)"
              : "rgba(193,208,223,0.72)",
    ],
  })

  const backgroundColor = toggleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      isDark ? "rgba(255,255,255,0.05)" : "rgba(241,246,251,0.8)",
      tone === "accent"
        ? isDark
          ? "rgba(14,165,233,0.12)"
          : "rgba(14,165,233,0.10)"
        : tone === "good"
          ? isDark
            ? "rgba(34,197,94,0.12)"
            : "rgba(34,197,94,0.10)"
          : tone === "warn"
            ? isDark
              ? "rgba(239,68,68,0.12)"
              : "rgba(239,68,68,0.10)"
            : isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(241,246,251,0.8)",
    ],
  })

  const textColor = toggleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      palette.ink,
      tone === "accent"
        ? palette.accentLight
        : tone === "good"
          ? palette.success
          : tone === "warn"
            ? palette.danger
            : palette.ink,
    ],
  })

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={handlePress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
        <Animated.View
          style={[
            styles.container,
            {
              borderColor,
              backgroundColor,
            },
          ]}
        >
          <View className="flex-1 gap-1">
            <Animated.Text style={[styles.label, { color: textColor }]}>{label}</Animated.Text>
            {sublabel ? <Text className="text-[10px] leading-4 text-soft">{active ? "On" : "Off"}</Text> : null}
          </View>
          <Animated.View
            style={[
              styles.toggle,
              {
                backgroundColor: toggleProgress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [
                    isDark ? "rgba(255,255,255,0.15)" : "rgba(193,208,223,0.6)",
                    tone === "accent" ? palette.accent : tone === "good" ? palette.success : palette.danger,
                  ],
                }),
              },
            ]}
          >
            <Animated.View
              style={[
                styles.toggleThumb,
                {
                  backgroundColor: toggleProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [isDark ? "#6b7280" : "#ffffff", "#ffffff"],
                  }),
                  transform: [
                    {
                      translateX: toggleProgress.interpolate({
                        inputRange: [0, 1],
                        outputRange: [2, 18],
                      }),
                    },
                  ],
                },
              ]}
            />
          </Animated.View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
  toggle: {
    width: 40,
    height: 22,
    borderRadius: 11,
    padding: 2,
    justifyContent: "center",
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
})
