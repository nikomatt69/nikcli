import { describe, expect, it } from "bun:test"
import { BrowserFramePump, cellSize } from "@tui/util/browser-frames"

function capture() {
  const writes: string[] = []
  let accept = true
  return {
    writes,
    block: () => {
      accept = false
    },
    unblock: () => {
      accept = true
    },
    writer: (sequence: string) => {
      writes.push(sequence)
      return accept
    },
  }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

const frame = (seq: number, over: Partial<{ path: string; pngBase64: string }> = {}) => ({
  seq,
  width: 800,
  height: 600,
  path: "/tmp/nikcli-screencast-x/frame-0.png",
  pngBase64: PNG.toBase64(),
  ...over,
})

/** Most tests care about the pump's bookkeeping, not which transport it used. */
const filePump = (writer: (s: string) => boolean) => new BrowserFramePump({ writer, transmission: "file" })

describe("BrowserFramePump", () => {
  it("defaults to inline, the transport that is guaranteed to draw", () => {
    const sink = capture()
    const pump = new BrowserFramePump({ writer: sink.writer })
    pump.setPlacement(10, 5)
    pump.present(frame(1))
    expect(pump.mode).toBe("inline")
    expect(sink.writes[0]).not.toContain("t=t")
  })

  it("draws nothing until a placement exists", () => {
    const sink = capture()
    const pump = filePump(sink.writer)
    expect(pump.present(frame(1))).toBe(false)
    expect(sink.writes).toHaveLength(0)
    expect(pump.placeholder()).toEqual([])
  })

  it("reuses one image id across frames so the cells never change", () => {
    const sink = capture()
    const pump = filePump(sink.writer)
    pump.setPlacement(40, 20)
    const grid = pump.placeholder()

    for (let i = 1; i <= 5; i++) pump.present(frame(i))

    expect(sink.writes).toHaveLength(5)
    for (const write of sink.writes) expect(write).toContain(`i=${pump.id}`)
    // The grid is a pure function of the placement, so a steady stream leaves
    // OpenTUI's cells untouched.
    expect(pump.placeholder()).toEqual(grid)
    expect(pump.stats.presented).toBe(5)
    expect(pump.stats.dropped).toBe(0)
  })

  it("reports whether a placement actually changed", () => {
    const pump = filePump(capture().writer)
    expect(pump.setPlacement(30, 10)).toBe(true)
    expect(pump.setPlacement(30, 10)).toBe(false)
    expect(pump.setPlacement(30.9, 10.2)).toBe(false)
    expect(pump.setPlacement(31, 10)).toBe(true)
  })

  it("drops frames while the terminal is behind, and never queues them", () => {
    const sink = capture()
    const pump = filePump(sink.writer)
    pump.setPlacement(40, 20)

    sink.block()
    expect(pump.present(frame(1))).toBe(true) // this one is written, then blocks
    expect(pump.present(frame(2))).toBe(false)
    expect(pump.present(frame(3))).toBe(false)
    expect(sink.writes).toHaveLength(1)
    expect(pump.stats.dropped).toBe(2)

    sink.unblock()
    process.stdout.emit("drain")
    expect(pump.present(frame(4))).toBe(true)
    expect(sink.writes).toHaveLength(2)
  })

  it("sends a path in file mode and pixels in inline mode", () => {
    const sink = capture()
    const pump = filePump(sink.writer)
    pump.setPlacement(10, 5)

    pump.present(frame(1))
    expect(sink.writes[0]).toContain("t=t")

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    pump.setTransmission("inline")
    pump.present(frame(2, { pngBase64: png.toBase64() }))
    expect(sink.writes[1]).not.toContain("t=t")
    expect(sink.writes[1]).toContain(png.toBase64())
  })

  it("keeps the file-mode command small no matter how big the picture is", () => {
    const sink = capture()
    const pump = filePump(sink.writer)
    pump.setPlacement(120, 60)
    pump.present(frame(1))
    expect(sink.writes[0]!.length).toBeLessThan(200)
  })

  it("drops rather than stalling when inline mode has no bytes to send", () => {
    const sink = capture()
    const pump = new BrowserFramePump({ writer: sink.writer, transmission: "inline" })
    pump.setPlacement(10, 5)
    expect(pump.present({ seq: 1, width: 800, height: 600, path: "/tmp/x.png" })).toBe(false)
    expect(pump.stats.dropped).toBe(1)
    expect(sink.writes).toHaveLength(0)
  })

  it("frees the image on destroy, but only if it ever drew one", () => {
    const drawn = capture()
    const pump = filePump(drawn.writer)
    pump.setPlacement(10, 5)
    pump.present(frame(1))
    pump.destroy()
    expect(drawn.writes.at(-1)).toContain("a=d")

    const untouched = capture()
    const idle = new BrowserFramePump({ writer: untouched.writer })
    idle.destroy()
    expect(untouched.writes).toHaveLength(0)
  })

  it("gives concurrent pumps distinct image ids", () => {
    const a = new BrowserFramePump({ writer: capture().writer })
    const b = new BrowserFramePump({ writer: capture().writer })
    expect(a.id).not.toBe(b.id)
  })
})

describe("cellSize", () => {
  it("derives cell pixels from the negotiated resolution", () => {
    expect(cellSize({ width: 1600, height: 960 }, 160, 48)).toEqual({ width: 10, height: 20, measured: true })
  })

  it("reports the fallback rather than hiding it", () => {
    for (const bad of [null, undefined, { width: 0, height: 0 }, { width: 10, height: 10 }]) {
      const result = cellSize(bad, 160, 48)
      expect(result.measured).toBe(false)
      expect(result).toMatchObject({ width: 10, height: 20 })
    }
    expect(cellSize({ width: 1600, height: 960 }, 0, 0).measured).toBe(false)
  })
})
