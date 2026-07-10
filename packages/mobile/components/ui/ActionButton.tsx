import { useState } from "react"
import { ActivityIndicator, Animated, Pressable, Text, type PressableProps } from "react-native"
import { cn } from "@/lib/cn"
import { usePressAnimation } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type ActionButtonProps = PressableProps & {
  label: string
  loading?: boolean
  variant?: "primary" | "secondary" | "ghost" | "danger"
}

/**
 * Pill-shaped action button. Primary is a solid ink fill with inverted text;
 * the other variants sit on surface with a hairline border. All colors derive
 * from the active theme palette so every theme keeps working.
 */
export function ActionButton({
  label,
  loading,
  disabled,
  variant = "primary",
  className,
  onPressIn: externalPressIn,
  onPressOut: externalPressOut,
  ...props
}: ActionButtonProps) {
  const { palette } = useAppTheme()
  const { scale, onPressIn, onPressOut } = usePressAnimation()
  const [pressed, setPressed] = useState(false)
  const inactive = Boolean(disabled || loading)

  const tone =
    variant === "secondary"
      ? {
          backgroundColor: palette.surfaceRaised,
          borderColor: hexToRgba(palette.ink, 0.12),
          textColor: palette.ink,
        }
      : variant === "ghost"
        ? {
            backgroundColor: "transparent",
            borderColor: hexToRgba(palette.ink, 0.08),
            textColor: palette.ink,
          }
        : variant === "danger"
          ? {
              backgroundColor: hexToRgba(palette.danger, 0.1),
              borderColor: hexToRgba(palette.danger, 0.2),
              textColor: palette.danger,
            }
          : {
              backgroundColor: palette.ink,
              borderColor: "transparent",
              textColor: palette.background,
            }

  function handlePressIn(e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) {
    if (!disabled && !loading) {
      setPressed(true)
      onPressIn()
    }
    externalPressIn?.(e)
  }

  function handlePressOut(e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) {
    setPressed(false)
    onPressOut()
    externalPressOut?.(e)
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
        disabled={disabled || loading}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        className={cn("min-h-[48px] items-center justify-center overflow-hidden px-5 py-3", className)}
        style={{
          borderRadius: 999,
          borderCurve: "continuous",
          borderWidth: variant === "primary" ? 0 : 1,
          borderColor: tone.borderColor,
          backgroundColor: tone.backgroundColor,
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        }}
        {...props}
      >
        {loading ? (
          <ActivityIndicator color={tone.textColor} />
        ) : (
          <Text
            style={{
              color: tone.textColor,
              textAlign: "center",
              fontSize: 15,
              fontWeight: "600",
              letterSpacing: 0,
            }}
          >
            {label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  )
}
