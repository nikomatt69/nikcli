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
  Shield,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react-native"
import { useAppTheme } from "@/lib/theme"

export type ActionSheetRef = {
  present(): void
  dismiss(): void
}

type ActionSheetIconName = string

function iconForName(name: ActionSheetIconName): LucideIcon {
  const value = name.toLowerCase()
  if (value.includes("trash") || value.includes("delete")) return Trash2
  if (value.includes("close") || value.includes("x")) return X
  if (value.includes("branch") || value.includes("git")) return GitBranch
  if (value.includes("copy")) return Copy
  if (value.includes("search")) return Search
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
  const [visible, setVisible] = useState(false)
  const translateYRef = useRef<Animated.Value | null>(null)
  if (translateYRef.current === null) translateYRef.current = new Animated.Value(36)
  const translateY = translateYRef.current
  const opacityRef = useRef<Animated.Value | null>(null)
  if (opacityRef.current === null) opacityRef.current = new Animated.Value(0)
  const opacity = opacityRef.current
  const contentHeight = useMemo(() => snapPointHeight(snapPoints[0], windowHeight), [snapPoints, windowHeight])

  const dismiss = useCallback(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 36, duration: 180, useNativeDriver: true }),
    ])
    animation.start(({ finished }) => {
      if (finished) setVisible(false)
    })
  }, [opacity, translateY])

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
    translateY.setValue(36)
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 18,
        stiffness: 220,
        mass: 0.95,
        useNativeDriver: true,
      }),
    ])
    animation.start()
    return () => animation.stop()
  }, [opacity, translateY, visible])

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={dismiss}>
      <View style={{ flex: 1, justifyContent: "flex-end" }}>
        {/* Backdrop blur */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
          <AdaptiveBlur
            tint={isDark ? "dark" : "light"}
            intensity={isDark ? 15 : 10}
            style={StyleSheet.absoluteFill}
            fallbackColor={isDark ? "rgba(0,0,0,0.72)" : "rgba(20,20,19,0.20)"}
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? "rgba(0,0,0,0.62)" : "rgba(20,20,19,0.16)" }]}
          />
        </Animated.View>

        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />

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

          {/* Drag handle */}
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 8 }}>
            <View
              style={{
                width: 42,
                height: 5,
                borderRadius: 999,
                backgroundColor: isDark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.16)",
              }}
            />
          </View>
          <View style={{ flex: 1, paddingBottom: 8 }}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  )
})

export function ActionSheetItem({
  icon,
  label,
  onPress,
  destructive = false,
}: {
  icon: ActionSheetIconName
  label: string
  onPress(): void
  destructive?: boolean
}) {
  const Icon = iconForName(icon)
  const { palette, isDark } = useAppTheme()

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 20,
        paddingVertical: 14,
        minHeight: 52,
        opacity: pressed ? 0.76 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          backgroundColor: destructive
            ? isDark
              ? "rgba(143,143,143,0.10)"
              : "rgba(207,45,86,0.10)"
            : isDark
              ? "rgba(255,255,255,0.07)"
              : "rgba(20,20,19,0.08)",
          borderWidth: 1,
          borderColor: destructive
            ? isDark
              ? "rgba(143,143,143,0.18)"
              : "rgba(207,45,86,0.18)"
            : isDark
              ? "rgba(255,255,255,0.11)"
              : "rgba(20,20,19,0.18)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={18} color={destructive ? palette.danger : palette.accentLight} strokeWidth={2.1} />
      </View>
      <Text
        style={{
          color: destructive ? palette.danger : palette.ink,
          fontSize: 15,
          fontWeight: "600",
        }}
      >
        {label || "Untitled action"}
      </Text>
    </Pressable>
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
