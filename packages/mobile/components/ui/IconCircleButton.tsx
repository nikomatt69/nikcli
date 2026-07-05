import { useState, type ReactNode } from "react"
import { Pressable, type PressableProps } from "react-native"
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
export function IconCircleButton({ children, size = 38, accessibilityLabel, ...props }: IconCircleButtonProps) {
  const { palette } = useAppTheme()
  const [pressed, setPressed] = useState(false)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.surfaceRaised,
        borderWidth: 1,
        borderColor: hexToRgba(palette.ink, 0.08),
        opacity: pressed ? 0.7 : 1,
      }}
      {...props}
    >
      {children}
    </Pressable>
  )
}
