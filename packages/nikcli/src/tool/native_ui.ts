import { z } from "zod"
import { NativeUI } from "../native-ui"
import { Tool } from "./tool"
import { ControlSchema, type SurfaceEvent } from "@nikcli-ai/native-ui-protocol"
import DESCRIPTION from "./native_ui.txt"

const Parameters = z.object({
  operation: z.enum(["open", "update", "wait", "close", "list"]),
  surfaceID: z.string().min(1).optional(),
  kind: z.enum(["dialog", "popover", "notification", "menu"]).optional(),
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  controls: z.array(ControlSchema).max(20).optional(),
  dismissible: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
  durationMs: z.number().int().nonnegative().max(86_400_000).optional(),
  severity: z.enum(["info", "success", "warning", "error"]).optional(),
  anchor: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    })
    .optional(),
  placement: z.enum(["top", "right", "bottom", "left"]).optional(),
  width: z.enum(["small", "medium", "large"]).optional(),
  layout: z.enum(["stack", "dashboard"]).optional(),
})

export const NativeUITool = Tool.define("native_ui", {
  description: DESCRIPTION,
  parameters: Parameters,
  async execute(params, ctx) {
    if (params.operation === "list") {
      const surfaces = NativeUI.list()
      return {
        title: "Listed native UI surfaces",
        output: JSON.stringify(surfaces),
        metadata: { surfaces } as Record<string, unknown>,
      }
    }

    if (!params.surfaceID && params.operation !== "open") {
      throw new Error("surfaceID is required for update, wait, and close")
    }

    if (params.operation === "close") {
      const closed = NativeUI.close(params.surfaceID!, "system")
      return {
        title: closed ? "Closed native UI surface" : "Native UI surface already closed",
        output: closed ? `Closed ${params.surfaceID}` : `No active surface named ${params.surfaceID}`,
        metadata: { surfaceID: params.surfaceID, closed } as Record<string, unknown>,
      }
    }

    if (params.operation === "wait") {
      const predicate = (event: SurfaceEvent) => {
        if (event.type === "surface-closed") return event.surfaceId === params.surfaceID
        if (event.type === "control-activated") return event.surfaceId === params.surfaceID
        return event.type === "control-changed" && event.surfaceId === params.surfaceID
      }
      if (!NativeUI.get(params.surfaceID!) && !NativeUI.peek(predicate)) {
        throw new Error(
          `Native UI surface not found: ${params.surfaceID}. Open a surface before waiting on its events.`,
        )
      }
      const event = await NativeUI.wait(predicate, { timeoutMs: params.timeoutMs, signal: ctx.abort })
      return {
        title: "Native UI interaction received",
        output: JSON.stringify(event),
        metadata: { surfaceID: params.surfaceID, event } as Record<string, unknown>,
      }
    }

    if (params.operation === "update") {
      const current = NativeUI.get(params.surfaceID!)
      if (!current) throw new Error(`Native UI surface not found: ${params.surfaceID}`)
      const common = {
        ...current,
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.body !== undefined ? { body: params.body } : {}),
        ...(params.controls !== undefined ? { controls: params.controls } : {}),
        ...(params.dismissible !== undefined ? { dismissible: params.dismissible } : {}),
      }
      const surface = NativeUI.update(
        current.kind === "menu"
          ? {
              ...common,
              kind: current.kind,
              items: params.controls !== undefined ? menuItems(params.controls) : current.items,
            }
          : current.kind === "notification"
            ? {
                ...common,
                kind: current.kind,
                severity: params.severity ?? current.severity,
                durationMs: params.durationMs ?? current.durationMs,
              }
            : current.kind === "popover"
              ? {
                  ...common,
                  kind: current.kind,
                  anchor: params.anchor ?? current.anchor,
                  placement: params.placement ?? current.placement,
                }
              : {
                  ...common,
                  kind: current.kind,
                  modal: current.modal,
                  width: params.width ?? current.width,
                  layout: params.layout ?? current.layout,
                },
      )
      return {
        title: "Updated native UI surface",
        output: `Updated ${surface.kind} ${surface.id}`,
        metadata: { surface } as Record<string, unknown>,
      }
    }

    const kind = params.kind ?? "popover"
    const surfaceID = params.surfaceID ?? `nikcli-${crypto.randomUUID()}`
    const common = {
      id: surfaceID,
      title: params.title ?? "Nikcli",
      body: params.body,
      controls: params.controls ?? [],
      dismissible: params.dismissible ?? true,
      metadata: {
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        agent: ctx.agent,
        callID: ctx.callID,
        cwd: process.cwd(),
      },
    }
    const surface = NativeUI.open(
      kind === "dialog"
        ? {
            ...common,
            kind,
            modal: true,
            width: params.width ?? (params.layout === "dashboard" ? "large" : "medium"),
            layout: params.layout ?? "stack",
          }
        : kind === "notification"
          ? {
              ...common,
              kind,
              severity: params.severity ?? "info",
              durationMs: params.durationMs,
            }
          : kind === "menu"
            ? {
                ...common,
                kind,
                items: menuItems(params.controls ?? []),
              }
            : {
                ...common,
                kind,
                anchor: params.anchor ?? { x: 0, y: 0, width: 0, height: 0 },
                placement: params.placement ?? "bottom",
              },
    )
    return {
      title: `Opened native ${surface.kind}`,
      output: `Opened ${surface.kind} ${surface.id}. Use native_ui with operation=wait to observe the user's action.`,
      metadata: { surface } as Record<string, unknown>,
    }
  },
})

function menuItems(controls: z.infer<typeof ControlSchema>[]) {
  const items = controls
    .filter((control) => control.type === "button")
    .map((control) => ({
      id: control.id,
      label: control.label,
      action: control.action,
      disabled: control.disabled,
    }))
  if (items.length === 0) {
    throw new Error("Menu surfaces need at least one button control; each button becomes a menu item.")
  }
  return items
}
