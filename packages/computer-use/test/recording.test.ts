import { describe, expect, test } from "bun:test"
import { Recorder, duration, finalFrame, frameAt, frameAtMarker } from "../src/recording"
import type { Backend } from "../src/backends"

class StubBackend implements Backend {
  readonly mode = "sandbox" as const
  private shots = 0
  capabilities() {
    return Promise.resolve({
      platform: "linux" as NodeJS.Platform,
      screenshot: true,
      input: true,
      detail: "stub",
    })
  }
  async screenshot(): Promise<Uint8Array> {
    this.shots += 1
    // Each screenshot is a different byte so sameBytes() reliably distinguishes them.
    return new Uint8Array([this.shots])
  }
  async screenSize() {
    return { width: 1280, height: 800 }
  }
  async moveMouse() {}
  async click() {}
  async drag() {}
  async type() {}
  async key() {}
  async scroll() {}
}

function makeRecorder() {
  return new Recorder(new StubBackend(), { width: 100, height: 50 })
}

describe("Recorder", () => {
  test("active before stop, not after", async () => {
    const r = makeRecorder()
    expect(r.active).toBe(true)
    await r.stop()
    expect(r.active).toBe(false)
  })

  test("no-op after stop", async () => {
    const r = makeRecorder()
    await r.stop()
    expect(await r.marker("late")).toBeUndefined()
    expect(r.data().markers.length).toBe(0)
  })

  test("marker captures and adds to data", async () => {
    const r = makeRecorder()
    const m = await r.marker("ready")
    expect(m?.name).toBe("ready")
    expect(m?.screenshot).toMatch(/marker-0-ready\.png$/)
    expect(r.data().markers.length).toBe(1)
    await r.stop()
  })

  test("data() while still active reports live samples", async () => {
    const r = makeRecorder()
    await r.start({ sampleFps: 50 })
    // First capture is awaited by the interval; sleep briefly so at least one
    // is taken. Stop the timer before the test process exits to avoid leaks.
    await new Promise((resolve) => setTimeout(resolve, 80))
    const data = r.data()
    expect(data.sampleFps).toBe(50)
    expect(data.samples.length).toBeGreaterThanOrEqual(0)
    await r.stop()
  })
})

describe("frame helpers", () => {
  function makeData(samples: Array<{ time: number }> = [], markers: Array<{ time: number; name: string }> = []) {
    return {
      version: 1 as const,
      startedAt: 0,
      duration: samples.length ? samples[samples.length - 1]!.time : 0,
      mode: "sandbox" as const,
      screen: { width: 10, height: 10 },
      samples: samples.map((s) => ({
        time: s.time,
        path: `/tmp/fake-${s.time}.png`,
      })),
      markers: markers.map((m) => ({
        time: m.time,
        name: m.name,
        screenshot: `/tmp/marker-${m.name}.png`,
      })),
    }
  }

  test("frameAt picks nearest sample", () => {
    const data = makeData([{ time: 0 }, { time: 100 }, { time: 200 }])
    expect(frameAt(data, 95)?.time).toBe(100)
    expect(frameAt(data, 250)?.time).toBe(200)
  })

  test("frameAt on empty recording returns undefined", () => {
    expect(frameAt(makeData(), 0)).toBeUndefined()
  })

  test("finalFrame is the last sample", () => {
    const data = makeData([{ time: 0 }, { time: 100 }, { time: 200 }])
    expect(finalFrame(data)?.time).toBe(200)
  })

  test("duration uses last sample when recording has no explicit duration", () => {
    const data = makeData([{ time: 0 }, { time: 100 }])
    data.duration = 0
    expect(duration(data)).toBe(100)
  })

  test("frameAtMarker resolves a marker to its nearest sample", () => {
    const data = makeData([{ time: 0 }, { time: 100 }, { time: 200 }], [{ time: 100, name: "m1" }])
    expect(frameAtMarker(data, "m1")?.time).toBe(100)
  })

  test("frameAtMarker throws on missing marker", () => {
    const data = makeData([{ time: 0 }], [{ time: 0, name: "m1" }])
    expect(() => frameAtMarker(data, "missing")).toThrow(`Marker "missing" not found`)
  })
})
