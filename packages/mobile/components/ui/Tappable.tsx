import { useState, type ReactNode } from "react"
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native"

type TappableProps = Omit<PressableProps, "style" | "children"> & {
  /**
   * Accepts the same two forms `Pressable` documents, including the
   * `({ pressed }) => style` callback — but resolves the callback here, from
   * state this component holds, and hands the result down as a plain style.
   */
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>)
  children?: ReactNode
}

/**
 * A Pressable whose style always arrives as a plain object.
 *
 * The callback form of `style` does not reach the view in this app — controls
 * written that way render with none of their layout: rows come out stacked,
 * pills lose their fill and padding. Every control that renders correctly here
 * passes an object instead. Rather than rewrite each call site's styling by
 * hand (and risk changing what it says), this keeps the callback at the call
 * site and does the resolution one level down, where the pressed state is
 * ordinary component state.
 *
 * `onPressIn`/`onPressOut` passed by the caller still run; this only adds its
 * own bookkeeping around them.
 */
export function Tappable({ style, onPressIn, onPressOut, children, ...props }: TappableProps) {
  const [pressed, setPressed] = useState(false)

  return (
    <Pressable
      {...props}
      onPressIn={(event) => {
        setPressed(true)
        onPressIn?.(event)
      }}
      onPressOut={(event) => {
        setPressed(false)
        onPressOut?.(event)
      }}
      style={typeof style === "function" ? style({ pressed }) : style}
    >
      {children}
    </Pressable>
  )
}
