import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useTelemetry, type TelemetryRecord } from "../context/telemetry"

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function DialogTelemetryLive() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const telemetry = useTelemetry()
  const dimensions = useTerminalDimensions()

  // Explicit height so the whole panel (header + list + footer) always fits on
  // screen. The dialog chrome (padding, header, footer, gaps) is ~8 rows.
  const listHeight = createMemo(() => Math.max(3, dimensions().height - 9))

  // Background-recorded spans (accumulated since app start), so the full
  // conversation history is shown the moment the panel opens.
  const records = telemetry.records
  const [follow, setFollow] = createSignal(true)
  const [errorsOnly, setErrorsOnly] = createSignal(false)

  let scroll: ScrollBoxRenderable | undefined
  const scrollToBottom = () => {
    if (follow() && scroll && !scroll.isDestroyed) scroll.scrollTo(scroll.scrollHeight)
  }

  onMount(() => {
    dialog.setSize("xlarge")
    // Jump to the latest span (newest history) on open, then keep following.
    setTimeout(scrollToBottom, 0)
  })

  const colorFor = (record: TelemetryRecord) => {
    if (record.statusCode === 2) return theme.error
    if (record.durationMs >= 1000) return theme.warning
    return theme.text
  }

  const visible = createMemo(() => {
    const all = records()
    return errorsOnly() ? all.filter((r) => r.statusCode === 2) : all
  })

  // Follow new spans as they arrive in the background.
  createEffect(
    on(
      () => records().length,
      () => setTimeout(scrollToBottom, 0),
    ),
  )

  useKeyboard((evt) => {
    if (evt.name === "f") {
      evt.preventDefault()
      setFollow((v) => !v)
      setTimeout(scrollToBottom, 0)
      return
    }
    if (evt.name === "e") {
      evt.preventDefault()
      setErrorsOnly((v) => !v)
      setTimeout(scrollToBottom, 0)
      return
    }
    if (evt.name === "c") {
      evt.preventDefault()
      telemetry.clear()
    }
  })

  return (
    <box gap={1}>
      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2}>
        <box flexDirection="row" gap={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Live telemetry
          </text>
          <text fg={theme.textMuted}>spans</text>
        </box>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <scrollbox
        height={listHeight()}
        backgroundColor={theme.backgroundElement}
        ref={(r: ScrollBoxRenderable) => {
          scroll = r
        }}
      >
        <For each={visible()}>
          {(record) => (
            <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={2}>
              <box width={9} flexShrink={0}>
                <text fg={theme.textMuted} wrapMode="none">
                  {formatDuration(record.durationMs)}
                </text>
              </box>
              <box minWidth={0} flexShrink={1}>
                <text fg={colorFor(record)} wrapMode="none">
                  {record.name}
                  {record.statusCode === 2 && record.statusMessage ? ` — ${record.statusMessage}` : ""}
                </text>
              </box>
            </box>
          )}
        </For>
      </scrollbox>

      <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text fg={theme.textMuted}>
          {visible().length} spans{errorsOnly() ? " · errors only" : ""} · {follow() ? "following" : "paused"}
        </text>
        <text fg={theme.textMuted}>f follow · e errors · c clear · esc close</text>
      </box>
    </box>
  )
}
