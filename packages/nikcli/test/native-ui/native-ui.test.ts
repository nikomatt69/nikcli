import { afterEach, describe, expect, test } from "bun:test"
import type { SurfaceEvent } from "@nikcli-ai/native-ui-protocol"
import { NativeUI } from "../../src/native-ui"
import { NativeUITool } from "../../src/tool/native_ui"
import type { Tool } from "../../src/tool/tool"

afterEach(() => NativeUI.closeAll())

function toolContext(): Tool.Context {
  return {
    sessionID: "session-test",
    messageID: "message-test",
    agent: "test",
    callID: "call-test",
    abort: new AbortController().signal,
    metadata: () => {},
    progress: async () => {},
    ask: async () => {},
  }
}

describe("NativeUI", () => {
  test("uses the dedicated Liquid Glass prompt", async () => {
    const tool = await NativeUITool.init()
    expect(tool.description).toContain("native Liquid Glass interfaces")
    expect(tool.description).toContain("rather than using a fixed template")
  })

  test("accepts rich presentation options", async () => {
    const tool = await NativeUITool.init()
    expect(
      tool.parameters.parse({
        operation: "open",
        surfaceID: "complete",
        kind: "notification",
        title: "Complete",
        severity: "success",
        durationMs: 5_000,
        anchor: { x: 100, y: 50, width: 32, height: 32 },
        placement: "bottom",
        width: "large",
      }),
    ).toMatchObject({
      severity: "success",
      durationMs: 5_000,
    })
  })

  test("accepts contextual dashboard composition", async () => {
    const tool = await NativeUITool.init()
    expect(
      tool.parameters.parse({
        operation: "open",
        kind: "dialog",
        title: "Delivery dashboard",
        layout: "dashboard",
        width: "large",
        controls: [
          {
            type: "metric",
            id: "checks",
            label: "Checks",
            value: "17 / 17",
            tone: "success",
          },
          {
            type: "section",
            id: "workspace",
            label: "Workspace",
            detail: "One file needs review",
          },
        ],
      }),
    ).toMatchObject({ layout: "dashboard", width: "large" })
  })

  test("updates a contextual surface in place", () => {
    const opened = NativeUI.open({
      id: "progress",
      kind: "popover",
      title: "Analyzing",
      controls: [],
      dismissible: true,
      anchor: { x: 0, y: 0, width: 0, height: 0 },
      placement: "bottom",
      metadata: { sessionID: "session-1", agent: "build" },
    })
    const updated = NativeUI.update({ ...opened, title: "Testing" })
    expect(NativeUI.list()).toEqual([updated])
  })

  test("resolves waits from native host actions", async () => {
    const pending = NativeUI.wait((event) => event.type === "control-activated", { timeoutMs: 500 })
    NativeUI.dispatch({
      type: "control-activated",
      surfaceId: "review",
      controlId: "approve",
      action: { type: "invoke", action: "approve" },
    })
    expect(await pending).toMatchObject({
      type: "control-activated",
      controlId: "approve",
    })
  })

  test("resolves waits when the native event arrived first", async () => {
    NativeUI.open({
      id: "fast-review",
      kind: "dialog",
      title: "Fast review",
      controls: [
        {
          type: "button",
          id: "approve",
          label: "Approve",
          action: "approve",
        },
      ],
      dismissible: true,
      modal: true,
      width: "medium",
      layout: "stack",
    })
    NativeUI.dispatch({
      type: "control-activated",
      surfaceId: "fast-review",
      controlId: "approve",
      action: { type: "invoke", action: "approve" },
    })

    await expect(
      NativeUI.wait((event) => event.type === "control-activated" && event.surfaceId === "fast-review", {
        timeoutMs: 50,
      }),
    ).resolves.toMatchObject({ controlId: "approve" })
  })

  test("persists native control changes on the active surface", () => {
    NativeUI.open({
      id: "form",
      kind: "dialog",
      title: "Form",
      controls: [
        { type: "text-input", id: "name", value: "Old" },
        {
          type: "select",
          id: "environment",
          label: "Environment",
          value: "dev",
          options: [
            { id: "dev", label: "Development" },
            { id: "prod", label: "Production" },
          ],
        },
        { type: "checkbox", id: "tests", label: "Tests", checked: false },
      ],
      dismissible: true,
      modal: true,
      width: "medium",
      layout: "stack",
    })

    NativeUI.dispatch({
      type: "control-changed",
      surfaceId: "form",
      controlId: "name",
      value: "New",
    })
    NativeUI.dispatch({
      type: "control-changed",
      surfaceId: "form",
      controlId: "environment",
      value: "prod",
    })
    NativeUI.dispatch({
      type: "control-changed",
      surfaceId: "form",
      controlId: "tests",
      value: true,
    })

    expect(NativeUI.get("form")?.controls).toMatchObject([
      { id: "name", value: "New" },
      { id: "environment", value: "prod" },
      { id: "tests", checked: true },
    ])
  })

  test("announces replacement when a surface id is reopened", () => {
    const events: SurfaceEvent[] = []
    NativeUI.open({
      id: "wizard",
      kind: "dialog",
      title: "Step 1",
      controls: [],
      dismissible: true,
      modal: true,
      width: "medium",
      layout: "stack",
    })
    const unsubscribe = NativeUI.subscribe((event) => events.push(event))
    NativeUI.open({
      id: "wizard",
      kind: "dialog",
      title: "Step 1 again",
      controls: [],
      dismissible: true,
      modal: true,
      width: "medium",
      layout: "stack",
    })
    unsubscribe()
    expect(events.map((event) => event.type)).toEqual(["surface-closed", "surface-opened"])
    expect(events[0]).toMatchObject({ type: "surface-closed", surfaceId: "wizard", reason: "replaced" })
    expect(NativeUI.list()).toHaveLength(1)
  })

  test("broadcasts the close caused by a dismiss-surface action", () => {
    NativeUI.open({
      id: "confirm",
      kind: "dialog",
      title: "Confirm",
      controls: [{ type: "button", id: "cancel", label: "Cancel", action: "cancel" }],
      dismissible: true,
      modal: true,
      width: "medium",
      layout: "stack",
    })
    const events: SurfaceEvent[] = []
    const unsubscribe = NativeUI.subscribe((event) => events.push(event))
    NativeUI.dispatch({
      type: "control-activated",
      surfaceId: "confirm",
      controlId: "cancel",
      action: { type: "dismiss-surface", surfaceId: "confirm" },
    })
    unsubscribe()
    expect(events.map((event) => event.type)).toEqual(["control-activated", "surface-closed"])
    expect(events[1]).toMatchObject({ type: "surface-closed", surfaceId: "confirm", reason: "dismissed" })
    expect(NativeUI.get("confirm")).toBeUndefined()
  })

  test("does not re-announce closes for surfaces that are already gone", () => {
    const events: SurfaceEvent[] = []
    const unsubscribe = NativeUI.subscribe((event) => events.push(event))
    NativeUI.dispatch({ type: "surface-closed", surfaceId: "ghost", reason: "dismissed" })
    unsubscribe()
    expect(events).toHaveLength(0)
  })

  test("registers surfaces dispatched by observers", () => {
    NativeUI.dispatch({
      type: "surface-opened",
      surface: {
        id: "external",
        kind: "notification",
        title: "External",
        controls: [],
        dismissible: true,
        severity: "info",
      },
    })
    expect(NativeUI.get("external")).toMatchObject({ kind: "notification", title: "External" })
  })

  test("delivers each interaction to a single wait", async () => {
    NativeUI.open({
      id: "once",
      kind: "dialog",
      title: "Once",
      controls: [{ type: "button", id: "ok", label: "OK", action: "ok" }],
      dismissible: true,
      modal: true,
      width: "medium",
      layout: "stack",
    })
    NativeUI.dispatch({
      type: "control-activated",
      surfaceId: "once",
      controlId: "ok",
      action: { type: "invoke", action: "ok" },
    })
    const predicate = (event: SurfaceEvent) => event.type === "control-activated" && event.surfaceId === "once"
    await expect(NativeUI.wait(predicate, { timeoutMs: 50 })).resolves.toMatchObject({ controlId: "ok" })
    await expect(NativeUI.wait(predicate, { timeoutMs: 50 })).rejects.toThrow("Timed out")
  })

  test("fails fast when waiting on an unknown surface", async () => {
    const tool = await NativeUITool.init()
    await expect(tool.executeAsync({ operation: "wait", surfaceID: "missing" }, toolContext())).rejects.toThrow(
      "Native UI surface not found: missing",
    )
  })

  test("rejects menus without button controls", async () => {
    const tool = await NativeUITool.init()
    await expect(
      tool.executeAsync(
        {
          operation: "open",
          kind: "menu",
          title: "Recovery",
          controls: [{ type: "checkbox", id: "keep", label: "Keep", checked: false }],
        },
        toolContext(),
      ),
    ).rejects.toThrow("at least one button")
  })

  test("closes surfaces with the programmatic reason", async () => {
    NativeUI.open({
      id: "done",
      kind: "notification",
      title: "Done",
      controls: [],
      dismissible: true,
      severity: "success",
    })
    const events: SurfaceEvent[] = []
    const unsubscribe = NativeUI.subscribe((event) => events.push(event))
    const tool = await NativeUITool.init()
    await tool.executeAsync({ operation: "close", surfaceID: "done" }, toolContext())
    unsubscribe()
    expect(events).toEqual([{ type: "surface-closed", surfaceId: "done", reason: "system" }])
  })

  test("applies dismiss and update actions", () => {
    NativeUI.open({
      id: "progress",
      kind: "dialog",
      title: "Progress",
      controls: [{ type: "progress", id: "build", value: 0.25 }],
      dismissible: true,
      modal: true,
      width: "medium",
      layout: "stack",
    })
    NativeUI.dispatch({
      type: "control-activated",
      surfaceId: "progress",
      controlId: "build",
      action: {
        type: "update-control",
        surfaceId: "progress",
        controlId: "build",
        value: 0.75,
      },
    })
    expect(NativeUI.get("progress")?.controls[0]).toMatchObject({
      value: 0.75,
    })

    NativeUI.dispatch({
      type: "control-activated",
      surfaceId: "progress",
      controlId: "build",
      action: { type: "dismiss-surface", surfaceId: "progress" },
    })
    expect(NativeUI.get("progress")).toBeUndefined()
  })
})
