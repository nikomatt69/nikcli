import { useMemo, type PropsWithChildren, type ReactNode } from "react"
import { Text, View, useWindowDimensions } from "react-native"
import { cn } from "@/lib/cn"

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
  const toneClass = tone === "panel" ? "bg-panel" : tone === "background" ? "bg-background/70" : "bg-surface"
  const compact = useMemo(() => width < 390, [width])

  return (
    <View
      className={cn(
        `overflow-hidden rounded-[28px] border border-border ${compact ? "px-4 py-4" : "px-5 py-5"}`,
        toneClass,
        className,
      )}
    >
      {eyebrow ? (
        <Text className="text-[11px] font-semibold uppercase tracking-[2px] text-accent-light">{eyebrow}</Text>
      ) : null}
      {title ? (
        <Text
          className={`mt-2 font-semibold text-ink ${compact ? "text-[24px] leading-[28px]" : "text-[28px] leading-[32px]"}`}
        >
          {title}
        </Text>
      ) : null}
      {description ? <Text className="mt-2.5 text-sm leading-5 text-soft">{description}</Text> : null}
      {children ? <View className={cn(title || description || eyebrow ? "mt-3.5" : undefined)}>{children}</View> : null}
      {footer ? <View className="mt-4">{footer}</View> : null}
    </View>
  )
}
