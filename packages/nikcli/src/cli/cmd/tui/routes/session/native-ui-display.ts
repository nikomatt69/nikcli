import {
  SurfaceEventSchema,
  SurfaceSchema,
  type Control,
  type Surface,
  type SurfaceEvent,
} from "@nikcli-ai/native-ui-protocol"

export function nativeUISurface(value: unknown): Surface | undefined {
  const result = SurfaceSchema.safeParse(value)
  return result.success ? result.data : undefined
}

export function nativeUISurfaces(value: unknown): Surface[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const surface = nativeUISurface(item)
    return surface ? [surface] : []
  })
}

export function nativeUIEvent(value: unknown): SurfaceEvent | undefined {
  const result = SurfaceEventSchema.safeParse(value)
  return result.success ? result.data : undefined
}

export function nativeUIKindIcon(kind: Surface["kind"]): string {
  if (kind === "dialog") return "▣"
  if (kind === "popover") return "▱"
  if (kind === "notification") return "●"
  return "≡"
}

export function nativeUIEventLabel(event: SurfaceEvent): string {
  if (event.type === "surface-closed") return "Surface closed"
  if (event.type === "control-changed") return "Value changed"
  if (event.type === "control-activated") return "Action received"
  if (event.type === "surface-opened") return "Surface opened"
  return "Surface updated"
}

export function nativeUIPendingLabel(operation: string): string {
  if (operation === "wait") return "Waiting for native UI interaction..."
  if (operation === "list") return "Reading native UI surfaces..."
  if (operation === "open") return "Opening native UI..."
  if (operation === "update") return "Updating native UI..."
  if (operation === "close") return "Closing native UI..."
  return "Working with native UI..."
}

export function nativeUIControlLabel(control: Control): string {
  if (control.type === "button")
    return `${control.destructive ? "!" : "["} ${control.label}${control.destructive ? "" : " ]"}`
  if (control.type === "link") return `↗ ${control.label}`
  if (control.type === "text-input") {
    const label = control.label ?? control.placeholder ?? "Text input"
    return `⌨ ${label}${control.required ? " *" : ""}`
  }
  if (control.type === "select") {
    const selected = control.options.find((option) => option.id === control.value)?.label
    return `◆ ${control.label}${selected ? ` · ${selected}` : ""}`
  }
  if (control.type === "checkbox") return `${control.checked ? "[x]" : "[ ]"} ${control.label}`
  if (control.type === "progress") {
    const label = control.label ? `${control.label} · ` : ""
    const detail = control.detail ? ` · ${control.detail}` : ""
    if (control.indeterminate) return `············ ${label}in progress${detail}`
    const width = 12
    const complete = Math.round(control.value * width)
    const bar = `${"━".repeat(complete)}${"─".repeat(width - complete)}`
    return `${bar} ${label}${Math.round(control.value * 100)}%${detail}`
  }
  if (control.type === "metric") {
    const icon =
      control.tone === "success"
        ? "✓"
        : control.tone === "warning"
          ? "!"
          : control.tone === "error"
            ? "×"
            : control.tone === "info"
              ? "◆"
              : "◇"
    const trend = control.trend ? ` ${control.trend}` : ""
    const detail = control.detail ? ` · ${control.detail}` : ""
    return `${icon} ${control.label}  ${control.value}${trend}${detail}`
  }
  if (control.type === "section") return `— ${control.label}${control.detail ? ` · ${control.detail}` : ""}`
  return "────────"
}

export function nativeUIValue(value: unknown): string {
  if (typeof value === "string") return "value updated"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === null) return "null"
  return "updated"
}
