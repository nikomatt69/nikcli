import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import {
  DURATION_MS,
  Ease,
  SPRING_SETTLE,
  projectMomentum,
  rubberband,
  useAnimatedValue,
  useAnimatedValueTracker,
  usePrefersReducedMotion,
} from "@/lib/animation"
import { triggerHaptic } from "@/lib/haptics"
import { hexToRgba, useAppTheme } from "@/lib/theme"

/**
 * The one bottom-sheet container.
 *
 * Everything that made sheets feel different from each other lives here now: the surface tracks
 * the finger 1:1, resists past its rest point instead of stopping dead, decides dismiss-vs-return
 * from *projected* momentum rather than the release point, hands the release velocity to the
 * spring so there is no seam between dragging and animating, and can be grabbed again while it is
 * still moving — in either direction.
 *
 * Enter and exit travel the same path, because a surface that arrives from the bottom and leaves
 * by fading has no place to have gone.
 */

export type SheetShellProps = {
  visible: boolean
  onClose(): void
  /** Fires once the exit has finished playing — safe point to run follow-up navigation. */
  onDismissed?(): void
  children: React.ReactNode
  /** Full-bleed sheet anchored to the bottom edge, or a floating inset card. */
  variant?: "edge" | "inset"
  /** Fixed height. Omit to size to content. */
  height?: number
  /** Wrap in a KeyboardAvoidingView — for sheets containing a text field. */
  avoidKeyboard?: boolean
  /** Hide the grab handle. The sheet stays draggable; some headers supply their own affordance. */
  showHandle?: boolean
  /** Tapping the scrim dismisses. Disable for sheets with unsaved, destructive-to-lose input. */
  dismissOnBackdropPress?: boolean
  accessibilityLabel?: string
  contentStyle?: ViewStyle
}

const SheetScrollContext = createContext<((atTop: boolean) => void) | null>(null)

/**
 * Spread onto a scrollable inside a `SheetShell` to make the whole sheet draggable.
 *
 * Without it only the handle is a grip. With it the sheet follows the finger from anywhere,
 * and yields back to the list the moment the content is scrolled away from the top — so a
 * downward swipe reads as "close this" at the top and "scroll up" everywhere else.
 */
export function useSheetScrollProps() {
  const setAtTop = useContext(SheetScrollContext)
  return {
    scrollEventThrottle: 16,
    onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
      setAtTop?.(event.nativeEvent.contentOffset.y <= 0)
    },
  }
}

/** Past this fraction of the sheet's own height, a projected flick commits to dismissing. */
const DISMISS_FRACTION = 0.4
/** A hard downward flick dismisses regardless of how far it actually travelled. */
const DISMISS_VELOCITY = 900
/** Movement before the drag commits to a direction, so a tap inside the sheet is never stolen. */
const DRAG_THRESHOLD = 6

export function SheetShell({
  visible,
  onClose,
  onDismissed,
  children,
  variant = "edge",
  height,
  avoidKeyboard = false,
  showHandle = true,
  dismissOnBackdropPress = true,
  accessibilityLabel = "Sheet",
  contentStyle,
}: SheetShellProps) {
  const { palette, isDark } = useAppTheme()
  const { height: windowHeight } = useWindowDimensions()
  const prefersReducedMotion = usePrefersReducedMotion()

  // `visible` is the parent's intent; `mounted` keeps the sheet on screen through its exit.
  const [mounted, setMounted] = useState(visible)
  const translateY = useAnimatedValue(0)
  const scrim = useAnimatedValue(0)
  const livePosition = useAnimatedValueTracker(translateY)
  const dragOrigin = useRef(0)
  // A swipe-dismiss closes the sheet *and* tells the parent, which flips `visible` a frame later.
  // Without this the parent's update would restart the exit at zero velocity and eat the flick.
  const closing = useRef(false)
  // Sheets without a registered scrollable are draggable from anywhere by default.
  const contentAtTop = useRef(true)
  const setContentAtTop = useCallback((atTop: boolean) => {
    contentAtTop.current = atTop
  }, [])

  // Until the sheet has laid out, assume a half-screen travel so an early gesture still resolves.
  const [measuredHeight, setMeasuredHeight] = useState(0)
  const travel = height ?? (measuredHeight || windowHeight * 0.5)

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.height
    setMeasuredHeight((current) => (Math.abs(current - next) > 1 ? next : current))
  }, [])

  const settle = useCallback(
    (velocity = 0) => {
      Animated.spring(translateY, { toValue: 0, velocity, ...SPRING_SETTLE }).start()
    },
    [translateY],
  )

  const close = useCallback(
    (velocity = 0) => {
      closing.current = true
      translateY.stopAnimation()
      scrim.stopAnimation()
      Animated.parallel([
        Animated.timing(scrim, {
          toValue: 0,
          duration: prefersReducedMotion ? DURATION_MS.hint : DURATION_MS.snappy,
          easing: Ease.accelerate,
          useNativeDriver: true,
        }),
        prefersReducedMotion
          ? Animated.timing(translateY, { toValue: 0, duration: DURATION_MS.hint, useNativeDriver: true })
          : // The finger's own velocity carries into the exit.
            Animated.spring(translateY, { toValue: travel, velocity, ...SPRING_SETTLE }),
      ]).start(({ finished }) => {
        if (!finished) return
        setMounted(false)
        onDismissed?.()
      })
    },
    [onDismissed, prefersReducedMotion, scrim, translateY, travel],
  )

  // Present as soon as the parent asks; defer the unmount until the exit has actually played.
  useEffect(() => {
    if (visible) {
      closing.current = false
      setMounted(true)
      return
    }
    if (mounted && !closing.current) close(0)
  }, [close, mounted, visible])

  useEffect(() => {
    if (!mounted || !visible) return

    translateY.setValue(prefersReducedMotion ? 0 : travel)
    const animation = Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: prefersReducedMotion ? DURATION_MS.hint : DURATION_MS.snappy,
        easing: Ease.decelerate,
        useNativeDriver: true,
      }),
      prefersReducedMotion
        ? Animated.timing(translateY, { toValue: 0, duration: DURATION_MS.hint, useNativeDriver: true })
        : Animated.spring(translateY, { toValue: 0, ...SPRING_SETTLE }),
    ])
    animation.start()
    return () => animation.stop()
    // `travel` is deliberately excluded: it settles on first layout, and re-running the entrance
    // when it does would restart a sheet the user may already be dragging.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, prefersReducedMotion, scrim, translateY, visible])

  const { handlePan, bodyPan } = useMemo(() => {
    const drag = (claim: (dy: number, dx: number) => boolean) =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) => claim(gesture.dy, gesture.dx),
        onPanResponderGrant: () => {
          // Take over from wherever the sheet currently *is*, not from where it was headed —
          // this is what lets a half-open sheet be caught and reversed without a jump.
          translateY.stopAnimation()
          dragOrigin.current = livePosition.current
        },
        onPanResponderMove: (_event, gesture) => {
          const raw = dragOrigin.current + gesture.dy
          translateY.setValue(raw >= 0 ? raw : -rubberband(-raw, travel))
        },
        onPanResponderRelease: (_event, gesture) => {
          const releaseVelocity = gesture.vy * 1000
          const projected = dragOrigin.current + gesture.dy + projectMomentum(releaseVelocity)
          if (projected > travel * DISMISS_FRACTION || releaseVelocity > DISMISS_VELOCITY) {
            triggerHaptic("selection")
            close(Math.max(releaseVelocity, 0))
            onClose()
            return
          }
          settle(releaseVelocity)
        },
        onPanResponderTerminate: () => settle(),
      })

    return {
      // The handle is a dedicated grip: it claims any vertical drag, in either direction.
      handlePan: drag((dy, dx) => Math.abs(dy) > DRAG_THRESHOLD && Math.abs(dy) > Math.abs(dx)),
      // The body only claims a downward drag, and only while its content is scrolled to the top —
      // otherwise the list keeps the gesture, which is what the user meant.
      bodyPan: drag((dy, dx) => contentAtTop.current && dy > DRAG_THRESHOLD && dy > Math.abs(dx)),
    }
  }, [close, livePosition, onClose, settle, translateY, travel])

  if (!mounted) return null

  const inset = variant === "inset"
  const radius = inset ? 24 : 28
  // The scrim fades with the drag, so releasing halfway never snaps the background's dimming.
  const scrimOpacity = Animated.multiply(
    scrim,
    translateY.interpolate({ inputRange: [0, Math.max(travel, 1)], outputRange: [1, 0], extrapolate: "clamp" }),
  )

  const sheet = (
    <Animated.View
      onLayout={onLayout}
      accessibilityViewIsModal
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          transform: [{ translateY }],
          opacity: scrim,
          backgroundColor: palette.surface,
          borderTopLeftRadius: radius,
          borderTopRightRadius: radius,
          borderBottomLeftRadius: inset ? radius : 0,
          borderBottomRightRadius: inset ? radius : 0,
          borderCurve: "continuous",
          shadowColor: palette.shadow,
          shadowOpacity: isDark ? 0.28 : 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -5 },
          elevation: 16,
          ...(height ? { height } : null),
          ...(inset ? { marginHorizontal: 16, marginBottom: Platform.OS === "ios" ? 28 : 16 } : null),
        },
        contentStyle,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]} pointerEvents="none">
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={isDark ? 90 : 75}
          style={StyleSheet.absoluteFill}
          fallbackColor={hexToRgba(palette.surface, isDark ? 0.85 : 0.82)}
          opaqueFallbackColor={palette.surface}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: radius,
              borderWidth: 1,
              borderBottomWidth: inset ? 1 : 0,
              // A bright top edge reads as light catching the leading edge of the material.
              borderColor: isDark ? hexToRgba(palette.ink, 0.1) : hexToRgba("#ffffff", 0.64),
            },
          ]}
        />
      </View>

      <View
        {...handlePan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel="Sheet handle"
        accessibilityHint="Drag down to dismiss"
        style={{ paddingTop: showHandle ? 9 : 4, paddingBottom: showHandle ? 8 : 4, alignItems: "center" }}
      >
        {showHandle ? (
          <View
            style={{
              width: 36,
              height: 5,
              borderRadius: 999,
              backgroundColor: hexToRgba(palette.ink, isDark ? 0.22 : 0.18),
            }}
          />
        ) : null}
      </View>

      <View {...bodyPan.panHandlers} style={{ flex: height ? 1 : 0, width: "100%" }}>
        <SheetScrollContext.Provider value={setContentAtTop}>{children}</SheetScrollContext.Provider>
      </View>
    </Animated.View>
  )

  const body = (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { opacity: scrimOpacity, backgroundColor: isDark ? "rgba(0,0,0,0.62)" : hexToRgba(palette.ink, 0.18) },
        ]}
      />
      {dismissOnBackdropPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dismiss ${accessibilityLabel.toLowerCase()}`}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
      ) : null}
      {sheet}
    </View>
  )

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {avoidKeyboard ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </Modal>
  )
}
