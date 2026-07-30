import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { AdaptiveBlur } from "@/components/GlassView"
import {
  DURATION_MS,
  Ease,
  SPRING_CONFIG,
  SPRING_SETTLE,
  projectMomentum,
  rubberband,
  useAnimatedValue,
  useAnimatedValueTracker,
  usePrefersReducedMotion,
} from "@/lib/animation"
import { useUIStore, type ToastEntry, type ToastKind } from "@/lib/store"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

/** How far behind the front toast each older one sits. */
const STACK_OFFSET = 12
const STACK_SCALE_STEP = 0.05
/** Toasts past this depth are held but not drawn. */
const VISIBLE_DEPTH = 3

type ToastColors = { backgroundColor: string; borderColor: string; textColor: string }

function toastColors(
  kind: ToastKind,
  palette: ReturnType<typeof useAppTheme>["palette"],
  isDark: boolean,
): ToastColors {
  // Every tone is the theme's own token at a tint — so a toast belongs to whichever of the
  // 90+ themes is active instead of carrying its own private green and red.
  const source = kind === "success" ? palette.success : kind === "error" ? palette.danger : palette.ink
  return {
    backgroundColor: hexToRgba(source, isDark ? 0.18 : 0.11),
    borderColor: hexToRgba(source, isDark ? 0.28 : 0.22),
    textColor: kind === "info" ? palette.ink : source,
  }
}

/**
 * Long messages need longer on screen than short ones. A fixed dwell either rushes a sentence
 * or leaves "Copied" hanging.
 */
function readingTimeMs(message: string): number {
  const words = message.trim().split(/\s+/).length
  return Math.min(6500, Math.max(2400, 1100 + words * 300))
}

export function ToastHost() {
  const toasts = useUIStore((state) => state.toasts)
  const dismissToast = useUIStore((state) => state.dismissToast)
  const { palette, isDark } = useAppTheme()
  const { top } = useSafeAreaInsets()

  // Newest in front; older ones fall back into the stack behind it.
  const ordered = useMemo(() => [...toasts].reverse(), [toasts])

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 16, right: 16, top: Math.max(top, 12) + 8, zIndex: 9999 }}
    >
      {ordered.map((toast, index) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          depth={index}
          colors={toastColors(toast.kind, palette, isDark)}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </View>
  )
}

function ToastItem({
  toast,
  depth,
  colors,
  onDismiss,
}: {
  toast: ToastEntry
  depth: number
  colors: ToastColors
  onDismiss(): void
}) {
  const { palette, isDark } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const enter = useAnimatedValue(0)
  const drag = useAnimatedValue(0)
  const liveDrag = useAnimatedValueTracker(drag)
  const dragOrigin = useRef(0)
  const dismissed = useRef(false)
  const [height, setHeight] = useState(56)
  // Touching a toast is a request to read it — hold it until the finger lifts.
  const [held, setHeld] = useState(false)

  const dismiss = useCallback(
    (velocity = 0) => {
      if (dismissed.current) return
      dismissed.current = true
      Animated.parallel([
        Animated.timing(enter, {
          toValue: 0,
          duration: DURATION_MS.hint,
          easing: Ease.accelerate,
          useNativeDriver: true,
        }),
        // Toasts live at the top edge, so they leave toward it — the same path they arrived on.
        Animated.spring(drag, { toValue: -height, velocity, ...SPRING_SETTLE }),
      ]).start(() => onDismiss())
    },
    [drag, enter, height, onDismiss],
  )

  useEffect(() => {
    if (prefersReducedMotion) {
      Animated.timing(enter, { toValue: 1, duration: DURATION_MS.hint, useNativeDriver: true }).start()
    } else {
      Animated.spring(enter, { toValue: 1, ...SPRING_CONFIG }).start()
    }
  }, [enter, prefersReducedMotion])

  useEffect(() => {
    if (held) return
    const timer = setTimeout(() => dismiss(), readingTimeMs(toast.message))
    return () => clearTimeout(timer)
  }, [dismiss, held, toast.message])

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderGrant: () => {
          drag.stopAnimation()
          dragOrigin.current = liveDrag.current
          setHeld(true)
        },
        onPanResponderMove: (_event, gesture) => {
          const raw = dragOrigin.current + gesture.dy
          // Free upward — that is the way out. Resisted downward, where there is nowhere to go.
          drag.setValue(raw <= 0 ? raw : rubberband(raw, height))
        },
        onPanResponderRelease: (_event, gesture) => {
          setHeld(false)
          const velocity = gesture.vy * 1000
          const projected = dragOrigin.current + gesture.dy + projectMomentum(velocity)
          if (projected < -height * 0.4 || velocity < -600) {
            dismiss(Math.min(velocity, 0))
            return
          }
          Animated.spring(drag, { toValue: 0, velocity, ...SPRING_SETTLE }).start()
        },
        onPanResponderTerminate: () => {
          setHeld(false)
          Animated.spring(drag, { toValue: 0, ...SPRING_SETTLE }).start()
        },
      }),
    [dismiss, drag, height, liveDrag],
  )

  if (depth >= VISIBLE_DEPTH) return null

  const isFront = depth === 0
  const stackTranslate = depth * STACK_OFFSET
  const stackScale = 1 - depth * STACK_SCALE_STEP

  return (
    <Animated.View
      {...(isFront ? panResponder.panHandlers : null)}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height || 56)}
      pointerEvents={isFront ? "auto" : "none"}
      accessibilityLiveRegion={isFront ? "polite" : "none"}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: 0,
        zIndex: VISIBLE_DEPTH - depth,
        opacity: Animated.multiply(
          enter,
          drag.interpolate({ inputRange: [-height, 0], outputRange: [0, 1], extrapolate: "clamp" }),
        ),
        transform: prefersReducedMotion
          ? [{ translateY: stackTranslate }]
          : [
              {
                translateY: Animated.add(
                  drag,
                  enter.interpolate({ inputRange: [0, 1], outputRange: [-10, stackTranslate] }),
                ),
              },
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.97, stackScale] }) },
            ],
      }}
    >
      <Pressable
        onPress={() => dismiss()}
        accessibilityRole="button"
        accessibilityLabel={toast.message}
        accessibilityHint="Tap or swipe up to dismiss"
        style={{
          borderRadius: 14,
          borderCurve: "continuous",
          borderWidth: 1,
          paddingHorizontal: 14,
          paddingVertical: 12,
          overflow: "hidden",
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
          shadowColor: palette.shadow,
          shadowOpacity: isDark ? 0.3 : 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 60 : 45}
          style={StyleSheet.absoluteFill}
          fallbackColor="transparent"
          opaqueFallbackColor={palette.surface}
          pointerEvents="none"
        />
        <Text
          style={{
            color: colors.textColor,
            textAlign: "center",
            // Slightly heavier than body text: this sits on a translucent surface over
            // unknown content, and flat weight loses legibility there.
            ...typeStyle(13, { weight: "600" }),
          }}
        >
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  )
}
