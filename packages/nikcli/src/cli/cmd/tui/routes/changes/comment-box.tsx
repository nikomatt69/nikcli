import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"

export type LineType = "add" | "remove" | "context"
export type CommentType = "bug" | "style" | "question" | "suggestion"

export const COMMENT_TYPES: { type: CommentType; label: string; key: string }[] = [
  { type: "bug", label: "Bug", key: "1" },
  { type: "style", label: "Style", key: "2" },
  { type: "question", label: "Question", key: "3" },
  { type: "suggestion", label: "Suggestion", key: "4" },
]

const COMMENT_TYPE_ORDER: CommentType[] = COMMENT_TYPES.map((c) => c.type)

export type DiffRow = {
  visualLine: number
  oldLine?: number
  newLine?: number
  lineType: LineType
  anchor: string
  label: string
  text: string
}

export interface Comment {
  id: string
  line: number
  anchor: string
  lineType: LineType
  label: string
  text: string
  type: CommentType
}

function borderColor(theme: ReturnType<typeof useTheme>["theme"], lineType: LineType | undefined) {
  if (lineType === "add") return theme.diff.highlightAdded
  if (lineType === "remove") return theme.diff.highlightRemoved
  return theme.accent.fg
}

function typeColor(theme: ReturnType<typeof useTheme>["theme"], type: CommentType) {
  if (type === "bug") return theme.status.error.fg
  if (type === "style") return theme.status.info.fg
  if (type === "question") return theme.status.warning.fg
  return theme.accent.fg
}

export function makeKey(anchor: string) {
  return anchor
}

export function lineLabel(row: Pick<DiffRow, "oldLine" | "newLine" | "lineType" | "label">) {
  if (row.lineType === "add" && row.newLine !== undefined) return `new line ${row.newLine}`
  if (row.lineType === "remove" && row.oldLine !== undefined) return `old line ${row.oldLine}`
  return row.label
}

export function CommentInput(props: {
  row: DiffRow
  initialValue?: string
  initialType?: CommentType
  onSubmit: (text: string, type: CommentType) => void
  onCancel: () => void
}) {
  let input: TextareaRenderable | undefined
  const { theme } = useTheme()
  const color = createMemo(() => borderColor(theme, props.row.lineType))

  const [phase, setPhase] = createSignal<"type" | "text">(props.initialValue !== undefined ? "text" : "type")
  const [commentType, setCommentType] = createSignal<CommentType>(props.initialType ?? "suggestion")
  const [submitting, setSubmitting] = createSignal(false)

  function cycleCommentType(delta: 1 | -1) {
    const order = COMMENT_TYPE_ORDER
    const i = order.indexOf(commentType())
    const idx = i === -1 ? 0 : (i + delta + order.length) % order.length
    setCommentType(order[idx]!)
  }

  createEffect(() => {
    if (phase() !== "text") return
    setTimeout(() => {
      if (!input || input.isDestroyed) return
      input.focus()
      input.gotoBufferEnd()
    }, 0)
  })

  let submitOnce = false
  function submit() {
    if (submitOnce || submitting()) return
    const text = input?.plainText?.trim() ?? ""
    if (!text) {
      props.onCancel()
      return
    }
    submitOnce = true
    setSubmitting(true)
    input?.blur()
    props.onSubmit(text, commentType())
  }

  useKeyboard((evt) => {
    if (phase() === "type") {
      if (evt.name === "left" || evt.name === "up") {
        evt.preventDefault()
        cycleCommentType(-1)
        return
      }
      if (evt.name === "right" || evt.name === "down") {
        evt.preventDefault()
        cycleCommentType(1)
        return
      }
      if (evt.name === "tab") {
        evt.preventDefault()
        cycleCommentType(evt.shift ? -1 : 1)
        return
      }
      if (evt.name === "1") {
        evt.preventDefault()
        setCommentType("bug")
        return
      }
      if (evt.name === "2") {
        evt.preventDefault()
        setCommentType("style")
        return
      }
      if (evt.name === "3") {
        evt.preventDefault()
        setCommentType("question")
        return
      }
      if (evt.name === "4") {
        evt.preventDefault()
        setCommentType("suggestion")
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        setPhase("text")
        return
      }
      if (evt.name === "escape") {
        evt.preventDefault()
        props.onCancel()
        return
      }
      return
    }
    if (phase() === "text") {
      // TTYs often make ctrl+return indistinguishable from return (no modifier). ctrl/cmd+s
      // is sent as a real chord and is handled here + in textarea keyBindings.
      if (evt.name === "s" && (evt.ctrl || evt.super)) {
        evt.preventDefault()
        submit()
        return
      }
      // When the Kitty keyboard protocol (useKittyKeyboard) reports modifiers, these work.
      if ((evt.ctrl || evt.super) && (evt.name === "return" || evt.name === "enter")) {
        evt.preventDefault()
        submit()
        return
      }
      // ctrl+1-4 to change type without leaving the textarea
      if (evt.ctrl && evt.name === "1") {
        evt.preventDefault()
        setCommentType("bug")
        return
      }
      if (evt.ctrl && evt.name === "2") {
        evt.preventDefault()
        setCommentType("style")
        return
      }
      if (evt.ctrl && evt.name === "3") {
        evt.preventDefault()
        setCommentType("question")
        return
      }
      if (evt.ctrl && evt.name === "4") {
        evt.preventDefault()
        setCommentType("suggestion")
        return
      }
      if (evt.name === "escape") {
        evt.preventDefault()
        input?.blur()
        props.onCancel()
      }
    }
  })

  return (
    <box
      backgroundColor={theme.surface.panel}
      border={["left"]}
      borderColor={color()}
      customBorderChars={SplitBorder.customBorderChars}
      width="100%"
    >
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.foreground.default}>Comment on {lineLabel(props.row)}</text>
      </box>

      <Show when={phase() === "type"}>
        <box paddingLeft={2} paddingBottom={1} gap={1}>
          <text fg={theme.foreground.muted} wrapMode="word">
            Pick type | 1-4 | ←/→ or tab | enter to write
          </text>
          <box flexDirection="row" gap={1}>
            <For each={COMMENT_TYPES}>
              {(item) => (
                <box
                  backgroundColor={commentType() === item.type ? typeColor(theme, item.type) : theme.surface.offset}
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseDown={() => {
                    setCommentType(item.type)
                    setPhase("text")
                  }}
                >
                  <text fg={commentType() === item.type ? theme.surface.base : theme.foreground.muted}>
                    {item.key} {item.label}
                  </text>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>

      <Show when={phase() === "text"}>
        <box paddingLeft={2} paddingBottom={1} flexDirection="row" gap={2} alignItems="center">
          <box backgroundColor={typeColor(theme, commentType())} paddingLeft={1} paddingRight={1}>
            <text fg={theme.surface.base}>{commentType()}</text>
          </box>
          <text fg={theme.foreground.muted}>ctrl+1-4 change type</text>
        </box>
        <box
          paddingLeft={2}
          paddingRight={3}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.surface.offset}
        >
          <textarea
            ref={(val: TextareaRenderable) => (input = val)}
            focused={phase() === "text" && !submitting()}
            height={4}
            initialValue={props.initialValue}
            placeholder="Write feedback for this line"
            textColor={theme.foreground.default}
            focusedTextColor={theme.foreground.default}
            cursorColor={theme.accent.fg}
            keyBindings={[
              { name: "s", ctrl: true, action: "submit" },
              { name: "s", super: true, action: "submit" },
              { name: "return", ctrl: true, action: "submit" },
              { name: "enter", ctrl: true, action: "submit" },
              { name: "return", super: true, action: "submit" },
              { name: "enter", super: true, action: "submit" },
              { name: "return", meta: true, action: "newline" },
              { name: "enter", meta: true, action: "newline" },
            ]}
            onMouseDown={(evt) => {
              evt.preventDefault()
              evt.target?.focus()
            }}
            onSubmit={submit}
          />
        </box>
        <box flexDirection="row" gap={2} paddingLeft={2} paddingBottom={1} flexWrap="wrap">
          <text fg={theme.foreground.default}>
            {process.platform === "darwin" ? "ctrl+s" : "ctrl+s"} <span style={{ fg: theme.foreground.muted }}>save</span>
          </text>
          <text fg={theme.foreground.muted} wrapMode="word">
            ({process.platform === "darwin" ? "cmd" : "ctrl"}+enter if terminal supports)
          </text>
          <text fg={theme.foreground.default}>
            opt+enter <span style={{ fg: theme.foreground.muted }}>newline</span>
          </text>
          <text fg={theme.foreground.default}>
            esc <span style={{ fg: theme.foreground.muted }}>cancel</span>
          </text>
        </box>
      </Show>
    </box>
  )
}

export function CommentDisplay(props: {
  comment: Comment
  focused: boolean
  onEdit: () => void
  onDelete: () => void
  onFocus: () => void
}) {
  const { theme } = useTheme()
  const color = createMemo(() => borderColor(theme, props.comment.lineType))
  const tColor = createMemo(() => typeColor(theme, props.comment.type ?? "suggestion"))

  useKeyboard((evt) => {
    if (!props.focused) return
    if (evt.name === "e" || evt.name === "return") {
      evt.preventDefault()
      props.onEdit()
      return
    }
    if (evt.name === "d") {
      evt.preventDefault()
      props.onDelete()
    }
  })

  return (
    <box
      backgroundColor={props.focused ? theme.surface.offset : theme.surface.panel}
      border={["left"]}
      borderColor={color()}
      customBorderChars={SplitBorder.customBorderChars}
      width="100%"
      onMouseDown={props.onFocus}
    >
      <box paddingLeft={2} paddingTop={1} paddingBottom={1} flexDirection="row" gap={2} alignItems="center">
        <text fg={theme.foreground.default}>{props.comment.label}</text>
        <box backgroundColor={tColor()} paddingLeft={1} paddingRight={1}>
          <text fg={theme.surface.base}>{props.comment.type ?? "suggestion"}</text>
        </box>
      </box>
      <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text fg={theme.foreground.default} wrapMode="word">
          {props.comment.text}
        </text>
      </box>
      <Show when={props.focused}>
        <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <box backgroundColor={theme.accent.fg} paddingLeft={1} paddingRight={1} onMouseDown={props.onEdit}>
            <text fg={theme.surface.base}>Edit (e)</text>
          </box>
          <box backgroundColor={theme.status.error.fg} paddingLeft={1} paddingRight={1} onMouseDown={props.onDelete}>
            <text fg={theme.surface.base}>Delete (d)</text>
          </box>
        </box>
      </Show>
    </box>
  )
}
