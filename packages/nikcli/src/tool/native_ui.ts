import { z } from "zod"
import { NativeUI } from "../native-ui"
import { Tool } from "./tool"
import { ControlSchema } from "@nikcli-ai/native-ui-protocol"

const Parameters = z.object({
  operation: z.enum(["open", "update", "wait", "close", "list"]),
  surfaceID: z.string().min(1).optional(),
  kind: z.enum(["dialog", "popover", "notification", "menu"]).optional(),
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  controls: z.array(ControlSchema).max(20).optional(),
  dismissible: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(86_400_000).optional(),
})

export const NativeUITool = Tool.define("native_ui", {
  description:
    "Create and control real-time native OS UI for the current task. Use this for meaningful progress, review, confirmation, permission, or completion moments. Prefer one live popover for ongoing work and a native dialog only when the user must decide. The UI is bound to this session and agent; never put secrets in a notification.",
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
      const closed = NativeUI.close(params.surfaceID!, "action")
      return {
        title: closed ? "Closed native UI surface" : "Native UI surface already closed",
        output: closed ? `Closed ${params.surfaceID}` : `No active surface named ${params.surfaceID}`,
        metadata: { surfaceID: params.surfaceID, closed } as Record<string, unknown>,
      }
    }

    if (params.operation === "wait") {
      const event = await NativeUI.wait(
        (event) => {
          if (event.type === "surface-closed") return event.surfaceId === params.surfaceID
          if (event.type === "control-activated") return event.surfaceId === params.surfaceID
          return event.type === "control-changed" && event.surfaceId === params.surfaceID
        },
        { timeoutMs: params.timeoutMs, signal: ctx.abort },
      )
      return {
        title: "Native UI interaction received",
        output: JSON.stringify(event),
        metadata: { surfaceID: params.surfaceID, event } as Record<string, unknown>,
      }
    }

    if (params.operation === "update") {
      const current = NativeUI.get(params.surfaceID!)
      if (!current) throw new Error(`Native UI surface not found: ${params.surfaceID}`)
      const surface = NativeUI.update({
        ...current,
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.body !== undefined ? { body: params.body } : {}),
        ...(params.controls !== undefined ? { controls: params.controls } : {}),
        ...(params.dismissible !== undefined ? { dismissible: params.dismissible } : {}),
      })
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
        ? { ...common, kind, modal: true, width: "medium" }
        : kind === "notification"
          ? {
              ...common,
              kind,
              severity: "info",
              durationMs: params.timeoutMs,
            }
          : kind === "menu"
            ? {
                ...common,
                kind,
                items: (params.controls ?? [])
                  .filter((control) => control.type === "button")
                  .map((control) => ({
                    id: control.id,
                    label: control.label,
                    action: control.action,
                    disabled: control.disabled,
                  })),
              }
            : {
                ...common,
                kind,
                anchor: { x: 0, y: 0, width: 0, height: 0 },
                placement: "bottom",
              },
    )
    return {
      title: `Opened native ${surface.kind}`,
      output: `Opened ${surface.kind} ${surface.id}. Use native_ui with operation=wait to observe the user's action.`,
      metadata: { surface } as Record<string, unknown>,
    }
  },
})
