import { useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, Easing } from "react-native"

/** Canonical durations — prefer these over magic numbers */
export const DURATION_MS = {
  hint: 120,
  snappy: 220,
  standard: 320,
  relaxed: 480,
  emphasis: 640,
  shimmerCycle: 2000,
} as const

/**
 * Opinionated easing tokens (Material-ish + iOS-feel). Use with `timing()`.
 */
export const Ease = {
  standard: Easing.bezier(0.2, 0, 0, 1),
  emphasized: Easing.bezier(0.34, 0.82, 0.22, 1),
  decelerate: Easing.out(Easing.cubic),
  accelerate: Easing.in(Easing.cubic),
  smooth: Easing.inOut(Easing.cubic),
} as const

/** Default spring lists & chip moments */
export const SPRING_CONFIG = {
  damping: 30,
  stiffness: 260,
  mass: 0.82,
  useNativeDriver: true,
}

/** Sheets & larger surfaces settling in */
export const SPRING_SETTLE = {
  damping: 26,
  stiffness: 200,
  mass: 1,
  useNativeDriver: true,
}

/** Buttons / tactile controls */
export const PRESS_SPRING = {
  damping: 27,
  stiffness: 320,
  mass: 0.55,
  useNativeDriver: true,
}

/** Lightweight chip / toggle motions */
export const SPRING_MICRO = {
  damping: 23,
  stiffness: 280,
  mass: 0.45,
  useNativeDriver: true,
}

// Native-driver helpers in this file are intended for opacity/transform only.
// Use a local animation with useNativeDriver:false for colors, height, width, or layout props.

/** Respects Settings → Accessibility → Reduce Motion on iOS (and analogous on Android where supported). */
export function usePrefersReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false)

  // AccessibilityInfo.addEventListener returns an EmitterSubscription
  // whose only release handle is .remove() — the linter doesn't recognise
  // this RN-specific pattern, but the resource IS released in cleanup.
  // oxlint-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => setReduceMotion(Boolean(value)))
      .catch(() => undefined)

    let subscription: { remove(): void } | undefined
    if (AccessibilityInfo.addEventListener) {
      subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion)
    }

    return () => {
      subscription?.remove()
    }
  }, [])

  return reduceMotion
}

/** Respects the platform preference that replaces translucent materials with solid surfaces. */
export function usePrefersReducedTransparency(): boolean {
  const [reduceTransparency, setReduceTransparency] = useState(false)

  useEffect(() => {
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((value) => setReduceTransparency(Boolean(value)))
      .catch(() => undefined)

    const subscription = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduceTransparency)
    return () => subscription.remove()
  }, [])

  return reduceTransparency
}

export type StaggerOptions = {
  delayMs?: number
  /** When false, always animate at full fidelity (studio / debug tooling). Defaults to true. */
  respectReducedMotion?: boolean
}

/** List row / card entrance — pass `delayMs` as bare number or a full `{ delayMs }` object. */
export function useStaggeredAnimation(itemCount: number, delayMs?: number): Animated.Value[]
export function useStaggeredAnimation(itemCount: number, options?: StaggerOptions): Animated.Value[]
export function useStaggeredAnimation(itemCount: number, optionsOrDelay?: StaggerOptions | number): Animated.Value[] {
  const resolved: StaggerOptions =
    typeof optionsOrDelay === "number" ? { delayMs: optionsOrDelay } : (optionsOrDelay ?? {})
  const delayMs = resolved.delayMs ?? 54
  const respectReducedMotion = resolved.respectReducedMotion ?? true
  const prefersReducedMotion = usePrefersReducedMotion()
  const reduce = respectReducedMotion && prefersReducedMotion

  const animValuesRef = useRef<Animated.Value[]>([])

  if (animValuesRef.current.length !== itemCount) {
    const previous = animValuesRef.current
    animValuesRef.current = Array.from({ length: itemCount }, (_, index) => previous[index] ?? new Animated.Value(0))
  }
  const animValues = animValuesRef.current

  useEffect(() => {
    if (reduce) {
      for (const anim of animValues) anim.setValue(1)
      return undefined
    }

    const animations = animValues.map((anim, index) =>
      Animated.spring(anim, {
        toValue: 1,
        ...SPRING_CONFIG,
        delay: index * delayMs,
      }),
    )
    const parallel = Animated.parallel(animations as Animated.CompositeAnimation[], { stopTogether: false })
    parallel.start()
    return () => parallel.stop()
  }, [animValues, delayMs, reduce])

  return animValues
}

export type ItemRevealOptions = {
  delayMs?: number
  respectReducedMotion?: boolean
}

/** Single staged item (alternate to stagger arrays when indices are unstable). */
export function useItemAnimation(index: number, options?: ItemRevealOptions): Animated.Value {
  const delayMs = options?.delayMs ?? 54
  const respectReducedMotion = options?.respectReducedMotion ?? true
  const prefersReducedMotion = usePrefersReducedMotion()
  const reduce = respectReducedMotion && prefersReducedMotion
  const animRef = useRef<Animated.Value | null>(null)
  if (animRef.current === null) animRef.current = new Animated.Value(0)
  const anim = animRef.current

  useEffect(() => {
    if (reduce) {
      anim.setValue(1)
      return undefined
    }
    const animation = Animated.spring(anim, {
      toValue: 1,
      ...SPRING_CONFIG,
      delay: index * delayMs,
    })
    animation.start()
    return () => animation.stop()
  }, [anim, index, delayMs, reduce])

  return anim
}

export function useShimmerAnimation(): Animated.Value {
  const shimmerRef = useRef<Animated.Value | null>(null)
  if (shimmerRef.current === null) shimmerRef.current = new Animated.Value(0)
  const shimmer = shimmerRef.current
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (prefersReducedMotion) {
      shimmer.setValue(0)
      return undefined
    }
    const animation = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: DURATION_MS.shimmerCycle,
        easing: Ease.smooth,
        useNativeDriver: true,
      }),
    )
    animation.start()
    return () => animation.stop()
  }, [shimmer, prefersReducedMotion])

  return shimmer
}

export function usePressAnimation() {
  const scaleRef = useRef<Animated.Value | null>(null)
  if (scaleRef.current === null) scaleRef.current = new Animated.Value(1)
  const scale = scaleRef.current
  const prefersReducedMotion = usePrefersReducedMotion()

  const onPressIn = () => {
    scale.stopAnimation()
    if (prefersReducedMotion) {
      scale.setValue(0.985)
      return
    }
    Animated.spring(scale, { toValue: 0.976, ...PRESS_SPRING }).start()
  }

  const onPressOut = () => {
    scale.stopAnimation()
    if (prefersReducedMotion) {
      scale.setValue(1)
      return
    }
    Animated.spring(scale, { toValue: 1, ...PRESS_SPRING }).start()
  }

  useEffect(() => () => scale.stopAnimation(), [scale])

  return { scale, onPressIn, onPressOut, prefersReducedMotion }
}

/** Progress 0 ↔ 1 for purely transform-driven toggles (`useNativeDriver: true`). */
export function useToggleAnimation(enabled: boolean): Animated.Value {
  const progressRef = useRef<Animated.Value | null>(null)
  if (progressRef.current === null) progressRef.current = new Animated.Value(enabled ? 1 : 0)
  const progress = progressRef.current
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    if (prefersReducedMotion) {
      progress.setValue(enabled ? 1 : 0)
      return
    }

    Animated.spring(progress, {
      toValue: enabled ? 1 : 0,
      damping: 18,
      stiffness: 200,
      mass: 0.5,
      useNativeDriver: true,
    }).start()
  }, [enabled, prefersReducedMotion, progress])

  return progress
}

export type EntranceIntensity = "subtle" | "standard" | "dramatic"

export type EntranceStyleOptions = {
  intensity?: EntranceIntensity
}

/** Row / toast entrance */
export function getAnimatedStyle(anim: Animated.Value, options?: EntranceStyleOptions) {
  const intensity = options?.intensity ?? "standard"
  const drift = intensity === "subtle" ? 10 : intensity === "dramatic" ? 28 : 20
  const scaleFrom = intensity === "subtle" ? 0.985 : intensity === "dramatic" ? 0.904 : 0.95

  return {
    opacity: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1] as [number, number],
    }),
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [drift, 0] as [number, number],
        }),
      },
      {
        scale: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [scaleFrom, 1] as [number, number],
        }),
      },
    ],
  }
}

/** Denser layouts (dashboard cards, settings rows) */
export function getCardAnimatedStyle(anim: Animated.Value, options?: EntranceStyleOptions) {
  const intensity = options?.intensity ?? "standard"
  const drift = intensity === "subtle" ? 16 : intensity === "dramatic" ? 44 : 32
  const scaleFrom = intensity === "subtle" ? 0.968 : intensity === "dramatic" ? 0.888 : 0.92

  return {
    opacity: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1] as [number, number],
    }),
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [drift, 0] as [number, number],
        }),
      },
      {
        scale: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [scaleFrom, 1] as [number, number],
        }),
      },
    ],
  }
}
