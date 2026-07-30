import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { SheetShell } from "@/components/ui/SheetShell"
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
import { usePressAnimation } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

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
  {
    children: React.ReactNode
    snapPoints?: (string | number)[]
    onVisibilityChange?(visible: boolean): void
  }
>(function ActionSheet({ children, snapPoints = [280], onVisibilityChange }, ref) {
  const { height: windowHeight } = useWindowDimensions()
  const [visible, setVisible] = useState(false)
  const pendingDismissal = useRef<(() => void) | undefined>(undefined)
  const contentHeight = useMemo(() => snapPointHeight(snapPoints[0], windowHeight), [snapPoints, windowHeight])

  const close = useCallback(
    (onDismissed?: () => void) => {
      pendingDismissal.current = onDismissed
      onVisibilityChange?.(false)
      setVisible(false)
    },
    [onVisibilityChange],
  )

  useImperativeHandle(
    ref,
    () => ({
      present() {
        onVisibilityChange?.(true)
        setVisible(true)
      },
      dismiss: close,
    }),
    [close, onVisibilityChange],
  )

  return (
    <SheetShell
      visible={visible}
      height={contentHeight}
      accessibilityLabel="Actions"
      onClose={() => close()}
      onDismissed={() => {
        const callback = pendingDismissal.current
        pendingDismissal.current = undefined
        callback?.()
      }}
    >
      <View style={{ flex: 1, width: "100%", paddingBottom: 8 }}>{children}</View>
    </SheetShell>
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
  // The tint is always derived from the tone's own token, so every theme keeps a coherent
  // relationship between an action's icon and the well it sits in.
  const iconColor =
    effectiveTone === "destructive"
      ? palette.danger
      : effectiveTone === "success"
        ? palette.success
        : effectiveTone === "neutral"
          ? palette.soft
          : palette.accentLight
  const wellSource = effectiveTone === "destructive" || effectiveTone === "success" ? iconColor : palette.ink
  const iconBackground = hexToRgba(wellSource, isDark ? 0.09 : 0.08)
  const iconBorder = hexToRgba(wellSource, isDark ? 0.18 : 0.16)

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
              ...typeStyle(15, { weight: "600", leadingScale: 0.99 }),
            }}
          >
            {label || "Untitled action"}
          </Text>
          {description ? (
            <Text numberOfLines={1} style={{ marginTop: 2, color: palette.soft, ...typeStyle(12.5) }}>
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
        backgroundColor: isDark ? hexToRgba(palette.ink, 0.08) : palette.border,
        marginHorizontal: 16,
        marginVertical: 4,
      }}
    />
  )
}

export function useActionSheetRef() {
  return useRef<ActionSheetRef>(null)
}
