import { useState, type ReactNode } from "react"
import { Animated, Pressable, Text, View, useWindowDimensions, type PressableProps } from "react-native"
import { ChevronRight } from "lucide-react-native"
import { usePressAnimation } from "@/lib/animation"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

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
  const { fontScale } = useWindowDimensions()
  const [pressed, setPressed] = useState(false)
  const press = usePressAnimation()

  return (
    <Animated.View style={{ alignSelf: "stretch", transform: [{ scale: press.scale }] }}>
      <Pressable
        {...props}
        accessibilityRole={props.onPress ? "button" : undefined}
        accessibilityLabel={props.accessibilityLabel ?? (typeof subtitle === "string" ? `${title}, ${subtitle}` : title)}
        accessibilityState={{ ...props.accessibilityState, disabled: Boolean(props.disabled) }}
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
        style={{ alignSelf: "stretch" }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 13,
            paddingHorizontal: 4,
            minHeight: 44,
            opacity: props.disabled ? 0.5 : 1,
            borderRadius: 12,
            borderCurve: "continuous",
            backgroundColor: pressed && props.onPress ? hexToRgba(palette.ink, 0.04) : "transparent",
          }}
        >
          {leading ? <View style={{ alignSelf: "flex-start", marginTop: 5 }}>{leading}</View> : null}
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={{ color: palette.ink, ...typeStyle(15, { weight: "600" }) }} numberOfLines={fontScale > 1 ? undefined : 1}>
              {title}
            </Text>
            {subtitle ? (
              typeof subtitle === "string" ? (
                <Text style={{ color: palette.muted, ...typeStyle(13) }} numberOfLines={fontScale > 1 ? undefined : 2}>
                  {subtitle}
                </Text>
              ) : (
                subtitle
              )
            ) : null}
          </View>
          {trailing ?? ((showChevron ?? Boolean(props.onPress)) ? <ChevronRight size={16} color={palette.muted} strokeWidth={2} /> : null)}
        </View>
      </Pressable>
    </Animated.View>
  )
}

/** 8px status dot for ListRow leading slots. */
export function StatusDot({ color }: { color: string }) {
  return <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: color }} />
}
