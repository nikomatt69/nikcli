import { forwardRef } from "react"
import { Text, TextInput, type TextInputProps, View } from "react-native"
import { cn } from "@/lib/cn"

type TextFieldProps = TextInputProps & {
  label?: string
  className?: string
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, className, placeholderTextColor = "#6d84a0", ...props },
  ref,
) {
  return (
    <View>
      {label ? (
        <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[1.8px] text-soft">{label}</Text>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={placeholderTextColor}
        className={cn(
          "rounded-[24px] border border-border bg-background px-4 py-4 text-base text-ink",
          props.multiline ? "min-h-[140px] leading-6" : undefined,
          className,
        )}
        {...props}
      />
    </View>
  )
})
