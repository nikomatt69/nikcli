import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Animated, Modal, Pressable, Text, View, useWindowDimensions } from "react-native"
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
  const translateY = useRef(new Animated.Value(36)).current
  const opacity = useRef(new Animated.Value(0)).current
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
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: isDark ? "rgba(2, 6, 23, 0.58)" : "rgba(15, 23, 42, 0.18)",
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={dismiss} />
        <Animated.View
          style={{
            opacity,
            transform: [{ translateY }],
            height: contentHeight,
            backgroundColor: palette.surface,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            borderWidth: 1,
            borderBottomWidth: 0,
            borderColor: palette.border,
            paddingBottom: 24,
            shadowColor: palette.shadow,
            shadowOpacity: 0.26,
            shadowRadius: 18,
            shadowOffset: { width: 0, height: -8 },
          }}
        >
          <View style={{ alignItems: "center", paddingTop: 10, paddingBottom: 8 }}>
            <View style={{ width: 42, height: 5, borderRadius: 999, backgroundColor: palette.border }} />
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
            ? "rgba(239, 68, 68, 0.12)"
            : isDark
              ? "rgba(56, 189, 248, 0.1)"
              : "rgba(14, 165, 233, 0.1)",
          borderWidth: 1,
          borderColor: destructive
            ? "rgba(239, 68, 68, 0.2)"
            : isDark
              ? "rgba(56, 189, 248, 0.2)"
              : "rgba(14, 165, 233, 0.2)",
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
  const { palette } = useAppTheme()
  return <View style={{ height: 1, backgroundColor: palette.border, marginHorizontal: 16, marginVertical: 4 }} />
}

export function useActionSheetRef() {
  return useRef<ActionSheetRef>(null)
}
