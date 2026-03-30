import { useMemo, type PropsWithChildren, type ReactNode } from "react"
import { StyleSheet, Text, View, useWindowDimensions } from "react-native"
import { cn } from "@/lib/cn"
import { useAppTheme } from "@/lib/theme"

type SurfaceCardProps = PropsWithChildren<{
  eyebrow?: string
  title?: string
  description?: string
  footer?: ReactNode
  className?: string
  tone?: "surface" | "panel" | "background"
}>

export function SurfaceCard({
  eyebrow,
  title,
  description,
  footer,
  className,
  tone = "surface",
  children,
}: SurfaceCardProps) {
  const { width } = useWindowDimensions()
  const { palette, isDark } = useAppTheme()
  const compact = useMemo(() => width < 390, [width])
  const backgroundColor =
    tone === "panel" ? palette.panel : tone === "background" ? `${palette.background}dd` : palette.surface
  const borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.9)"

  return (
    <View
      className={cn(`overflow-hidden rounded-[28px] ${compact ? "px-4 py-4" : "px-5 py-5"}`, className)}
      style={{
        borderWidth: 1,
        borderColor,
        backgroundColor,
        shadowColor: isDark ? "#000000" : palette.shadow,
        shadowOpacity: isDark ? 0.32 : 0.1,
        shadowRadius: isDark ? 18 : 20,
        shadowOffset: { width: 0, height: 12 },
      }}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <View
          style={{
            height: 1,
            marginHorizontal: 18,
            marginTop: 1,
            backgroundColor: isDark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.72)",
          }}
        />
        <View
          style={{
            position: "absolute",
            right: -22,
            top: -26,
            width: 84,
            height: 84,
            borderRadius: 999,
            backgroundColor: isDark ? "rgba(255,255,255,0.028)" : "rgba(14,165,233,0.08)",
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 28,
            backgroundColor: isDark ? "rgba(255,255,255,0.015)" : "rgba(232,240,248,0.28)",
          }}
        />
      </View>
      {eyebrow ? (
        <Text selectable className="text-[11px] font-semibold uppercase tracking-[1.8px] text-accent-light/85">
          {eyebrow}
        </Text>
      ) : null}
      {title ? (
        <Text
          selectable
          className={`mt-2 font-semibold tracking-[-0.4px] text-ink ${compact ? "text-[23px] leading-[28px]" : "text-[27px] leading-[31px]"}`}
        >
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text selectable className="mt-2.5 text-[14px] leading-[21px] text-soft">
          {description}
        </Text>
      ) : null}
      {children ? <View className={cn(title || description || eyebrow ? "mt-3.5" : undefined)}>{children}</View> : null}
      {footer ? <View className="mt-4">{footer}</View> : null}
    </View>
  )
}
