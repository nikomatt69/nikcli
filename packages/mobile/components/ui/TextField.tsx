import { forwardRef, useState } from "react"
import { Text, TextInput, type TextInputProps, View } from "react-native"
import { hexToRgba, useAppTheme } from "@/lib/theme"
import { type as typeStyle } from "@/lib/typography"

type TextFieldProps = TextInputProps & {
  label?: string
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, placeholderTextColor, style, onFocus, onBlur, accessibilityLabel, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false)
  const { colorScheme, palette } = useAppTheme()

  const borderIdle = hexToRgba(palette.ink, 0.1)
  const borderFocused = hexToRgba(palette.ink, 0.25)

  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Text selectable style={{ color: palette.muted, ...typeStyle(12, { weight: "500" }) }}>
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
          opacity: props.editable === false ? 0.6 : 1,
        }}
      >
        <TextInput
          {...props}
          ref={ref}
          placeholderTextColor={placeholderTextColor || palette.muted}
          selectionColor={palette.ink}
          keyboardAppearance={colorScheme === "light" ? "light" : "dark"}
          onFocus={(event) => {
            setFocused(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setFocused(false)
            onBlur?.(event)
          }}
          accessibilityLabel={accessibilityLabel ?? label ?? props.placeholder}
          style={[
            {
              minHeight: props.multiline ? 132 : 44,
              paddingHorizontal: 16,
              paddingVertical: props.multiline ? 14 : 12,
              color: palette.ink,
              textAlignVertical: props.multiline ? "top" : "center",
              ...typeStyle(15, { leadingScale: props.multiline ? 1.05 : 1 }),
            },
            style,
          ]}
        />
      </View>
    </View>
  )
})
