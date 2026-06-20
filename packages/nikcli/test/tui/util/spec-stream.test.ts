import { describe, expect, it } from "bun:test"
import { parsePartialJson, compilePartialSpec, createSpecStreamCompiler } from "@/cli/cmd/tui/util/spec-stream"

describe("parsePartialJson", () => {
  it("parses already-valid JSON unchanged", () => {
    expect(parsePartialJson('{"a":1}')).toEqual({ a: 1 })
  })

  it("closes a dangling string", () => {
    expect(parsePartialJson('{"a":"hel')).toEqual({ a: "hel" })
  })

  it("closes open objects and arrays", () => {
    expect(parsePartialJson('{"a":[1,2')).toEqual({ a: [1, 2] })
  })

  it("drops a trailing comma", () => {
    expect(parsePartialJson('{"a":1,')).toEqual({ a: 1 })
  })

  it("drops a dangling key with colon and no value", () => {
    expect(parsePartialJson('{"a":1,"b":')).toEqual({ a: 1 })
  })

  it("drops a half-written key", () => {
    expect(parsePartialJson('{"a":1,"b')).toEqual({ a: 1 })
  })

  it("drops a key awaiting its colon", () => {
    expect(parsePartialJson('{"a":1,"b"')).toEqual({ a: 1 })
  })

  it("recovers a partial component array (best-effort, render-safety filtering happens later)", () => {
    const raw = '{"title":"T","components":[{"type":"text","content":"hi"},{"type":"ta'
    expect(parsePartialJson(raw)).toEqual({
      title: "T",
      components: [{ type: "text", content: "hi" }, { type: "ta" }],
    })
  })

  it("returns undefined for empty input", () => {
    expect(parsePartialJson("   ")).toBeUndefined()
  })
})

describe("compilePartialSpec", () => {
  it("keeps only render-safe (complete) components", () => {
    // First text component is complete; the table is missing its required headers.
    const raw = '{"title":"Dash","components":[{"type":"text","content":"ready"},{"type":"table","title":"x"'
    const spec = compilePartialSpec(raw)
    expect(spec.title).toBe("Dash")
    expect(spec.streaming).toBe(true)
    expect(spec.components).toHaveLength(1)
    expect(spec.components[0]).toMatchObject({ type: "text", content: "ready" })
  })

  it("marks a fully-parsed spec as settled", () => {
    const raw = '{"title":"Dash","components":[{"type":"text","content":"done"}]}'
    const spec = compilePartialSpec(raw)
    expect(spec.streaming).toBe(false)
    expect(spec.components).toHaveLength(1)
  })

  it("unwraps {item:{…}} wrappers some models emit", () => {
    const raw =
      '{"title":"Dash","components":[{"item":{"type":"text","content":"hi"}},{"item":{"type":"alert","severity":"info","message":"m"}}]}'
    const spec = compilePartialSpec(raw)
    expect(spec.components).toHaveLength(2)
    expect(spec.components[0]).toMatchObject({ type: "text", content: "hi" })
    expect(spec.components[1]).toMatchObject({ type: "alert", severity: "info" })
  })
})

describe("createSpecStreamCompiler", () => {
  it("bumps version only when the render-safe projection changes", () => {
    const c = createSpecStreamCompiler()
    const a = c.push('{"title":"T","components":[{"type":"text","content":"hi"}')
    // More raw text, but no new complete component yet → same version.
    const b = c.push('{"title":"T","components":[{"type":"text","content":"hi"},{"type":"ta')
    expect(b.version).toBe(a.version)
    // A second complete component arrives → version bumps.
    const d = c.push(
      '{"title":"T","components":[{"type":"text","content":"hi"},{"type":"alert","severity":"info","message":"m"}]}',
    )
    expect(d.version).toBeGreaterThan(a.version)
    expect(d.components).toHaveLength(2)
  })

  it("finalize projects the validated input and stops streaming", () => {
    const c = createSpecStreamCompiler()
    const snap = c.finalize({
      title: "Final",
      components: [{ type: "text", content: "x" }],
    })
    expect(snap.streaming).toBe(false)
    expect(snap.title).toBe("Final")
    expect(snap.components).toHaveLength(1)
  })

  it("getResult mirrors the latest snapshot (json-render parity)", () => {
    const c = createSpecStreamCompiler()
    const pushed = c.push('{"title":"T","components":[{"type":"text","content":"hi"}]}')
    expect(c.getResult()).toBe(pushed)
    expect(c.getResult().components).toHaveLength(1)
  })

  it("accumulates RFC-6902-flavored patches as components stream in", () => {
    const c = createSpecStreamCompiler()
    c.push('{"title":"T","components":[{"type":"text","content":"hi"}')
    c.push(
      '{"title":"T","components":[{"type":"text","content":"hi"},{"type":"alert","severity":"info","message":"m"}]}',
    )
    const patches = c.getPatches()
    // One add per completed component, plus the initial title replace.
    expect(patches.some((p) => p.op === "replace" && p.path === "/title")).toBe(true)
    const adds = patches.filter((p) => p.op === "add")
    expect(adds.map((p) => p.path)).toEqual(["/components/0", "/components/1"])
  })

  it("reset clears state so the compiler can be reused", () => {
    const c = createSpecStreamCompiler()
    c.push('{"title":"T","components":[{"type":"text","content":"hi"}]}')
    c.reset()
    expect(c.getResult().components).toHaveLength(0)
    expect(c.getPatches()).toHaveLength(0)
    // Versioning restarts from a fresh baseline.
    const after = c.push('{"title":"U","components":[{"type":"text","content":"yo"}]}')
    expect(after.title).toBe("U")
    expect(after.components).toHaveLength(1)
  })
})
