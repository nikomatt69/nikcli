import { useEffect, useRef } from "react"
import { Animated, Easing } from "react-native"

export const SPRING_CONFIG = {
  damping: 20,
  stiffness: 240,
  mass: 0.8,
  useNativeDriver: true,
}

export const PRESS_SPRING = {
  damping: 15,
  stiffness: 300,
  mass: 0.6,
  useNativeDriver: true,
}

export function useStaggeredAnimation(itemCount: number, delayMs = 50): Animated.Value[] {
  const animValuesRef = useRef<Animated.Value[]>([])

  if (animValuesRef.current.length !== itemCount) {
    animValuesRef.current = Array.from({ length: itemCount }, () => new Animated.Value(0))
  }
  const animValues = animValuesRef.current

  useEffect(() => {
    const animations = animValues.map((anim, index) =>
      Animated.spring(anim, {
        toValue: 1,
        ...SPRING_CONFIG,
        delay: index * delayMs,
      }),
    )
    Animated.parallel(animations as Animated.CompositeAnimation[], { stopTogether: false }).start()
  }, [animValues, delayMs])

  return animValues
}

export function useItemAnimation(index: number, delayMs = 50): Animated.Value {
  const anim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      ...SPRING_CONFIG,
      delay: index * delayMs,
    }).start()
  }, [anim, index, delayMs])

  return anim
}

export function useShimmerAnimation(): Animated.Value {
  const shimmer = useRef(new Animated.Value(0)).current

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 2000,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    )
    animation.start()
    return () => animation.stop()
  }, [shimmer])

  return shimmer
}

export function usePressAnimation() {
  const scale = useRef(new Animated.Value(1)).current

  const onPressIn = () => {
    Animated.spring(scale, { toValue: 0.98, ...PRESS_SPRING }).start()
  }

  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, ...PRESS_SPRING }).start()
  }

  return { scale, onPressIn, onPressOut }
}

export function useToggleAnimation(initialValue: boolean): Animated.Value {
  const progress = useRef(new Animated.Value(initialValue ? 1 : 0)).current

  useEffect(() => {
    Animated.spring(progress, {
      toValue: initialValue ? 1 : 0,
      damping: 18,
      stiffness: 200,
      mass: 0.5,
      useNativeDriver: true,
    }).start()
  }, [initialValue, progress])

  return progress
}

export function getAnimatedStyle(anim: Animated.Value) {
  return {
    opacity: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1] as [number, number],
    }),
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [20, 0] as [number, number],
        }),
      },
      {
        scale: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1] as [number, number],
        }),
      },
    ],
  }
}

export function getCardAnimatedStyle(anim: Animated.Value) {
  return {
    opacity: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1] as [number, number],
    }),
    transform: [
      {
        translateY: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [30, 0] as [number, number],
        }),
      },
      {
        scale: anim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.92, 1] as [number, number],
        }),
      },
    ],
  }
}
