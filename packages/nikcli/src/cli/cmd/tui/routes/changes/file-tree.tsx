import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import type { Snapshot } from "@/snapshot"
import path from "node:path"
import {
  allExpandedFileTreeDirectories,
  buildFileTree,
  fileTreeFileSelection,
  flattenFileTree,
  moveFileTreeSelection,
  moveFileTreeSelectionToFirstChild,
  moveFileTreeSelectionToParent,
  setFileTreeDirectoryExpanded,
  toggleFileTreeDirectory,
} from "./file-tree-utils"

export function FileTree(props: {
  files: Snapshot.FileDiff[]
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
  reviewed?: ReadonlySet<string>
}) {
  const { theme } = useTheme()

  const filtered = createMemo<Snapshot.FileDiff[]>(() => {
    const filter = props.filterText ?? ""
    const lower = filter.toLowerCase()
    if (!lower) return props.files
    return props.files.filter((file) => file.file.toLowerCase().includes(lower))
  })

  const filteredIndexMap = createMemo(() => {
    // Map: index in `filtered()` -> index in original `props.files`
    const map = new Map<number, number>()
    const lower = (props.filterText ?? "").toLowerCase()
    let f = 0
    props.files.forEach((file, originalIndex) => {
      if (!lower || file.file.toLowerCase().includes(lower)) {
        map.set(f, originalIndex)
        f += 1
      }
    })
    return map
  })

  const tree = createMemo(() => buildFileTree(filtered()))
  const [expanded, setExpanded] = createSignal<ReadonlySet<number>>(new Set())
  const [highlighted, setHighlighted] = createSignal<number | undefined>(undefined)

  createEffect(() => {
    setExpanded(allExpandedFileTreeDirectories(tree()))
    setHighlighted(undefined)
  })

  const rows = createMemo(() => flattenFileTree(tree(), expanded()))

  // Sync external `selected` (in original-files index space) → tree highlight
  createEffect(() => {
    const sel = props.selected
    if (sel == null || sel < 0) return
    // Map original index → filtered index
    let filteredIndex = -1
    for (const [fi, oi] of filteredIndexMap()) {
      if (oi === sel) {
        filteredIndex = fi
        break
      }
    }
    if (filteredIndex < 0) return
    const found = fileTreeFileSelection(tree(), filteredIndex)
    if (!found) return
    setExpanded((prev) => {
      const next = new Set(prev)
      found.expandedNodes.forEach((id) => next.add(id))
      return next
    })
    setHighlighted(found.highlightedNode)
  })

  function selectFileNode(nodeId: number) {
    const row = rows().find((r) => r.id === nodeId)
    if (!row || row.fileIndex === undefined) return
    const originalIndex = filteredIndexMap().get(row.fileIndex)
    if (originalIndex !== undefined) props.onSelect(originalIndex)
  }

  function moveToFile(offset: number) {
    const all = rows()
    const fileRows = all.filter((r) => r.fileIndex !== undefined)
    if (fileRows.length === 0) return
    const cur = highlighted()
    const currentFileRowIdx = cur === undefined ? -1 : fileRows.findIndex((r) => r.id === cur)
    const next =
      currentFileRowIdx === -1
        ? offset < 0
          ? fileRows[fileRows.length - 1]
          : fileRows[0]
        : fileRows[Math.max(0, Math.min(fileRows.length - 1, currentFileRowIdx + offset))]
    if (next) {
      setHighlighted(next.id)
      selectFileNode(next.id)
    }
  }

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
      const next = moveFileTreeSelection(rows(), highlighted(), 1)
      if (next !== undefined) {
        setHighlighted(next)
        selectFileNode(next)
      }
    }
    if (evt.name === "k" || evt.name === "up") {
      evt.preventDefault()
      const next = moveFileTreeSelection(rows(), highlighted(), -1)
      if (next !== undefined) {
        setHighlighted(next)
        selectFileNode(next)
      }
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      const cur = highlighted()
      const node = cur === undefined ? undefined : tree().nodes[cur]
      if (node?.kind === "directory" && !expanded().has(node.id)) {
        setExpanded((prev) => setFileTreeDirectoryExpanded(tree(), prev, cur, true))
        return
      }
      setHighlighted(moveFileTreeSelectionToFirstChild(rows(), cur))
    }
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      const cur = highlighted()
      const node = cur === undefined ? undefined : tree().nodes[cur]
      if (node?.kind === "directory" && expanded().has(node.id)) {
        setExpanded((prev) => setFileTreeDirectoryExpanded(tree(), prev, cur, false))
        return
      }
      setHighlighted(moveFileTreeSelectionToParent(rows(), cur))
    }
    if (evt.name === "space" || evt.name === "return") {
      evt.preventDefault()
      const cur = highlighted()
      const node = cur === undefined ? undefined : tree().nodes[cur]
      if (node?.kind === "directory") {
        setExpanded((prev) => toggleFileTreeDirectory(tree(), prev, cur))
        return
      }
      if (cur !== undefined) {
        selectFileNode(cur)
        if (evt.name === "return") props.onSwitch?.()
      }
    }
    if (evt.name === "n" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      moveToFile(1)
    }
    if (evt.name === "p" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      moveToFile(-1)
    }
    if (evt.name === "g" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      const first = rows().find((r) => r.fileIndex !== undefined)
      if (first) {
        setHighlighted(first.id)
        selectFileNode(first.id)
      }
    }
    if (evt.name === "G" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      const last = [...rows()].reverse().find((r) => r.fileIndex !== undefined)
      if (last) {
        setHighlighted(last.id)
        selectFileNode(last.id)
      }
    }
  })

  return (
    <box width={props.width} height="100%" border={["right"]} borderColor={theme.border.subtle}>
      <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1} scrollbarOptions={{ visible: false }}>
        <box gap={0}>
          <Show when={props.filterActive || props.filterText.length > 0}>
            <box flexDirection="row" gap={0} paddingBottom={1}>
              <text fg={theme.accent.fg}>{"/"}</text>
              <text fg={theme.foreground.default}>
                {props.filterActive ? `${props.filterText}▊` : props.filterText}
              </text>
            </box>
          </Show>
          <text fg={theme.foreground.default}>
            <b>Files</b>{" "}
            <span
              style={{ fg: theme.foreground.muted }}
            >{`(${filtered().length}${props.filterText ? `/${props.files.length}` : ""})`}</span>
          </text>
          <box height={1} />
          <Show
            when={rows().length > 0}
            fallback={<text fg={theme.foreground.muted}>{props.filterText ? "No matches" : "No files modified"}</text>}
          >
            <For each={rows()}>
              {(row) => {
                const indent = "  ".repeat(row.depth)
                const isHighlighted = () => highlighted() === row.id
                const file = () => (row.fileIndex !== undefined ? filtered()[row.fileIndex] : undefined)
                const reviewed = () => {
                  const f = file()
                  return f && props.reviewed?.has(f.file)
                }
                const commentCount = () => {
                  const f = file()
                  return f ? (props.comments.get(f.file) ?? 0) : 0
                }
                return (
                  <Show
                    when={row.kind === "directory"}
                    fallback={
                      <box
                        flexDirection="row"
                        gap={1}
                        justifyContent="space-between"
                        backgroundColor={isHighlighted() ? theme.surface.offset : undefined}
                        paddingLeft={0}
                        paddingRight={1}
                        onMouseDown={() => {
                          setHighlighted(row.id)
                          selectFileNode(row.id)
                        }}
                      >
                        <text
                          fg={reviewed() ? theme.foreground.muted : theme.foreground.default}
                          wrapMode="none"
                          flexShrink={1}
                        >
                          {`${indent}${row.name}`}
                        </text>
                        <box flexDirection="row" gap={1} flexShrink={0}>
                          <Show when={commentCount() > 0}>
                            <text fg={theme.accent.fg}>{`@${commentCount()}`}</text>
                          </Show>
                          <Show when={file()?.additions}>
                            <text fg={theme.diff.added}>{`+${file()!.additions}`}</text>
                          </Show>
                          <Show when={file()?.deletions}>
                            <text fg={theme.diff.removed}>{`-${file()!.deletions}`}</text>
                          </Show>
                        </box>
                      </box>
                    }
                  >
                    <box
                      flexDirection="row"
                      gap={0}
                      backgroundColor={isHighlighted() ? theme.surface.offset : undefined}
                      paddingLeft={0}
                      paddingRight={1}
                      onMouseDown={() => {
                        setHighlighted(row.id)
                        setExpanded((prev) => toggleFileTreeDirectory(tree(), prev, row.id))
                      }}
                    >
                      <text fg={theme.foreground.muted} wrapMode="none">
                        {`${indent}${expanded().has(row.id) ? "▾" : "▸"} ${row.name}/`}
                      </text>
                    </box>
                  </Show>
                )
              }}
            </For>
          </Show>
        </box>
      </scrollbox>
    </box>
  )
}

export function fileTreeFileOrder(files: Snapshot.FileDiff[]): Snapshot.FileDiff[] {
  // Stable order respecting tree structure (directories first, then files alphabetically).
  return files
    .map((file, index) => ({ file, index, directory: path.dirname(file.file), name: path.basename(file.file) }))
    .sort((a, b) => {
      if (a.directory === b.directory) return a.name.localeCompare(b.name)
      return a.directory.localeCompare(b.directory)
    })
    .map((item) => item.file)
}
