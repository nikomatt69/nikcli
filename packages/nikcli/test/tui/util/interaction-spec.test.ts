import { describe, expect, it } from "bun:test"
import { AppSpecZod } from "@tui/util/interaction-spec"

const validApp = {
  title: "Deploy configuration",
  screens: [
    {
      id: "main",
      body: [
        {
          type: "group",
          title: "Target",
          children: [
            {
              type: "select",
              id: "env",
              label: "Environment",
              options: [{ value: "production" }, { value: "staging" }],
              default: "staging",
            },
            { type: "slider", id: "replicas", label: "Replicas", min: 1, max: 10, default: 3 },
          ],
        },
        { type: "checkbox", id: "migrate", label: "Run migrations", default: true },
        {
          type: "row",
          children: [
            { type: "button", label: "Cancel", action: { kind: "cancel" } },
            { type: "button", label: "Deploy", action: { kind: "submit" }, variant: "primary" },
          ],
        },
      ],
    },
  ],
}

describe("interaction AppSpec", () => {
  it("accepts a well-formed mini-app", () => {
    const r = AppSpecZod.safeParse(validApp)
    expect(r.success).toBe(true)
  })

  it("rejects a widget with a missing required field and points at it", () => {
    const broken = {
      title: "T",
      screens: [{ id: "m", body: [{ type: "select", id: "e", label: "E" }] }], // options missing
    }
    const r = AppSpecZod.safeParse(broken)
    expect(r.success).toBe(false)
    if (!r.success) {
      // discriminated → single targeted issue, not an aggregated invalid_union dump
      expect(r.error.issues).toHaveLength(1)
      expect(r.error.issues[0]!.path).toEqual(["screens", 0, "body", 0, "options"])
    }
  })

  it("rejects a button missing its action", () => {
    const broken = {
      title: "T",
      screens: [{ id: "m", body: [{ type: "button", label: "Go" }] }],
    }
    const r = AppSpecZod.safeParse(broken)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues[0]!.path).toEqual(["screens", 0, "body", 0, "action"])
    }
  })

  it("validates button action as a discriminated union on kind", () => {
    const broken = {
      title: "T",
      screens: [{ id: "m", body: [{ type: "button", label: "Go", action: { kind: "goto" } }] }], // goto needs screen
    }
    const r = AppSpecZod.safeParse(broken)
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path.join(".").endsWith("action.screen"))).toBe(true)
    }
  })

  it("requires at least one screen", () => {
    expect(AppSpecZod.safeParse({ title: "T", screens: [] }).success).toBe(false)
  })
})
