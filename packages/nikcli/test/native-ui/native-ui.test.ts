import { afterEach, describe, expect, test } from "bun:test"
import { NativeUI } from "../../src/native-ui"
import { NativeUITool } from "../../src/tool/native_ui"

afterEach(() => NativeUI.closeAll())

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
