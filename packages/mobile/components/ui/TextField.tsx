import { forwardRef, useState } from "react"
import { Text, TextInput, type TextInputProps, View } from "react-native"
import { cn } from "@/lib/cn"
import { useAppTheme } from "@/lib/theme"

type TextFieldProps = TextInputProps & {
  label?: string
  className?: string
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, className, placeholderTextColor, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false)
  const { colorScheme, palette } = useAppTheme()

  return (
    <View>
      {label ? (
        <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[1.8px] text-soft">{label}</Text>
      ) : null}
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
        className={cn(
          `rounded-[22px] border px-4 py-3.5 text-base text-ink ${focused ? "border-accent/40 bg-surface" : "border-border bg-background"}`,
          props.multiline ? "min-h-[132px] leading-6" : undefined,
          className,
        )}
        {...props}
      />
    </View>
  )
})
