import { describe, expect, test } from "bun:test"
import { InputScheduler, type PointerInput } from "../../src/cli/cmd/tui/util/browser-input"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function scheduler(intervalMs = 5) {
  const sent: PointerInput[] = []
  const input = new InputScheduler({ send: (event) => sent.push(event), intervalMs })
  return { input, sent }
}

describe("InputScheduler", () => {
  test("collapses a burst of moves into the last position", async () => {
    const { input, sent } = scheduler()
    input.push({ type: "move", x: 1, y: 1 })
    input.push({ type: "move", x: 2, y: 2 })
    input.push({ type: "move", x: 3, y: 3 })
    expect(sent).toHaveLength(0)
    await sleep(20)
    expect(sent).toEqual([{ type: "move", x: 3, y: 3 }])
  })

  test("adds wheel deltas up and keeps the newest position", async () => {
    const { input, sent } = scheduler()
    input.push({ type: "wheel", x: 5, y: 5, deltaY: 120 })
    input.push({ type: "wheel", x: 6, y: 6, deltaY: 120 })
    input.push({ type: "wheel", x: 7, y: 7, deltaY: -40 })
    await sleep(20)
    expect(sent).toEqual([{ type: "wheel", x: 7, y: 7, deltaX: 0, deltaY: 200 }])
  })

  test("a press flushes the pending move before it, so the click lands where the pointer is", () => {
    const { input, sent } = scheduler()
    input.push({ type: "move", x: 9, y: 9 })
    input.push({ type: "down", x: 9, y: 9, button: "left" })
    expect(sent).toEqual([
      { type: "move", x: 9, y: 9 },
      { type: "down", x: 9, y: 9, button: "left" },
    ])
  })

  test("wheel goes out before move: scrolling displaces what hover would land on", async () => {
    const { input, sent } = scheduler()
    input.push({ type: "move", x: 1, y: 1 })
    input.push({ type: "wheel", x: 1, y: 1, deltaY: 120 })
    await sleep(20)
    expect(sent.map((event) => event.type)).toEqual(["wheel", "move"])
  })

  test("nothing is delivered after dispose", async () => {
    const { input, sent } = scheduler()
    input.push({ type: "move", x: 1, y: 1 })
    input.dispose()
    await sleep(20)
    expect(sent).toHaveLength(0)
    input.push({ type: "down", x: 1, y: 1 })
    expect(sent).toHaveLength(0)
  })
})
