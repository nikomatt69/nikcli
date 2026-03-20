import { useRef } from "react"
import { ActivityIndicator, Animated, Pressable, Text, type PressableProps } from "react-native"
import { cn } from "@/lib/cn"
import { useAppTheme } from "@/lib/theme"

type ActionButtonProps = PressableProps & {
  label: string
  loading?: boolean
  variant?: "primary" | "secondary" | "ghost" | "danger"
}

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
  const scale = useRef(new Animated.Value(1)).current

  const buttonClass =
    variant === "secondary"
      ? "border border-border bg-background/70"
      : variant === "ghost"
        ? "border border-border/70 bg-surface"
        : variant === "danger"
          ? "border border-danger/25 bg-danger/10"
          : "bg-accent"

  const textClass = variant === "primary" ? "text-slate-950" : variant === "danger" ? "text-rose-200" : "text-ink"

  function handlePressIn(e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) {
    if (!disabled && !loading) {
      Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, speed: 60, bounciness: 0 }).start()
    }
    externalPressIn?.(e)
  }

  function handlePressOut(e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }).start()
    externalPressOut?.(e)
  }

  return (
    <Animated.View style={{ transform: [{ scale }], opacity: disabled || loading ? 0.58 : 1 }}>
      <Pressable
        disabled={disabled || loading}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed }) => ({ opacity: pressed ? 0.84 : 1 })}
        className={cn("items-center justify-center rounded-[24px] px-4 py-4", buttonClass, className)}
        {...props}
      >
        {loading ? (
          <ActivityIndicator color={variant === "primary" ? palette.codeText : palette.accent} />
        ) : (
          <Text className={cn("text-center text-[15px] font-semibold", textClass)}>{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  )
}
