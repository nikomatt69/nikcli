import { useState, type ReactNode } from "react"
import { Animated, Pressable, type PressableProps } from "react-native"
import { usePressAnimation } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type IconCircleButtonProps = PressableProps & {
  children: ReactNode
  size?: number
  accessibilityLabel: string
  /** `warm` tints with accent. `inverse` is for dark overlays such as the QR scanner. */
  tone?: "surface" | "warm" | "inverse"
}

/**
 * Circular icon button on surface (header controls: back, search, filter,
 * settings). Colors derive from the active theme palette.
 */
export function IconCircleButton({
  children,
  size = 44,
  accessibilityLabel,
  tone = "surface",
  style,
  onPressIn: externalPressIn,
  onPressOut: externalPressOut,
  ...props
}: IconCircleButtonProps) {
  const { palette } = useAppTheme()
  const [pressed, setPressed] = useState(false)
  const press = usePressAnimation()
  const inverse = tone === "inverse"
  const warm = tone === "warm"

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale: press.scale }] }}>
      <Pressable
        {...props}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ ...props.accessibilityState, disabled: Boolean(props.disabled) }}
        hitSlop={props.hitSlop ?? Math.max(8, (44 - size) / 2)}
        onPressIn={(event) => {
          setPressed(true)
          press.onPressIn()
          externalPressIn?.(event)
        }}
        onPressOut={(event) => {
          setPressed(false)
          press.onPressOut()
          externalPressOut?.(event)
        }}
        style={(state) => [
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderCurve: "continuous",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: inverse
              ? "rgba(255,255,255,0.16)"
              : warm
                ? hexToRgba(palette.accent, 0.18)
                : palette.surfaceRaised,
            borderWidth: 1,
            borderColor: inverse ? "rgba(255,255,255,0.22)" : hexToRgba(palette.ink, warm ? 0.06 : 0.12),
            opacity: props.disabled ? 0.45 : pressed ? 0.72 : 1,
          },
          typeof style === "function" ? style(state) : style,
        ]}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
}
