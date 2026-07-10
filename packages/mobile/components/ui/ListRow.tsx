import { useState, type ReactNode } from "react"
import { Animated, Pressable, Text, View, type PressableProps } from "react-native"
import { ChevronRight } from "lucide-react-native"
import { usePressAnimation } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type ListRowProps = Omit<PressableProps, "style"> & {
  /** Leading element: status dot, icon tile, avatar. */
  leading?: ReactNode
  title: string
  /** Meta line under the title; pass a string or custom nodes (diff counts). */
  subtitle?: ReactNode
  /** Trailing element; defaults to a chevron when onPress is set. */
  trailing?: ReactNode
  showChevron?: boolean
}

/**
 * Flat themable list row: leading element, one-line title, quiet meta line.
 * Pressed state uses an ink tint so it works with every theme in both modes.
 * Pair with <Divider inset={...}> between rows.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  showChevron,
  onPressIn: externalPressIn,
  onPressOut: externalPressOut,
  ...props
}: ListRowProps) {
  const { palette } = useAppTheme()
  const [pressed, setPressed] = useState(false)
  const press = usePressAnimation()

  return (
    <Animated.View style={{ transform: [{ scale: press.scale }] }}>
      <Pressable
        accessibilityRole={props.onPress ? "button" : undefined}
        accessibilityLabel={title}
        onPressIn={(event) => {
          setPressed(true)
          if (props.onPress) press.onPressIn()
          externalPressIn?.(event)
        }}
        onPressOut={(event) => {
          setPressed(false)
          if (props.onPress) press.onPressOut()
          externalPressOut?.(event)
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 4,
          borderRadius: 12,
          borderCurve: "continuous",
          backgroundColor: pressed && props.onPress ? hexToRgba(palette.ink, 0.04) : "transparent",
        }}
        {...props}
      >
        {leading ? <View style={{ alignSelf: "flex-start", marginTop: 5 }}>{leading}</View> : null}
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", lineHeight: 20, color: palette.ink }} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            typeof subtitle === "string" ? (
              <Text style={{ fontSize: 13, lineHeight: 18, color: palette.muted }} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : (
              subtitle
            )
          ) : null}
        </View>
        {trailing ?? (showChevron ? <ChevronRight size={16} color={palette.muted} strokeWidth={2} /> : null)}
      </Pressable>
    </Animated.View>
  )
}

/** 8px status dot for ListRow leading slots. */
export function StatusDot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: color }} />
}
