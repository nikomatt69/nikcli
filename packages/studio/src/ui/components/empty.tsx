import type { JSX } from "solid-js"

export function EmptyState(props: { title: string; description?: string; action?: JSX.Element }) {
  return (
    <div class="empty-state">
      <p>{props.title}</p>
      {props.description && <p class="text-muted">{props.description}</p>}
      {props.action}
    </div>
  )
}
