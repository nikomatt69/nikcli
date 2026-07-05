import { useEffect, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"
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
  const { palette } = useAppTheme()
  const scaleRef = useRef<Animated.Value | null>(null)
  if (scaleRef.current === null) scaleRef.current = new Animated.Value(1)
  const scale = scaleRef.current
  const toggleProgressRef = useRef<Animated.Value | null>(null)
  if (toggleProgressRef.current === null) toggleProgressRef.current = new Animated.Value(active ? 1 : 0)
  const toggleProgress = toggleProgressRef.current

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
      hexToRgba(palette.ink, 0.08),
      tone === "accent"
        ? hexToRgba(palette.ink, 0.35)
        : tone === "good"
          ? hexToRgba(palette.success, 0.4)
          : tone === "warn"
            ? hexToRgba(palette.danger, 0.4)
            : hexToRgba(palette.ink, 0.12),
    ],
  })

  const backgroundColor = toggleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [
      hexToRgba(palette.ink, 0.04),
      tone === "accent"
        ? hexToRgba(palette.ink, 0.1)
        : tone === "good"
          ? hexToRgba(palette.success, 0.12)
          : tone === "warn"
            ? hexToRgba(palette.danger, 0.12)
            : hexToRgba(palette.ink, 0.06),
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
                    hexToRgba(palette.ink, 0.15),
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
                    outputRange: [palette.surface, palette.surface],
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
