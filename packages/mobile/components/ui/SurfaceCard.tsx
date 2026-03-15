import type { PropsWithChildren, ReactNode } from "react"
import { Text, View } from "react-native"
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
  const toneClass = tone === "panel" ? "bg-panel" : tone === "background" ? "bg-background/70" : "bg-surface"

  return (
    <View className={cn("overflow-hidden rounded-[32px] border border-border px-5 py-5", toneClass, className)}>
      {eyebrow ? (
        <Text className="text-[11px] font-semibold uppercase tracking-[2.2px] text-accent-light">{eyebrow}</Text>
      ) : null}
      {title ? <Text className="mt-2 text-[28px] font-semibold leading-[32px] text-ink">{title}</Text> : null}
      {description ? <Text className="mt-3 text-sm leading-6 text-soft">{description}</Text> : null}
      {children ? <View className={cn(title || description || eyebrow ? "mt-4" : undefined)}>{children}</View> : null}
      {footer ? <View className="mt-4">{footer}</View> : null}
    </View>
  )
}
