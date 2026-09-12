import type { PropsWithChildren, ReactNode } from "react"
import { Text, View, useWindowDimensions } from "react-native"
import { cn } from "@/lib/cn"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

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
  const { palette } = useAppTheme()
  const compact = width < 390
  const backgroundColor =
    tone === "panel" ? palette.panel : tone === "background" ? hexToRgba(palette.background, 0.72) : palette.surfaceRaised
  const borderColor = hexToRgba(palette.ink, 0.08)

  return (
    <View
      className={cn(className)}
      style={{
        overflow: "hidden",
        paddingHorizontal: compact ? 16 : 20,
        paddingVertical: compact ? 16 : 20,
        borderRadius: 18,
        borderCurve: "continuous",
        borderWidth: 1,
        borderColor,
        backgroundColor,
      }}
    >
      {eyebrow ? (
        <Text selectable style={{ color: palette.accentLight, ...typeStyle(12, { weight: "600" }) }}>
          {eyebrow}
        </Text>
      ) : null}
      {title ? (
        <Text
          selectable
          style={{
            marginTop: eyebrow ? 6 : 0,
            color: palette.ink,
            ...typeStyle(compact ? 18 : 19, { weight: "600" }),
          }}
        >
          {title}
        </Text>
      ) : null}
      {description ? (
        <Text selectable style={{ marginTop: 8, color: palette.soft, ...typeStyle(14) }}>
          {description}
        </Text>
      ) : null}
      {children ? <View style={{ marginTop: title || description || eyebrow ? 12 : 0 }}>{children}</View> : null}
      {footer ? <View style={{ marginTop: 12 }}>{footer}</View> : null}
    </View>
  )
}
