import type { RouteSectionProps } from "@solidjs/router"

export default function Layout(props: RouteSectionProps) {
  return <div class="h-full w-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">{props.children}</div>
}
