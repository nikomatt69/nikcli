import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join, resolve } from "node:path"
import { TextareaRenderable, type CliRenderer, type Renderable } from "@opentui/core"
import { createMockKeys, createMockMouse, type MockInput, type MockMouse } from "@opentui/core/testing"
import type { SimulationProtocol } from "../protocol"
import { SimulationRenderer } from "./renderer"

export type Action = SimulationProtocol.Frontend.Action
export type Element = SimulationProtocol.Frontend.Element

export interface Harness {
  readonly renderer: CliRenderer
  readonly mockInput: MockInput
  readonly mockMouse: MockMouse
  readonly resize: (cols: number, rows: number) => void
  readonly renderOnce: () => Promise<void>
  readonly screen: () => string
}

const decoder = new TextDecoder()

function children(renderable: Renderable) {
  return renderable.getChildren().filter((child): child is Renderable => "num" in child)
}

function all(renderable: Renderable): Renderable[] {
  return [renderable, ...children(renderable).flatMap(all)]
}

function mouseListeners(renderable: Renderable) {
  const general = Reflect.get(renderable, "_mouseListener")
  const specific = Reflect.get(renderable, "_mouseListeners")
  return Boolean(general) || (specific && typeof specific === "object" && Object.keys(specific).length > 0)
}

function hit(renderer: CliRenderer, renderable: Renderable) {
  if (renderable.width <= 0 || renderable.height <= 0) return false
  const x = Math.floor(Number(Reflect.get(renderable, "screenX") ?? 0) + renderable.width / 2)
  const y = Math.floor(Number(Reflect.get(renderable, "screenY") ?? 0) + renderable.height / 2)
  return renderer.hitTest(x, y) === renderable.num
}

function resizeVisible(renderer: CliRenderer, cols: number, rows: number) {
  const processResize = Reflect.get(renderer, "processResize")
  if (typeof processResize !== "function") throw new Error("OpenTUI renderer does not expose resize support")
  processResize.call(renderer, cols, rows)
}

export function createHarness(renderer: CliRenderer): Harness {
  const setup = SimulationRenderer.setupFor(renderer)
  return {
    renderer,
    mockInput: setup?.mockInput ?? createMockKeys(renderer),
    mockMouse: setup?.mockMouse ?? createMockMouse(renderer),
    resize: setup?.resize ?? ((cols, rows) => resizeVisible(renderer, cols, rows)),
    renderOnce:
      setup?.renderOnce ??
      (async () => {
        renderer.requestRender()
        await renderer.idle()
      }),
    screen: () =>
      setup?.captureCharFrame() ?? decoder.decode(renderer.currentRenderBuffer.getRealCharBytes(false)),
  }
}

export function elements(renderer: CliRenderer): Element[] {
  return all(renderer.root)
    .filter((renderable) => renderable.visible && !renderable.isDestroyed)
    .map((renderable) => ({
      id: renderable.id,
      num: renderable.num,
      x: Number(Reflect.get(renderable, "screenX") ?? 0),
      y: Number(Reflect.get(renderable, "screenY") ?? 0),
      width: renderable.width,
      height: renderable.height,
      focusable: renderable.focusable,
      focused: renderable.focused,
      clickable: mouseListeners(renderable) && hit(renderer, renderable),
      editor: renderable instanceof TextareaRenderable,
    }))
    .filter((element) => element.focusable || element.clickable || element.editor)
}

export function state(harness: Harness): SimulationProtocol.Frontend.State {
  const focused = harness.renderer.currentFocusedRenderable
  return {
    screen: harness.screen(),
    focused: {
      renderable: focused?.num,
      editor: focused instanceof TextareaRenderable,
    },
    elements: elements(harness.renderer),
  }
}

export function matches(harness: Pick<Harness, "screen">, text: string) {
  return harness.screen().includes(text)
}

export async function screenshot(harness: Harness, name?: string) {
  await harness.renderOnce()
  const { SimulationPng } = await import("./png")
  const image = SimulationPng.screenshot(harness.renderer)
  const filename = name ?? `screenshot-${crypto.randomUUID()}`
  if (!filename || filename.includes("/") || filename.includes("\\") || extname(filename)) {
    throw new Error("screenshot name must not contain a path or extension")
  }
  const directory = resolve(process.env.NIKCLI_DRIVE_MEDIA_DIR ?? join(tmpdir(), "nikcli-drive", "output"))
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${filename}.png`)
  await Bun.write(path, image.data)
  return path
}

export async function execute(harness: Harness, action: Action) {
  switch (action.type) {
    case "ui.type":
      await harness.mockInput.typeText(action.text)
      break
    case "ui.press":
      harness.mockInput.pressKey(action.key, action.modifiers)
      break
    case "ui.enter":
      harness.mockInput.pressEnter()
      break
    case "ui.arrow":
      harness.mockInput.pressArrow(action.direction)
      break
    case "ui.focus":
      all(harness.renderer.root)
        .find((item) => item.num === action.target)
        ?.focus()
      break
    case "ui.click":
      await harness.mockMouse.click(action.x, action.y)
      break
    case "ui.resize":
      if (!Number.isSafeInteger(action.cols) || action.cols <= 0 || !Number.isSafeInteger(action.rows) || action.rows <= 0) {
        throw new Error("resize cols and rows must be positive integers")
      }
      harness.resize(action.cols, action.rows)
      SimulationRenderer.recordResize(harness.renderer, action.cols, action.rows)
      break
  }
  await harness.renderOnce()
  return state(harness)
}

export * as SimulationActions from "./actions"
