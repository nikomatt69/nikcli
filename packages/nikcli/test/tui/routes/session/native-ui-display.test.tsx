import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import {
  nativeUIControlLabel,
  nativeUIEvent,
  nativeUIEventLabel,
  nativeUIPendingLabel,
  nativeUISurface,
  nativeUISurfaces,
  nativeUIValue,
} from "../../../../src/cli/cmd/tui/routes/session/native-ui-display"
import { NativeUISurfaceContent } from "../../../../src/cli/cmd/tui/routes/session/native-ui-surface"

describe("native UI session display", () => {
  test("formats controls as compact visual rows", () => {
    expect(
      nativeUIControlLabel({
        type: "checkbox",
        id: "tests",
        label: "Run tests",
        checked: true,
      }),
    ).toBe("[x] Run tests")
    expect(
      nativeUIControlLabel({
        type: "select",
        id: "env",
        label: "Environment",
        value: "prod",
        options: [
          { id: "dev", label: "Development" },
          { id: "prod", label: "Production" },
        ],
      }),
    ).toBe("◆ Environment · Production")
    expect(
      nativeUIControlLabel({
        type: "progress",
        id: "build",
        label: "Build",
        value: 0.5,
      }),
    ).toBe("━━━━━━────── Build · 50%")
  })

  test("recognizes surface and event metadata", () => {
    const surface = {
      id: "review",
      kind: "dialog" as const,
      title: "Review changes",
      controls: [],
      dismissible: true,
      modal: true,
      width: "medium" as const,
      layout: "stack" as const,
    }
    expect(nativeUISurface(surface)).toEqual(surface)
    expect(nativeUISurfaces([surface, { invalid: true }])).toEqual([surface])
    expect(
      nativeUISurface({
        id: "broken",
        kind: "dialog",
        title: "Broken",
        controls: "invalid",
      }),
    ).toBeUndefined()

    const event = nativeUIEvent({
      type: "control-activated",
      surfaceId: "review",
      controlId: "approve",
      action: { type: "invoke", action: "approve" },
    })
    expect(event && nativeUIEventLabel(event)).toBe("Action received")
    expect(nativeUIEvent({ type: "unknown" })).toBeUndefined()
    expect(nativeUIEvent({ type: "control-changed", value: "secret" })).toBeUndefined()
    expect(nativeUIValue("super-secret-token")).toBe("value updated")
  })

  test("uses accurate pending copy for every operation", () => {
    expect(nativeUIPendingLabel("open")).toBe("Opening native UI...")
    expect(nativeUIPendingLabel("update")).toBe("Updating native UI...")
    expect(nativeUIPendingLabel("close")).toBe("Closing native UI...")
    expect(nativeUIPendingLabel("wait")).toContain("interaction")
  })

  test("renders the surface summary and controls through OpenTUI", async () => {
    const color = RGBA.fromInts(230, 230, 230, 255)
    const muted = RGBA.fromInts(140, 140, 140, 255)
    const accent = RGBA.fromInts(60, 180, 220, 255)
    const setup = await testRender(
      () => (
        <NativeUISurfaceContent
          surface={{
            id: "build-review",
            kind: "dialog",
            title: "Review build",
            body: "All required checks are complete.",
            controls: [
              {
                type: "metric",
                id: "tests",
                label: "Tests",
                value: "248 passed",
                tone: "success",
              },
              {
                type: "progress",
                id: "coverage",
                label: "Coverage",
                value: 0.84,
              },
              {
                type: "button",
                id: "approve",
                label: "Approve",
                action: "approve",
              },
            ],
            dismissible: true,
            modal: true,
            width: "large",
            layout: "dashboard",
          }}
          textColor={color}
          mutedColor={muted}
          accentColor={accent}
        />
      ),
      { width: 72, height: 12 },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Review build · dashboard · large · modal")
      expect(frame).toContain("✓ Tests  248 passed")
      expect(frame).toContain("━━━━━━━━━━── Coverage · 84%")
      expect(frame).toContain("[ Approve ]")
      expect(frame).toContain("ID build-review")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("renders native menu items through OpenTUI", async () => {
    const color = RGBA.fromInts(230, 230, 230, 255)
    const muted = RGBA.fromInts(140, 140, 140, 255)
    const setup = await testRender(
      () => (
        <NativeUISurfaceContent
          surface={{
            id: "recovery",
            kind: "menu",
            title: "Recovery actions",
            controls: [],
            items: [
              { id: "logs", label: "Inspect logs", checked: true },
              { id: "retry", label: "Retry check", disabled: true },
            ],
            dismissible: true,
          }}
          textColor={color}
          mutedColor={muted}
          accentColor={color}
        />
      ),
      { width: 52, height: 8 },
    )
    try {
      await setup.renderOnce()
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Recovery actions · 2 items")
      expect(frame).toContain("[x] Inspect logs")
      expect(frame).toContain("› Retry check")
    } finally {
      setup.renderer.destroy()
    }
  })
})
