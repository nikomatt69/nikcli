import { useCallback, useEffect, useRef } from "react"
import { Animated, Pressable, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { DURATION_MS, Ease, SPRING_CONFIG, usePrefersReducedMotion } from "@/lib/animation"
import { useUIStore, type ToastKind } from "@/lib/store"
import { useAppTheme } from "@/lib/theme"

function toastColors(kind: ToastKind, palette: ReturnType<typeof useAppTheme>["palette"], isDark: boolean) {
  if (kind === "success") {
    return {
      backgroundColor: isDark ? "rgba(34,197,94,0.18)" : "rgba(22,163,74,0.12)",
      borderColor: isDark ? "rgba(74,222,128,0.28)" : "rgba(22,163,74,0.22)",
      textColor: isDark ? "#bbf7d0" : palette.success,
    }
  }
  if (kind === "error") {
    return {
      backgroundColor: isDark ? "rgba(239,68,68,0.18)" : "rgba(220,38,38,0.10)",
      borderColor: isDark ? "rgba(248,113,113,0.28)" : "rgba(220,38,38,0.22)",
      textColor: palette.danger,
    }
  }
  return {
    backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(20,20,19,0.08)",
    borderColor: isDark ? "rgba(255,255,255,0.14)" : "rgba(20,20,19,0.12)",
    textColor: palette.ink,
  }
}

export function ToastHost() {
  const toasts = useUIStore((state) => state.toasts)
  const dismissToast = useUIStore((state) => state.dismissToast)
  const { palette, isDark } = useAppTheme()
  const { top } = useSafeAreaInsets()

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        top: Math.max(top, 12) + 8,
        gap: 8,
        zIndex: 9999,
      }}
    >
      {toasts.map((toast) => {
        const colors = toastColors(toast.kind, palette, isDark)
        return (
          <ToastItem key={toast.id} message={toast.message} colors={colors} onDismiss={() => dismissToast(toast.id)} />
        )
      })}
    </View>
  )
}

function ToastItem(props: {
  message: string
  colors: { backgroundColor: string; borderColor: string; textColor: string }
  onDismiss(): void
}) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const animRef = useRef<Animated.Value | null>(null)
  if (animRef.current === null) animRef.current = new Animated.Value(0)
  const anim = animRef.current
  const dismissedRef = useRef(false)
  const { onDismiss } = props

  // Fade out first so removal never pops; guard against timer + tap racing.
  const dismiss = useCallback(() => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    Animated.timing(anim, {
      toValue: 0,
      duration: 150,
      easing: Ease.accelerate,
      useNativeDriver: true,
    }).start(() => onDismiss())
  }, [anim, onDismiss])

  useEffect(() => {
    if (prefersReducedMotion) {
      Animated.timing(anim, { toValue: 1, duration: DURATION_MS.hint, useNativeDriver: true }).start()
    } else {
      Animated.spring(anim, { toValue: 1, ...SPRING_CONFIG }).start()
    }
    const timer = setTimeout(dismiss, 2200)
    return () => clearTimeout(timer)
  }, [anim, dismiss, prefersReducedMotion])

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: prefersReducedMotion
          ? undefined
          : [
              // Toasts live at the top edge, so they arrive from it and leave toward it.
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
              { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
            ],
      }}
    >
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={props.message}
        style={({ pressed }) => ({
          borderRadius: 12,
          borderWidth: 1,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: props.colors.backgroundColor,
          borderColor: props.colors.borderColor,
          opacity: pressed ? 0.92 : 1,
        })}
      >
        <Text style={{ color: props.colors.textColor, fontSize: 13, fontWeight: "600", textAlign: "center" }}>
          {props.message}
        </Text>
      </Pressable>
    </Animated.View>
  )
}
