import { forwardRef, useState } from "react"
import { Text, TextInput, type TextInputProps, View } from "react-native"
import { cn } from "@/lib/cn"
import { useAppTheme } from "@/lib/theme"

type TextFieldProps = TextInputProps & {
  label?: string
  className?: string
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, className, placeholderTextColor, style, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false)
  const { colorScheme, palette, isDark } = useAppTheme()

  return (
    <View style={{ gap: 8 }}>
      {label ? (
        <Text selectable className="text-[11px] font-semibold uppercase tracking-[1.6px] text-soft">
          {label}
        </Text>
      ) : null}
      <View
        style={{
          borderRadius: 14,
          borderCurve: "continuous",
          borderWidth: focused ? 1.5 : 1,
          borderColor: focused ? palette.focusRing : isDark ? "rgba(255,255,255,0.08)" : "rgba(193,208,223,0.82)",
          backgroundColor: focused ? palette.surfaceRaised : isDark ? palette.surfaceMuted : "rgba(241,246,251,0.88)",
        }}
      >
        <TextInput
          ref={ref}
          placeholderTextColor={placeholderTextColor || palette.muted}
          selectionColor={palette.accent}
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
              minHeight: props.multiline ? 132 : 46,
              paddingHorizontal: 16,
              paddingVertical: props.multiline ? 14 : 15,
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
