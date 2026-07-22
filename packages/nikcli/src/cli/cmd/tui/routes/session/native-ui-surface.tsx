import { For, Show } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { Surface } from "@nikcli-ai/native-ui-protocol"
import { Locale } from "@/util/locale"
import { nativeUIControlLabel, nativeUIKindIcon } from "./native-ui-display"

export function NativeUISurfaceContent(props: {
  surface: Surface
  textColor: RGBA
  mutedColor: RGBA
  accentColor: RGBA
  compact?: boolean
}) {
  const detail = () => {
    const surface = props.surface
    if (surface.kind === "dialog")
      return `${surface.layout ?? "stack"} · ${surface.width} · ${surface.modal ? "modal" : "modeless"}`
    if (surface.kind === "popover") return `${surface.placement} placement`
    if (surface.kind === "notification") {
      const duration = surface.durationMs === undefined ? "persistent" : Locale.duration(surface.durationMs)
      return `${surface.severity} · ${duration}`
    }
    return `${surface.items.length} item${surface.items.length === 1 ? "" : "s"}`
  }

  return (
    <box flexDirection="column" gap={props.compact ? 0 : 1}>
      <text fg={props.textColor}>
        <span style={{ fg: props.accentColor }}>{nativeUIKindIcon(props.surface.kind)}</span> {props.surface.title}
        <span style={{ fg: props.mutedColor }}> · {detail()}</span>
      </text>
      <Show when={!props.compact && props.surface.body}>{(body) => <text fg={props.mutedColor}>{body()}</text>}</Show>
      <Show when={!props.compact && props.surface.controls.length > 0}>
        <box flexDirection="column">
          <For each={props.surface.controls}>
            {(control) => (
              <text fg={"disabled" in control && control.disabled ? props.mutedColor : props.textColor}>
                {nativeUIControlLabel(control)}
              </text>
            )}
          </For>
        </box>
      </Show>
      <Show when={!props.compact && props.surface.kind === "menu"}>
        <box flexDirection="column">
          <For each={props.surface.kind === "menu" ? props.surface.items : []}>
            {(item) => (
              <text fg={item.disabled ? props.mutedColor : props.textColor}>
                {item.checked === true ? "[x]" : item.checked === false ? "[ ]" : "›"} {item.label}
              </text>
            )}
          </For>
        </box>
      </Show>
      <text fg={props.mutedColor}>ID {props.surface.id}</text>
    </box>
  )
}
