import { describe, expect, it } from "bun:test"
import {
  VizSpecZod,
  SafeVizSpecZod,
  VizCatalog,
  VIZ_COMPONENT_TYPES,
  normalizeVizComponents,
  deepUnwrap,
  decodeVizComponent,
  OpenTUIVizTool,
} from "@/tool/opentui"

describe("opentui tool input tolerance", () => {
  it("SafeVizSpecZod unwraps top-level `item` envelopes and validates cleanly", () => {
    // This is the exact shape some tool-call parsers produce (Bun plugin
    // resolver, manual invocations, stale AI SDK adapters): every object is
    // wrapped in `{item: {...}}`. SafeVizSpecZod must accept it.
    const input = {
      title: "Architecture Overview",
      components: [
        { item: { type: "text", content: "nikcli is modular" } },
        { item: { type: "alert", severity: "info", message: "see specs/" } },
      ],
    }
    const parsed = SafeVizSpecZod.safeParse(input)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.components).toHaveLength(2)
      expect(parsed.data.components[0]).toMatchObject({
        type: "text",
        content: "nikcli is modular",
      })
      expect(parsed.data.components[1]).toMatchObject({
        type: "alert",
        severity: "info",
      })
    }
  })

  it("SafeVizSpecZod recursively unwraps nested envelopes (grid inside section)", () => {
    // Regression: previously `section > grid > stat` failed because the tool-call
    // parser wrapped the inner grid in `{item: {...}}` and stripped type info.
    // SafeVizSpecZod must recover the whole tree.
    const input = {
      title: "Nested",
      components: [
        {
          item: {
            type: "section",
            title: "Hero",
            children: [
              {
                item: {
                  type: "grid",
                  columns: 2,
                  children: [
                    { item: { type: "stat", label: "A", value: 1 } },
                    { item: { type: "stat", label: "B", value: 2 } },
                  ],
                },
              },
            ],
          },
        },
      ],
    }
    const parsed = SafeVizSpecZod.safeParse(input)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const section = parsed.data.components[0] as any
      const grid = section.children[0]
      const stats = grid.children
      expect(section.type).toBe("section")
      expect(section.title).toBe("Hero")
      expect(grid.type).toBe("grid")
      expect(grid.columns).toBe(2)
      expect(stats).toHaveLength(2)
      expect(stats[0]).toMatchObject({ type: "stat", label: "A", value: 1 })
      expect(stats[1]).toMatchObject({ type: "stat", label: "B", value: 2 })
    }
  })

  it("SafeVizSpecZod also unwraps the alternative envelope keys (component/element/node/child)", () => {
    const input = {
      title: "Alt envelopes",
      components: [
        { component: { type: "text", content: "via component" } },
        { element: { type: "text", content: "via element" } },
        { node: { type: "text", content: "via node" } },
        { child: { type: "text", content: "via child" } },
      ],
    }
    const parsed = SafeVizSpecZod.safeParse(input)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.components).toHaveLength(4)
    }
  })

  it("SafeVizSpecZod accepts the unwrapped (canonical) shape unchanged", () => {
    // Make sure the preprocess is a no-op for already-canonical inputs.
    const input = {
      title: "Clean",
      components: [
        { type: "text", content: "no wrapper" },
        { type: "alert", severity: "info", message: "ok" },
      ],
    }
    const parsed = SafeVizSpecZod.safeParse(input)
    expect(parsed.success).toBe(true)
  })

  it("SafeVizSpecZod accepts up to 30 top-level components", () => {
    const components = Array.from({ length: 30 }, (_, i) => ({
      type: "text" as const,
      content: `tab ${i + 1}`,
    }))
    const parsed = SafeVizSpecZod.safeParse({ title: "Max tabs", components })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.components).toHaveLength(30)
  })

  it("SafeVizSpecZod rejects more than 30 top-level components", () => {
    const components = Array.from({ length: 31 }, (_, i) => ({
      type: "text" as const,
      content: `tab ${i + 1}`,
    }))
    const parsed = SafeVizSpecZod.safeParse({ title: "Too many", components })
    expect(parsed.success).toBe(false)
  })

  it("SafeVizSpecZod preserves the strict object mode for real errors", () => {
    // Real errors (e.g. unknown component type) must still surface — the
    // preprocess only unwraps, it does not silently accept garbage.
    const input = {
      title: "Bad",
      components: [{ type: "totally-bogus", foo: 1 }],
    }
    const parsed = SafeVizSpecZod.safeParse(input)
    expect(parsed.success).toBe(false)
  })

  it("normalizes wrapped/garbage components, keeping only render-safe ones", () => {
    const components = [
      { item: { type: "text", content: "hi" } }, // wrapped → recovered
      { type: "alert", severity: "info", message: "m" }, // already valid
      { type: "bogus", foo: 1 }, // unrenderable → dropped
      {}, // empty → dropped
    ]
    const out = normalizeVizComponents(components)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ type: "text", content: "hi" })
    expect(out[1]).toMatchObject({ type: "alert", severity: "info" })
  })

  it("deepUnwrap strips nested single-key wrappers but leaves real fields", () => {
    expect(deepUnwrap({ item: { type: "text", content: "x" } })).toEqual({
      type: "text",
      content: "x",
    })
    // A legitimate multi-key object is untouched.
    expect(deepUnwrap({ type: "stat", label: "L", value: 5 })).toEqual({
      type: "stat",
      label: "L",
      value: 5,
    })
  })

  it("decodeVizComponent recovers a wrapped component", () => {
    expect(decodeVizComponent({ component: { type: "text", content: "hi" } })).toMatchObject({
      type: "text",
      content: "hi",
    })
  })

  it("OpenTUIVizTool exposes SafeVizSpecZod (not the strict VizSpecZod) as its parameters", async () => {
    // The tool's parameters schema is the one AI SDK sees; this is the
    // contract callers depend on for tolerance.
    const def = await OpenTUIVizTool.init({})
    // The same parser-safe schema must unwrap and accept `item` envelopes.
    const wrapped = {
      title: "Tool test",
      components: [{ item: { type: "text", content: "via tool schema" } }],
    }
    const parsed = def.parameters.safeParse(wrapped)
    expect(parsed.success).toBe(true)
  })
})

describe("VizCatalog (json-render Catalog parity)", () => {
  it("exposes the component vocabulary as componentNames", () => {
    expect(VizCatalog.componentNames).toBe(VIZ_COMPONENT_TYPES)
    expect(VizCatalog.componentNames).toHaveLength(25)
    expect(VizCatalog.componentNames).toContain("stat_grid")
    expect(VizCatalog.componentNames).toContain("card")
    expect(VizCatalog.componentNames).toContain("sparkline_row")
    expect(VizCatalog.componentNames).toContain("grid")
  })

  it("prompt() returns the catalog system prompt", () => {
    const prompt = VizCatalog.prompt()
    expect(typeof prompt).toBe("string")
    expect(prompt.length).toBeGreaterThan(0)
  })

  it("zodSchema() is the same schema the model is constrained to", () => {
    expect(VizCatalog.zodSchema()).toBe(VizSpecZod)
  })

  it("jsonSchema() produces an object schema (never throws)", () => {
    const schema = VizCatalog.jsonSchema()
    expect(typeof schema).toBe("object")
  })

  it("validate() repairs wrapped/garbage output and reports drops", () => {
    const result = VizCatalog.validate({
      title: "Overview",
      components: [
        { item: { type: "text", content: "ok" } }, // wrapped → recovered
        { type: "bogus" }, // dropped
      ],
    })
    expect(result.spec.title).toBe("Overview")
    expect(result.spec.components).toHaveLength(1)
    expect(result.dropped).toBe(1)
    expect(result.valid).toBe(false)
  })

  it("validate() reports a clean spec as valid", () => {
    const result = VizCatalog.validate({
      title: "Clean",
      components: [{ type: "alert", severity: "info", message: "m" }],
    })
    expect(result.valid).toBe(true)
    expect(result.dropped).toBe(0)
  })
})
