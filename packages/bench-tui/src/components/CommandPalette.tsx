import { For, Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { theme } from "../theme"
import { short, suiteStatusIcon, type SuiteFileState, type SuiteExecStatus } from "../types"

interface CommandPaletteProps {
  width: number
  height: number
  query: string
  cursor: number
  files: SuiteFileState[]
  runningFiles: Set<string>
  onSelectCursor: (i: number) => void
  onActivate: (file: SuiteFileState) => void
  onClose: () => void
}

function statusOf(file: SuiteFileState, running: Set<string>): SuiteExecStatus {
  if (running.has(file.filePath)) return "running"
  return file.lastRun?.status ?? "notrun"
}

function statusColor(s: SuiteExecStatus) {
  switch (s) {
    case "pass":
      return theme.success
    case "fail":
      return theme.error
    case "running":
      return theme.warning
    case "skip":
      return theme.textMuted
    case "todo":
      return theme.purple
    case "mixed":
      return theme.orange
    default:
      return theme.textMuted
  }
}

export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (t.includes(q)) return 100 + (t.length - q.length) * -0.1
  let qi = 0
  let score = 0
  let consecutive = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++
      consecutive++
      score += 1 + consecutive
    } else {
      consecutive = 0
    }
  }
  return qi === q.length ? score : 0
}

export function rankFiles(query: string, files: SuiteFileState[], limit = 30): SuiteFileState[] {
  const scored = files.map((f) => ({ file: f, score: fuzzyScore(query, f.relativePath) })).filter((x) => x.score > 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((x) => x.file)
}

export function CommandPalette(props: CommandPaletteProps) {
  const matches = createMemo(() => rankFiles(props.query, props.files))
  const w = Math.min(80, props.width - 4)
  const h = Math.min(props.height - 4, 22)

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={props.width}
      height={props.height}
      backgroundColor={theme.overlay}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      onMouseUp={props.onClose}
    >
      <box
        border
        borderColor={theme.borderFocus}
        backgroundColor={theme.surface}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
        width={w}
        height={h}
        onMouseUp={(event) => event.stopPropagation()}
      >
        <box flexDirection="row" gap={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="none">
            {">"}
          </text>
          <text fg={theme.text} wrapMode="none">
            {props.query}
          </text>
          <text fg={theme.accent} wrapMode="none" attributes={TextAttributes.BOLD}>
            _
          </text>
        </box>
        <text fg={theme.textMuted} wrapMode="none">
          {matches().length} match · ↑↓ select · ↵ run · esc close
        </text>
        <text fg={theme.border} wrapMode="none">
          {"─".repeat(Math.max(0, w - 4))}
        </text>
        <Show when={matches().length > 0} fallback={<text fg={theme.textMuted}>No test files match.</text>}>
          <For each={matches().slice(0, h - 5)}>
            {(file, i) => {
              const isSel = i() === props.cursor
              const st = statusOf(file, props.runningFiles)
              const fg = isSel ? theme.bg : statusColor(st)
              const bg = isSel ? theme.accent : undefined
              return (
                <text
                  fg={fg}
                  bg={bg}
                  wrapMode="none"
                  attributes={isSel ? TextAttributes.BOLD : TextAttributes.NONE}
                  onMouseOver={() => props.onSelectCursor(i())}
                  onMouseUp={() => props.onActivate(file)}
                >
                  {isSel ? "▸ " : "  "}
                  {suiteStatusIcon(st)} {short(file.relativePath, w - 8)}
                </text>
              )
            }}
          </For>
        </Show>
      </box>
    </box>
  )
}
