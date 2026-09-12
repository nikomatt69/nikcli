import { useEffect, useRef } from "react"
import { Animated, View } from "react-native"
import { AlertTriangle, GitBranch } from "lucide-react-native"
import { usePrefersReducedMotion } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"

export type SessionGlyphKind = "busy" | "attention" | "branch" | "idle"

/** A ring with one open quadrant, turning — the session is working. */
function Spinner({ color }: { color: string }) {
  const prefersReducedMotion = usePrefersReducedMotion()
  const spinRef = useRef<Animated.Value | null>(null)
  if (spinRef.current === null) spinRef.current = new Animated.Value(0)
  const spin = spinRef.current

  useEffect(() => {
    if (prefersReducedMotion) {
      spin.setValue(0)
      return
    }
    const animation = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true }))
    animation.start()
    return () => animation.stop()
  }, [prefersReducedMotion, spin])

  return (
    <Animated.View
      style={{
        width: 16,
        height: 16,
        borderRadius: 999,
        borderWidth: 1.8,
        borderColor: color,
        borderTopColor: "transparent",
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
      }}
    />
  )
}

/**
 * The leading mark of a session row. It says what kind of session this is at a
 * glance — running, needs you, branch work, or idle — in place of a colour-only
 * status dot.
 */
export function SessionGlyph({ kind }: { kind: SessionGlyphKind }) {
  const { palette } = useAppTheme()

  if (kind === "busy") return <Spinner color={palette.ink} />
  if (kind === "attention") return <AlertTriangle size={16} color={palette.warn} strokeWidth={2} />
  if (kind === "branch") return <GitBranch size={16} color={palette.ink} strokeWidth={2} />

  return (
    <View
      style={{
        width: 15,
        height: 15,
        borderRadius: 999,
        borderWidth: 1.6,
        borderColor: hexToRgba(palette.ink, 0.35),
      }}
    />
  )
}
