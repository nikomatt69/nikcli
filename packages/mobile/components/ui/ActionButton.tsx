import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native"
import { cn } from "@/lib/cn"

type ActionButtonProps = PressableProps & {
  label: string
  loading?: boolean
  variant?: "primary" | "secondary" | "ghost" | "danger"
}

export function ActionButton({
  label,
  loading,
  disabled,
  variant = "primary",
  className,
  ...props
}: ActionButtonProps) {
  const buttonClass =
    variant === "secondary"
      ? "border border-border bg-background/70"
      : variant === "ghost"
        ? "border border-border/70 bg-surface"
        : variant === "danger"
          ? "border border-danger/25 bg-danger/10"
          : "bg-accent"

  const textClass = variant === "primary" ? "text-slate-950" : variant === "danger" ? "text-rose-200" : "text-ink"

  return (
    <Pressable
      disabled={disabled || loading}
      className={cn("items-center justify-center rounded-[24px] px-4 py-4", buttonClass, className)}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? "#082f49" : "#7dd3fc"} />
      ) : (
        <Text className={cn("text-center font-semibold", textClass)}>{label}</Text>
      )}
    </Pressable>
  )
}
