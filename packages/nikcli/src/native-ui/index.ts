import { EventEmitter } from "events"
import { SurfaceSchema, SurfaceEventSchema, type Surface, type SurfaceEvent } from "@nikcli-ai/native-ui-protocol"

const MAX_SURFACES = 100

export namespace NativeUI {
  const surfaces = new Map<string, Surface>()
  const events = new EventEmitter()
  const history: SurfaceEvent[] = []

  export function list(): Surface[] {
    return [...surfaces.values()]
  }

  export function get(id: string): Surface | undefined {
    return surfaces.get(id)
  }

  export function open(input: Surface): Surface {
    const surface = SurfaceSchema.parse(input)
    if (!surfaces.has(surface.id) && surfaces.size >= MAX_SURFACES) {
      throw new Error(`Native UI surface limit reached (${MAX_SURFACES})`)
    }
    forget(surface.id)
    surfaces.set(surface.id, surface)
    emit({ type: "surface-opened", surface })
    return surface
  }

  export function update(input: Surface): Surface {
    const surface = SurfaceSchema.parse(input)
    if (!surfaces.has(surface.id)) throw new Error(`Native UI surface not found: ${surface.id}`)
    surfaces.set(surface.id, surface)
    emit({ type: "surface-updated", surface })
    return surface
  }

  export function close(id: string, reason: "dismissed" | "action" | "replaced" | "system" = "system"): boolean {
    if (!surfaces.delete(id)) return false
    emit({ type: "surface-closed", surfaceId: id, reason })
    return true
  }

  export function closeAll(): void {
    for (const id of surfaces.keys()) close(id, "system")
    history.length = 0
  }

  export function subscribe(listener: (event: SurfaceEvent) => void): () => void {
    events.on("surface", listener)
    return () => events.off("surface", listener)
  }

  export function dispatch(input: SurfaceEvent): SurfaceEvent {
    const event = SurfaceEventSchema.parse(input)
    if (event.type === "surface-closed") {
      surfaces.delete(event.surfaceId)
    } else if (event.type === "control-changed") {
      updateControl(event.surfaceId, event.controlId, event.value)
    } else if (event.type === "control-activated") {
      if (event.action.type === "dismiss-surface") {
        surfaces.delete(event.action.surfaceId)
      } else if (event.action.type === "update-control") {
        updateControl(event.action.surfaceId, event.action.controlId, event.action.value)
      }
    }
    emit(event)
    return event
  }

  export function wait(
    predicate: (event: SurfaceEvent) => boolean,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<SurfaceEvent> {
    const timeoutMs = options.timeoutMs ?? 120_000
    const existing = history.findLast(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const unsubscribe = subscribe((event) => {
        if (!predicate(event)) return
        cleanup()
        resolve(event)
      })
      const onAbort = () => {
        cleanup()
        reject(new DOMException("Native UI wait aborted", "AbortError"))
      }
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        unsubscribe()
        options.signal?.removeEventListener("abort", onAbort)
      }
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          cleanup()
          reject(new Error(`Timed out waiting for native UI event after ${timeoutMs}ms`))
        }, timeoutMs)
      }
      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  function emit(event: SurfaceEvent): void {
    history.push(event)
    if (history.length > 500) history.shift()
    events.emit("surface", event)
  }

  function forget(surfaceID: string): void {
    for (let index = history.length - 1; index >= 0; index--) {
      const event = history[index]
      if (!event) continue
      const id =
        event.type === "surface-opened" || event.type === "surface-updated" ? event.surface.id : event.surfaceId
      if (id === surfaceID) history.splice(index, 1)
    }
  }

  function updateControl(surfaceID: string, controlID: string, value: unknown): void {
    const current = surfaces.get(surfaceID)
    if (!current) return
    const controls = current.controls.map((control) => {
      if (control.id !== controlID) return control
      if (control.type === "text-input" && typeof value === "string") return { ...control, value }
      if (
        control.type === "select" &&
        typeof value === "string" &&
        control.options.some((option) => option.id === value)
      )
        return { ...control, value }
      if (control.type === "checkbox" && typeof value === "boolean") return { ...control, checked: value }
      if (control.type === "progress" && typeof value === "number" && value >= 0 && value <= 1)
        return { ...control, value }
      return control
    })
    surfaces.set(surfaceID, SurfaceSchema.parse({ ...current, controls }))
  }
}
