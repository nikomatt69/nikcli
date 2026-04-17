import { decodePasteBytes, TextAttributes, type KeyEvent, type MouseEvent as OpenTuiMouseEvent, type Renderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import type { BrowserKeyboardEvent, BrowserMouseEvent, TerminalLine } from "../types"
import type { TerminalBrowserController } from "./controller"

export type TerminalBrowserRenderableProps = {
  controller: TerminalBrowserController
  focused: boolean
  width: number
  height: number
  backgroundColor?: string
  emptyLabel?: string
  onActivate?: () => void
}

function localPoint(event: OpenTuiMouseEvent, node?: Renderable) {
  const x = Math.max(0, event.x - (node?.x ?? 0))
  const y = Math.max(0, event.y - (node?.y ?? 0))
  return { column: x, row: y }
}

function keyToBrowserEvent(event: KeyEvent): BrowserKeyboardEvent | null {
  if (event.name === "escape") return null
  if (event.ctrl || event.meta) {
    const key = event.name || event.sequence
    if (!key) return null
    return { key, ctrl: event.ctrl, meta: event.meta, alt: event.option, shift: event.shift }
  }

  const text = event.sequence?.length === 1 ? event.sequence : undefined
  if (text) {
    return {
      key: text,
      text,
      shift: event.shift,
      alt: event.option,
      ctrl: event.ctrl,
      meta: event.meta,
    }
  }

  const key = event.name || event.sequence
  if (!key) return null
  return {
    key,
    shift: event.shift,
    alt: event.option,
    ctrl: event.ctrl,
    meta: event.meta,
  }
}

function mouseButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle"
  if (button === 2) return "right"
  return "left"
}

function padLines(lines: TerminalLine[], width: number, height: number) {
  const output = lines.slice(0, height).map((line) => line)
  while (output.length < height) {
    output.push({ segments: [{ text: " ".repeat(width), fg: "#ffffff", bg: "#000000" }] })
  }
  return output
}

export function TerminalBrowserRenderable(props: TerminalBrowserRenderableProps) {
  const [snapshot, setSnapshot] = createSignal(props.controller.getSnapshot())
  let viewportNode: Renderable | undefined

  const lines = createMemo(() => padLines(snapshot().lines, props.width, props.height))

  createEffect(() => {
    void props.controller.setViewport({ columns: props.width, rows: props.height })
  })

  const unsubscribe = props.controller.subscribe((next) => setSnapshot(next))
  onCleanup(() => unsubscribe())

  useKeyboard((event) => {
    if (!props.focused) return
    const mapped = keyToBrowserEvent(event)
    if (!mapped) return
    void props.controller.sendKeyboard(mapped)
    event.preventDefault()
    event.stopPropagation()
  })

  function sendMouse(event: BrowserMouseEvent) {
    props.onActivate?.()
    void props.controller.sendMouse(event)
  }

  return (
    <box
      ref={(value: Renderable) => {
        viewportNode = value
      }}
      focusable
      focused={props.focused}
      width={props.width}
      height={props.height}
      backgroundColor={props.backgroundColor}
      onMouseDown={(event) => {
        const point = localPoint(event, viewportNode)
        sendMouse({ type: "down", button: mouseButton(event.button), ...point })
      }}
      onMouseUp={(event) => {
        const point = localPoint(event, viewportNode)
        sendMouse({ type: "up", button: mouseButton(event.button), ...point })
      }}
      onMouseMove={(event) => {
        const point = localPoint(event, viewportNode)
        sendMouse({ type: "move", ...point })
      }}
      onMouseScroll={(event) => {
        const point = localPoint(event, viewportNode)
        const deltaX = event.scroll?.direction === "left" ? -40 : event.scroll?.direction === "right" ? 40 : 0
        const deltaY = event.scroll?.direction === "up" ? -80 : event.scroll?.direction === "down" ? 80 : 0
        sendMouse({ type: "scroll", deltaX, deltaY, ...point })
      }}
      onPaste={(event) => {
        if (!props.focused) return
        const text = decodePasteBytes(event.bytes)
        if (!text) return
        for (const char of text) {
          void props.controller.sendKeyboard({ key: char, text: char })
        }
        event.preventDefault()
      }}
    >
      <box flexDirection="column" backgroundColor={props.backgroundColor} width={props.width} height={props.height}>
        <For each={lines()}>
          {(line) => (
            <text wrapMode="none">
              <For each={line.segments}>
                {(segment) => (
                  <span fg={segment.fg} bg={segment.bg}>
                    {segment.text}
                  </span>
                )}
              </For>
            </text>
          )}
        </For>
      </box>
      <box position="absolute" right={1} top={0}>
        <text fg={snapshot().loading ? "#7dd3fc" : snapshot().error ? "#f87171" : "#94a3b8"} attributes={TextAttributes.BOLD}>
          {snapshot().loading ? "loading" : snapshot().error ? "error" : "live"}
        </text>
      </box>
    </box>
  )
}
