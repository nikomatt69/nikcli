import { For, Show, createMemo } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import type { FileDiff } from "@nikcli-ai/sdk/httpapi"
import path from "node:path"

type FileItem = { file: FileDiff; index: number; name: string; directory: string }
type GroupedFiles = { directory: string; files: FileItem[] }

export function order(files: FileDiff[]) {
  return files
    .map((file, index) => ({ file, index, directory: path.dirname(file.file) }))
    .sort((a, b) => {
      if (a.directory === b.directory) return a.index - b.index
      return a.directory.localeCompare(b.directory)
    })
    .map((item) => item.file)
}

export function FileList(props: {
  files: FileDiff[]
  selected: number
  comments: Map<string, number>
  onSelect: (index: number) => void
  onSwitch?: () => void
  width: number
  focused: boolean
  filterText: string
  filterActive: boolean
  onFilterChange: (text: string) => void
  onFilterDeactivate: () => void
}) {
  const { theme } = useTheme()

  const filteredItems = createMemo<FileItem[]>(() => {
    const filter = props.filterText ?? ""
    const lower = filter.toLowerCase()
    return props.files
      .map((file, index) => ({
        file,
        index,
        name: path.basename(file.file),
        directory: path.dirname(file.file),
      }))
      .filter((item) => !filter || item.file.file.toLowerCase().includes(lower))
  })

  const grouped = createMemo(() => groupItems(filteredItems()))

  useKeyboard((evt) => {
    if (!props.focused) return

    if (props.filterActive) {
      if (evt.name === "escape") {
        evt.preventDefault()
        props.onFilterChange("")
        props.onFilterDeactivate()
        return
      }
      if (evt.name === "backspace") {
        evt.preventDefault()
        props.onFilterChange(props.filterText.slice(0, -1))
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        props.onFilterDeactivate()
        props.onSwitch?.()
        return
      }
      if (!evt.ctrl && !evt.meta && evt.name?.length === 1) {
        evt.preventDefault()
        props.onFilterChange(props.filterText + evt.name)
        return
      }
    }

    if (evt.name === "j" || evt.name === "down") {
      evt.preventDefault()
      const visible = filteredItems()
      if (visible.length === 0) return
      const pos = visible.findIndex((i) => i.index === props.selected)
      const nextPos = pos === -1 || pos === visible.length - 1 ? 0 : pos + 1
      props.onSelect(visible[nextPos].index)
    }
    if (evt.name === "k" || evt.name === "up") {
      evt.preventDefault()
      const visible = filteredItems()
      if (visible.length === 0) return
      const pos = visible.findIndex((i) => i.index === props.selected)
      const nextPos = pos <= 0 ? visible.length - 1 : pos - 1
      props.onSelect(visible[nextPos].index)
    }
    if (evt.name === "g" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      const visible = filteredItems()
      if (visible.length === 0) return
      props.onSelect(visible[0].index)
    }
    if (evt.name === "G" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      const visible = filteredItems()
      if (visible.length === 0) return
      props.onSelect(visible[visible.length - 1].index)
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onSwitch?.()
    }
  })

  return (
    <box width={props.width} height="100%" border={["right"]} borderColor={theme.border.subtle}>
      <scrollbox flexGrow={1} paddingLeft={2} paddingRight={1} paddingTop={1} scrollbarOptions={{ visible: false }}>
        <box gap={0}>
          <Show when={props.filterActive || props.filterText.length > 0}>
            <box flexDirection="row" gap={0} paddingBottom={1}>
              <text fg={theme.accent.fg}>{"/"}</text>
              <text fg={theme.foreground.default}>{props.filterActive ? `${props.filterText}▊` : props.filterText}</text>
            </box>
          </Show>
          <text fg={theme.foreground.default}>
            <b>Modified Files</b> ({filteredItems().length}
            {props.filterText ? `/${props.files.length}` : ""})
          </text>
          <box height={1} />
          <Show
            when={filteredItems().length > 0}
            fallback={<text fg={theme.foreground.muted}>{props.filterText ? "No matches" : "No files modified"}</text>}
          >
            <For each={grouped()}>
              {(group) => (
                <box gap={0}>
                  <text fg={theme.foreground.muted}>{group.directory}/</text>
                  <For each={group.files}>
                    {(item) => {
                      const commentCount = () => props.comments.get(item.file.file) ?? 0
                      return (
                        <box
                          flexDirection="row"
                          gap={1}
                          justifyContent="space-between"
                          backgroundColor={item.index === props.selected ? theme.surface.offset : undefined}
                          paddingLeft={2}
                          paddingRight={1}
                          onMouseDown={() => props.onSelect(item.index)}
                        >
                          <text fg={theme.foreground.default} wrapMode="none" flexShrink={1}>
                            {item.name}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={commentCount() > 0}>
                              <text fg={theme.accent.fg}>{`@${commentCount()}`}</text>
                            </Show>
                            <Show when={item.file.additions}>
                              <text fg={theme.diff.added}>{`+${item.file.additions}`}</text>
                            </Show>
                            <Show when={item.file.deletions}>
                              <text fg={theme.diff.removed}>{`-${item.file.deletions}`}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </box>
              )}
            </For>
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}

function truncateDirectory(dir: string, maxSegments = 3): string {
  if (dir === ".") return "."
  const segments = dir.split("/").filter(Boolean)
  if (segments.length <= maxSegments) return dir
  return ".../" + segments.slice(-maxSegments).join("/")
}

function groupItems(items: FileItem[]): GroupedFiles[] {
  const groups = new Map<string, FileItem[]>()
  for (const item of items) {
    const group = groups.get(item.directory) ?? []
    group.push(item)
    groups.set(item.directory, group)
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([directory, files]) => ({ directory: truncateDirectory(directory), files }))
}
