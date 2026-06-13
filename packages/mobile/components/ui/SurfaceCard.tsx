import type { PropsWithChildren, ReactNode } from "react"
import { Text, View, useWindowDimensions } from "react-native"
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
  const compact = width < 390
  const backgroundColor =
    tone === "panel" ? palette.panel : tone === "background" ? `${palette.background}dd` : palette.surfaceRaised
  const borderColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(193,208,223,0.86)"

  return (
    <View
      className={cn(`overflow-hidden ${compact ? "px-4 py-4" : "px-5 py-5"}`, className)}
      style={{
        borderRadius: 20,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor,
        backgroundColor,
        shadowColor: palette.shadow,
        shadowOpacity: isDark ? 0.16 : 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
      }}
    >
      {eyebrow ? (
        <Text selectable className="text-[12px] font-semibold text-accent-light/85">
          {eyebrow}
        </Text>
      ) : null}
      {title ? (
        <Text
          selectable
          className={`mt-1.5 font-semibold text-ink ${compact ? "text-[18px] leading-[23px]" : "text-[19px] leading-[24px]"}`}
        >
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text selectable className="mt-2 text-[14px] leading-[20px] text-soft">
          {description}
        </Text>
      ) : null}
      {children ? <View className={cn(title || description || eyebrow ? "mt-3" : undefined)}>{children}</View> : null}
      {footer ? <View className="mt-3">{footer}</View> : null}
    </View>
  )
}
