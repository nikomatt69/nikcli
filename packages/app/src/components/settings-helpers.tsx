import { createMemo, type Component, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { useGlobalSync } from "@/context/global-sync"
import { useLayout } from "@/context/layout"
import { decode64 } from "@/utils/base64"

export function useSettingsDirectory() {
  const params = useParams()
  return createMemo(() => decode64(params.dir) ?? "")
}

export function useSettingsProject() {
  const layout = useLayout()
  const globalSync = useGlobalSync()
  const directory = useSettingsDirectory()

  return createMemo(() => {
    const dir = directory()
    if (!dir) return

    const projects = layout.projects.list()
    const sandbox = projects.find((project) => project.sandboxes?.includes(dir))
    if (sandbox) return sandbox

    const direct = projects.find((project) => project.worktree === dir)
    if (direct) return direct

    const [child] = globalSync.child(dir, { bootstrap: false })
    const id = child.project
    if (!id) return

    const meta = globalSync.data.project.find((project) => project.id === id)
    const root = meta?.worktree
    if (!root) return
    return projects.find((project) => project.worktree === root)
  })
}

export const SettingsRow: Component<{
  title: string
  description?: string | JSX.Element
  children: JSX.Element
}> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        {props.description && <span class="text-12-regular text-text-weak">{props.description}</span>}
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
