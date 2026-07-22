import { afterEach, describe, expect, test } from "bun:test"
import { NativeUI } from "../../src/native-ui"

afterEach(() => NativeUI.closeAll())

describe("NativeUI", () => {
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
