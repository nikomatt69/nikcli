import { splitProps, type JSX } from "solid-js"
import { cn } from "../../lib/utils"

interface BadgeProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "destructive"
  children: JSX.Element
}

export function Badge(props: BadgeProps) {
  const [local, rest] = splitProps(props, ["variant", "children", "class"])

  const variantClasses = {
    default: "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900",
    secondary: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
    outline: "border border-gray-300 text-gray-900 dark:border-gray-600 dark:text-gray-100",
    destructive: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100",
  }

  return (
    <span
      class={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variantClasses[local.variant || "default"],
        local.class,
      )}
      {...rest}
    >
      {local.children}
    </span>
  )
}
