import { useState, type ReactNode } from "react"
import { Animated, Pressable, type PressableProps } from "react-native"
import { usePressAnimation } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type IconCircleButtonProps = PressableProps & {
  children: ReactNode
  size?: number
  accessibilityLabel: string
}

/**
 * Circular icon button on surface (header controls: back, search, filter,
 * settings). Colors derive from the active theme palette.
 */
export function IconCircleButton({
  children,
  size = 38,
  accessibilityLabel,
  onPressIn: externalPressIn,
  onPressOut: externalPressOut,
  ...props
}: IconCircleButtonProps) {
  const { palette } = useAppTheme()
  const [pressed, setPressed] = useState(false)
  const press = usePressAnimation()

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={8}
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
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.surfaceRaised,
          borderWidth: 1,
          borderColor: hexToRgba(palette.ink, 0.08),
          opacity: pressed ? 0.72 : 1,
        }}
        {...props}
      >
        {children}
      </Pressable>
    </Animated.View>
  )
}
