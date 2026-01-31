import { splitProps, type JSX } from "solid-js"
import { cn } from "../../lib/utils"

interface SkeletonProps extends JSX.HTMLAttributes<HTMLDivElement> {
  class?: string
}

export function Skeleton(props: SkeletonProps) {
  const [local, rest] = splitProps(props, ["class"])

  return <div class={cn("animate-pulse rounded-md bg-gray-200 dark:bg-gray-800", local.class)} {...rest} />
}

interface SkeletonTextProps {
  lines?: number
  class?: string
}

export function SkeletonText(props: SkeletonTextProps) {
  const lines = props.lines || 3

  return (
    <div class={cn("space-y-2", props.class)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton class={cn("h-4", i === lines - 1 && lines > 1 ? "w-3/4" : "w-full")} />
      ))}
    </div>
  )
}

interface SkeletonCardProps {
  class?: string
}

export function SkeletonCard(props: SkeletonCardProps) {
  return (
    <div class={cn("space-y-3", props.class)}>
      <Skeleton class="h-48 w-full" />
      <Skeleton class="h-4 w-3/4" />
      <Skeleton class="h-4 w-1/2" />
    </div>
  )
}
