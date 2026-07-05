import { forwardRef, useState } from "react"
import { Text, TextInput, type TextInputProps, View } from "react-native"
import { cn } from "@/lib/cn"
import { hexToRgba, useAppTheme } from "@/lib/theme"

type TextFieldProps = TextInputProps & {
  label?: string
  className?: string
}

/**
 * Soft pill input on surface with a hairline border. Focus is signalled by a
 * slightly stronger border, not a colored ring.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, className, placeholderTextColor, style, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false)
  const { colorScheme, palette } = useAppTheme()

  const borderIdle = hexToRgba(palette.ink, 0.1)
  const borderFocused = hexToRgba(palette.ink, 0.25)

  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Text selectable className="text-[12px] font-medium text-muted">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: props.multiline ? 20 : 999,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: focused ? borderFocused : borderIdle,
          backgroundColor: palette.surfaceRaised,
        }}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={placeholderTextColor || palette.muted}
          selectionColor={palette.ink}
          keyboardAppearance={colorScheme === "light" ? "light" : "dark"}
          onFocus={(event) => {
            setFocused(true)
            props.onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            props.onBlur?.(event)
          }}
          className={cn("text-base text-ink", props.multiline ? "min-h-[132px] leading-6" : undefined, className)}
          accessibilityLabel={props.accessibilityLabel ?? label}
          style={[
            {
              minHeight: props.multiline ? 132 : 44,
              paddingHorizontal: 16,
              paddingVertical: props.multiline ? 14 : 12,
              fontSize: 15,
              lineHeight: props.multiline ? 24 : 20,
              color: palette.ink,
            },
            style,
          ]}
          {...props}
        />
      </View>
    </View>
  )
})
