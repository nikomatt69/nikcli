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
          borderRadius: 22,
          borderWidth: 1,
          borderColor: focused
            ? isDark
              ? "rgba(255,255,255,0.18)"
              : "rgba(14,165,233,0.35)"
            : isDark
              ? "rgba(255,255,255,0.08)"
              : "rgba(193,208,223,0.82)",
          backgroundColor: focused ? palette.surface : isDark ? "rgba(17,17,17,0.92)" : "rgba(241,246,251,0.88)",
          shadowColor: focused ? palette.accent : palette.shadow,
          shadowOpacity: focused ? (isDark ? 0.22 : 0.12) : 0,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
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
          style={[
            {
              minHeight: props.multiline ? 132 : 54,
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
