import { useEffect, useRef } from "react"
import { Animated, Easing } from "react-native"
import { usePrefersReducedMotion } from "@/lib/animation"

/** Small breathing dot for "in progress" states (e.g. agent working). */
export function PulseDot(props: { color: string; size?: number }) {
  const size = props.size ?? 7
  const prefersReducedMotion = usePrefersReducedMotion()
  const animRef = useRef<Animated.Value | null>(null)
  if (animRef.current === null) animRef.current = new Animated.Value(1)
  const anim = animRef.current

  useEffect(() => {
    if (prefersReducedMotion) {
      anim.setValue(1)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [anim, prefersReducedMotion])

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: props.color,
        opacity: anim,
        transform: [
          {
            scale: anim.interpolate({
              inputRange: [0.35, 1],
              outputRange: [0.85, 1],
            }),
          },
        ],
      }}
    />
  )
}
