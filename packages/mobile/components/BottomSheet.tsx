import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Animated, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { AdaptiveBlur } from "@/components/GlassView"
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  Ellipsis,
  Folder,
  GitBranch,
  Globe,
  Search,
  Save,
  Shield,
  SquareTerminal,
  Trash2,
  WrapText,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react-native"
import { Ease, SPRING_SETTLE, usePrefersReducedMotion, usePressAnimation } from "@/lib/animation"
import { useAppTheme } from "@/lib/theme"

export type ActionSheetRef = {
  present(): void
  dismiss(onDismissed?: () => void): void
}

type ActionSheetIconName = string

function iconForName(name: ActionSheetIconName): LucideIcon {
  const value = name.toLowerCase()
  if (value.includes("trash") || value.includes("delete")) return Trash2
  if (value.includes("close") || value.includes("x")) return X
  if (value.includes("branch") || value.includes("git")) return GitBranch
  if (value.includes("copy")) return Copy
  if (value.includes("search")) return Search
  if (value.includes("save")) return Save
  if (value.includes("wrap")) return WrapText
  if (value.includes("folder")) return Folder
  if (value.includes("globe") || value.includes("web")) return Globe
  if (value.includes("terminal") || value.includes("bash") || value.includes("shell")) return SquareTerminal
  if (value.includes("shield")) return Shield
  if (value.includes("check")) return Check
  if (value.includes("alert") || value.includes("warning")) return AlertTriangle
  if (value.includes("ellipsis") || value.includes("more")) return Ellipsis
  if (value.includes("chevron")) return ChevronRight
  return Wrench
}

function snapPointHeight(value: string | number | undefined, windowHeight: number): number {
  if (typeof value === "number") return Math.min(value, windowHeight - 32)
  if (typeof value === "string" && value.endsWith("%")) {
    const percent = Number.parseFloat(value)
    if (Number.isFinite(percent)) return Math.min((windowHeight * percent) / 100, windowHeight - 32)
  }
  return Math.min(280, windowHeight - 32)
}

export const ActionSheet = React.forwardRef<
  ActionSheetRef,
  { children: React.ReactNode; snapPoints?: (string | number)[] }
>(function ActionSheet({ children, snapPoints = [280] }, ref) {
  const { height: windowHeight } = useWindowDimensions()
  const { palette, isDark } = useAppTheme()
  const prefersReducedMotion = usePrefersReducedMotion()
  const [visible, setVisible] = useState(false)
  const translateYRef = useRef<Animated.Value | null>(null)
  if (translateYRef.current === null) translateYRef.current = new Animated.Value(36)
  const translateY = translateYRef.current
  const opacityRef = useRef<Animated.Value | null>(null)
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(0)
  const opacity = opacityRef.current
  const contentHeight = useMemo(() => snapPointHeight(snapPoints[0], windowHeight), [snapPoints, windowHeight])

  const dismiss = useCallback((onDismissed?: () => void) => {
    opacity.stopAnimation()
    translateY.stopAnimation()
    if (prefersReducedMotion) translateY.setValue(0)

    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: prefersReducedMotion ? 120 : 160,
        easing: Ease.accelerate,
        useNativeDriver: true,
      }),
      prefersReducedMotion
        ? Animated.timing(translateY, { toValue: 0, duration: 120, useNativeDriver: true })
        : Animated.spring(translateY, { toValue: 36, ...SPRING_SETTLE }),
    ])
    animation.start(({ finished }) => {
      if (!finished) return
      setVisible(false)
      onDismissed?.()
    })
  }, [opacity, prefersReducedMotion, translateY])

  useImperativeHandle(
    ref,
    () => ({
      present() {
        setVisible(true)
      },
      dismiss,
    }),
    [dismiss],
  )

  useEffect(() => {
    if (!visible) return

    opacity.setValue(0)
    translateY.setValue(prefersReducedMotion ? 0 : 36)
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: prefersReducedMotion ? 140 : 180,
        easing: Ease.decelerate,
        useNativeDriver: true,
      }),
      prefersReducedMotion
        ? Animated.timing(translateY, { toValue: 0, duration: 140, useNativeDriver: true })
        : Animated.spring(translateY, { toValue: 0, ...SPRING_SETTLE }),
    ])
    animation.start()
    return () => animation.stop()
  }, [opacity, prefersReducedMotion, translateY, visible])

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={() => dismiss()}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { opacity, backgroundColor: isDark ? "rgba(0,0,0,0.62)" : "rgba(20,20,19,0.18)" },
          ]}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss actions"
          style={StyleSheet.absoluteFill}
          onPress={() => dismiss()}
        />

        {/* Glass sheet — shadow on outer, clip on inner */}
        <Animated.View
          style={{
            opacity,
            transform: [{ translateY }],
            height: contentHeight,
            backgroundColor: palette.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderCurve: "continuous",
            shadowColor: palette.shadow,
            shadowOpacity: isDark ? 0.28 : 0.12,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: -5 },
            elevation: 16,
          }}
        >
          {/* Glass fill — clipped to border radius */}
          <View
            style={[StyleSheet.absoluteFill, { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: "hidden" }]}
            pointerEvents="none"
          >
            <AdaptiveBlur
              tint={isDark ? "dark" : "light"}
              intensity={isDark ? 90 : 75}
              style={StyleSheet.absoluteFill}
              fallbackColor={isDark ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.82)"}
              opaqueFallbackColor={isDark ? "#111111" : "#FFFFFF"}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  borderWidth: 1,
                  borderBottomWidth: 0,
                  borderColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.64)",
                },
              ]}
            />
          </View>

          <View style={{ height: 12 }} />
          <View style={{ flex: 1, width: "100%", paddingBottom: 8 }}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  )
})

export function ActionSheetItem({
  icon,
  label,
  description,
  onPress,
  destructive = false,
  tone = "accent",
  disabled = false,
}: {
  icon: ActionSheetIconName
  label: string
  description?: string
  onPress(): void
  destructive?: boolean
  tone?: "accent" | "success" | "neutral"
  disabled?: boolean
}) {
  const Icon = iconForName(icon)
  const { palette, isDark } = useAppTheme()
  const press = usePressAnimation()
  const effectiveTone = destructive ? "destructive" : tone
  const iconColor =
    effectiveTone === "destructive"
      ? palette.danger
      : effectiveTone === "success"
        ? palette.success
        : effectiveTone === "neutral"
          ? palette.soft
          : palette.accentLight
  const iconBackground =
    effectiveTone === "destructive"
      ? isDark
        ? "rgba(248,113,113,0.10)"
        : "rgba(207,45,86,0.08)"
      : effectiveTone === "success"
        ? isDark
          ? "rgba(52,211,153,0.08)"
          : "rgba(22,163,74,0.08)"
        : isDark
          ? "rgba(255,255,255,0.07)"
          : "rgba(20,20,19,0.08)"
  const iconBorder =
    effectiveTone === "destructive"
      ? isDark
        ? "rgba(248,113,113,0.20)"
        : "rgba(207,45,86,0.18)"
      : effectiveTone === "success"
        ? isDark
          ? "rgba(52,211,153,0.18)"
          : "rgba(22,163,74,0.16)"
        : isDark
          ? "rgba(255,255,255,0.11)"
          : "rgba(20,20,19,0.16)"

  return (
    <Animated.View style={{ width: "100%", transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label || "Untitled action"}
        accessibilityHint={description}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 14,
          paddingHorizontal: 20,
          paddingVertical: 10,
          minHeight: 64,
          width: "100%",
          opacity: disabled ? 0.48 : pressed ? 0.72 : 1,
        })}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            borderCurve: "continuous",
            backgroundColor: iconBackground,
            borderWidth: 1,
            borderColor: iconBorder,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={19} color={iconColor} strokeWidth={2.1} />
        </View>
        <View style={{ minWidth: 0, flex: 1 }}>
          <Text
            numberOfLines={1}
            style={{
              color: destructive ? palette.danger : palette.ink,
              fontSize: 15,
              lineHeight: 20,
              fontWeight: "600",
              letterSpacing: -0.2,
            }}
          >
            {label || "Untitled action"}
          </Text>
          {description ? (
            <Text
              numberOfLines={1}
              style={{ marginTop: 2, color: palette.soft, fontSize: 12.5, lineHeight: 16 }}
            >
              {description}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  )
}

export function ActionSheetDivider() {
  const { palette, isDark } = useAppTheme()
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: isDark ? "rgba(255,255,255,0.08)" : palette.border,
        marginHorizontal: 16,
        marginVertical: 4,
      }}
    />
  )
}

export function useActionSheetRef() {
  return useRef<ActionSheetRef>(null)
}
