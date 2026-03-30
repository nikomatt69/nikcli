import { useEffect, useRef } from "react"
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type PressableProps } from "react-native"
import { cn } from "@/lib/cn"
import { useAppTheme } from "@/lib/theme"
import { AdaptiveBlur } from "@/components/GlassView"

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
  const { palette, isDark } = useAppTheme()
  const scale = useRef(new Animated.Value(1)).current
  const inactive = Boolean(disabled || loading)

  useEffect(() => {
    return () => {
      scale.stopAnimation()
    }
  }, [scale])

  const tone =
    variant === "secondary"
      ? {
          backgroundColor: isDark ? "rgba(26,26,26,0.86)" : "rgba(241,246,251,0.84)",
          overlayColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.18)",
          borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(193,208,223,0.78)",
          textColor: palette.ink,
        }
      : variant === "ghost"
        ? {
            backgroundColor: isDark ? "rgba(24,24,24,0.82)" : "rgba(255,255,255,0.58)",
            overlayColor: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.14)",
            borderColor: isDark ? "rgba(255,255,255,0.16)" : "rgba(193,208,223,0.55)",
            textColor: palette.ink,
          }
        : variant === "danger"
          ? {
              backgroundColor: isDark ? "rgba(80,28,28,0.86)" : "rgba(239,68,68,0.10)",
              overlayColor: isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.02)",
              borderColor: isDark ? "rgba(248,113,113,0.34)" : "rgba(239,68,68,0.22)",
              textColor: isDark ? "#fff4f4" : palette.danger,
            }
          : {
              backgroundColor: isDark ? "rgba(255,255,255,0.90)" : palette.accent,
              overlayColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.06)",
              borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(14,165,233,0.12)",
              textColor: isDark ? "#0a0a0a" : palette.codeText,
            }
  const variantClassName =
    variant === "secondary"
      ? "border-border bg-surface"
      : variant === "ghost"
        ? "border-border/70 bg-background/85"
        : variant === "danger"
          ? "border-danger/30 bg-danger/10"
          : "border-accent/30 bg-accent"

  function handlePressIn(e: Parameters<NonNullable<PressableProps["onPressIn"]>>[0]) {
    if (!disabled && !loading) {
      scale.stopAnimation()
      Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, speed: 60, bounciness: 0 }).start()
    }
    externalPressIn?.(e)
  }

  function handlePressOut(e: Parameters<NonNullable<PressableProps["onPressOut"]>>[0]) {
    scale.stopAnimation()
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }).start()
    externalPressOut?.(e)
  }

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        disabled={disabled || loading}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        className={cn(
          "min-h-[54px] items-center justify-center overflow-hidden rounded-[24px] border px-4 py-3.5",
          variantClassName,
          className,
        )}
        style={({ pressed }) => ({
          opacity: inactive ? (isDark ? 0.66 : 0.58) : pressed ? 0.92 : 1,
          shadowColor: variant === "primary" && !inactive ? palette.accent : palette.shadow,
          shadowOpacity: inactive ? 0 : variant === "primary" ? (isDark ? 0.3 : 0.18) : isDark ? 0.2 : 0.08,
          shadowRadius: variant === "primary" ? 20 : 12,
          shadowOffset: { width: 0, height: variant === "primary" ? 12 : 6 },
        })}
        {...props}
      >
        <AdaptiveBlur
          tint={isDark ? "dark" : "light"}
          intensity={variant === "primary" ? 70 : 45}
          style={StyleSheet.absoluteFill}
          fallbackColor={tone.backgroundColor}
          pointerEvents="none"
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: tone.overlayColor }]} pointerEvents="none" />
        {inactive ? (
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: isDark ? "rgba(8,8,8,0.28)" : "rgba(255,255,255,0.22)" },
            ]}
            pointerEvents="none"
          />
        ) : null}
        {loading ? (
          <ActivityIndicator color={tone.textColor} />
        ) : (
          <Text
            style={{
              color: tone.textColor,
              textAlign: "center",
              fontSize: 15,
              fontWeight: "700",
              letterSpacing: 0.15,
            }}
          >
            {label}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  )
}
