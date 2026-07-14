import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { createHarness, matches } from "../src/frontend/actions"
import { SimulationRenderer } from "../src/frontend/renderer"
import { Timeline, type Event } from "../src/recording"

test("streams ANSI chunks and resizes into a versioned JSONL timeline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nikcli-simulation-recording-"))
  const path = join(directory, "nested", "timeline.jsonl")
  try {
    const timeline = await Timeline.create(path, 80, 24)
    await new Promise<void>((resolve, reject) => {
      timeline.write(Buffer.from("\u001b[2Jhello"), (error) => (error ? reject(error) : resolve()))
    })
    timeline.resize(100, 30)
    expect(await timeline.finish()).toBe(path)
    const events = (await Bun.file(path).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Event)
    expect(events[0]).toEqual({ type: "header", version: 1, cols: 80, rows: 24, encoding: "base64" })
    expect(events[1]?.type).toBe("output")
    if (events[1]?.type !== "output") throw new Error("Missing output event")
    expect(Buffer.from(events[1].data, "base64").toString()).toBe("\u001b[2Jhello")
    expect(events[2]).toMatchObject({ type: "resize", cols: 100, rows: 30 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("records native OpenTUI output and preserves the live screen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nikcli-simulation-renderer-"))
  const path = join(directory, "timeline.jsonl")
  const renderer = await SimulationRenderer.create({}, path, { cols: 40, rows: 6 })
  try {
    renderer.root.add(new TextRenderable(renderer, { content: "recorded nikcli screen" }))
    await SimulationRenderer.setupFor(renderer)?.renderOnce()
    expect(matches(createHarness(renderer), "recorded nikcli screen")).toBe(true)
    renderer.destroy()
    expect(await SimulationRenderer.finish(renderer)).toBe(path)
    const events = (await Bun.file(path).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Event)
    expect(events.some((event) => event.type === "output")).toBe(true)
  } finally {
    if (!renderer.isDestroyed) renderer.destroy()
    await SimulationRenderer.finish(renderer)
    await rm(directory, { recursive: true, force: true })
  }
})
