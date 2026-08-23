import { describe, expect, it } from "bun:test"
import {
  DEFAULT_LOOP_AGENT,
  LOOP_TEMPLATES,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  definitionFromGenerated,
  isSandboxed,
  definitionFromGeneratedText,
  formatDuration,
  isValidModel,
  parseDuration,
  sanitizeDefinition,
  sanitizeRun,
  validateDefinition,
  validateStage,
  type LoopDefinition,
  type LoopStage,
} from "@/loop/schema"

function makeStage(overrides: Partial<LoopStage> = {}): LoopStage {
  return {
    name: "stage",
    agent: "ralph",
    objective: "Do the thing",
    ...overrides,
  }
}

function makeDef(overrides: Partial<LoopDefinition> = {}): LoopDefinition {
  return {
    id: "loop_test",
    name: "test",
    stages: [makeStage()],
    trigger: { kind: "manual" },
    enabled: true,
    createdAt: Date.now(),
    ...overrides,
  }
}

describe("loop/schema · parseDuration", () => {
  it("parses single units", () => {
    expect(parseDuration("30s")).toBe(30_000)
    expect(parseDuration("10m")).toBe(600_000)
    expect(parseDuration("2h")).toBe(7_200_000)
    expect(parseDuration("1d")).toBe(86_400_000)
  })
  it("parses compound units", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000)
    expect(parseDuration(" 1h 30m ")).toBe(5_400_000)
    expect(parseDuration("2d 5h 10m 30s")).toBe(2 * 86_400_000 + 5 * 3_600_000 + 10 * 60_000 + 30_000)
  })
  it("treats bare integers as minutes", () => {
    expect(parseDuration("5")).toBe(300_000)
  })
  it("rejects empty, negative, zero, and garbage", () => {
    expect(() => parseDuration("")).toThrow()
    expect(() => parseDuration("abc")).toThrow()
    expect(() => parseDuration("0m")).toThrow()
    expect(() => parseDuration("10mfoo")).toThrow()
  })
})

describe("loop/schema · formatDuration", () => {
  it("formats sub-minute as seconds", () => {
    expect(formatDuration(30_000)).toBe("30s")
  })
  it("formats sub-hour as minutes with optional seconds", () => {
    expect(formatDuration(600_000)).toBe("10m")
    expect(formatDuration(610_000)).toBe("10m 10s")
  })
  it("formats sub-day as hours with optional minutes", () => {
    expect(formatDuration(7_200_000)).toBe("2h")
    expect(formatDuration(5_400_000)).toBe("1h 30m")
  })
})

describe("loop/schema · validateStage", () => {
  it("requires an objective", () => {
    expect(validateStage({ ...makeStage(), objective: "" })).toBeDefined()
    expect(validateStage({ ...makeStage(), objective: "  " })).toBeDefined()
  })
  it("rejects reserved objective words", () => {
    expect(validateStage({ ...makeStage(), objective: "pause" })).toMatch(/reserved/i)
    expect(validateStage({ ...makeStage(), objective: "  STATUS  " })).toMatch(/reserved/i)
  })
  it("rejects --token-budget in the objective", () => {
    expect(validateStage({ ...makeStage(), objective: "do it --token-budget 100" })).toMatch(/token budget/i)
  })
  it("rejects blank name/agent and invalid model", () => {
    expect(validateStage({ ...makeStage(), name: "" })).toMatch(/name/i)
    expect(validateStage({ ...makeStage(), agent: "  " })).toMatch(/agent/i)
    expect(validateStage({ ...makeStage(), model: "noSlash" })).toMatch(/providerID\/modelID/)
  })
  it("rejects non-positive token budgets", () => {
    expect(validateStage({ ...makeStage(), tokenBudget: 0 })).toMatch(/positive integer/)
    expect(validateStage({ ...makeStage(), tokenBudget: -5 })).toMatch(/positive integer/)
  })
  it("accepts a fully-formed stage", () => {
    expect(
      validateStage({
        name: "watch",
        agent: "ralph",
        model: "openai/gpt-4o",
        objective: "watch CI",
        tokenBudget: 200_000,
      }),
    ).toBeUndefined()
  })
})

describe("loop/schema · validateDefinition", () => {
  it("rejects interval below MIN_INTERVAL_MS", () => {
    const err = validateDefinition(makeDef({ trigger: { kind: "interval", everyMs: MIN_INTERVAL_MS - 1 } }))
    expect(err).toMatch(/at least/)
  })
  it("rejects interval above MAX_INTERVAL_MS", () => {
    const err = validateDefinition(makeDef({ trigger: { kind: "interval", everyMs: MAX_INTERVAL_MS + 1 } }))
    expect(err).toMatch(/cannot exceed/)
  })
  it("accepts interval at the boundaries", () => {
    expect(validateDefinition(makeDef({ trigger: { kind: "interval", everyMs: MIN_INTERVAL_MS } }))).toBeUndefined()
    expect(validateDefinition(makeDef({ trigger: { kind: "interval", everyMs: MAX_INTERVAL_MS } }))).toBeUndefined()
  })
  it("rejects non-positive maxRuns", () => {
    expect(validateDefinition(makeDef({ maxRuns: 0 }))).toMatch(/positive integer/)
    expect(validateDefinition(makeDef({ maxRuns: -1 }))).toMatch(/positive integer/)
  })
  it("propagates the first stage error", () => {
    const err = validateDefinition(
      makeDef({
        stages: [makeStage({ objective: "" }), makeStage({ objective: "ok" })],
      }),
    )
    expect(err).toBeDefined()
  })
})

describe("loop/schema · sanitizeDefinition", () => {
  it("drops invalid records silently", () => {
    expect(sanitizeDefinition({ id: "x" })).toBeUndefined()
    expect(
      sanitizeDefinition({
        id: "x",
        name: "n",
        stages: [],
        trigger: { kind: "manual" },
        enabled: true,
        createdAt: 0,
      }),
    ).toBeUndefined()
    expect(sanitizeDefinition(null)).toBeUndefined()
    expect(sanitizeDefinition("not an object")).toBeUndefined()
  })
  it("returns a valid definition as-is", () => {
    const def = makeDef()
    expect(sanitizeDefinition(def)).toEqual(def)
  })
  it("drops definitions that pass parse but fail validate", () => {
    const def = { ...makeDef(), stages: [makeStage({ objective: "pause" })] }
    expect(sanitizeDefinition(def)).toBeUndefined()
  })
})

describe("loop/schema · sanitizeRun", () => {
  it("drops invalid run records", () => {
    expect(sanitizeRun({})).toBeUndefined()
    expect(sanitizeRun({ id: "r", loopID: "l" })).toBeUndefined()
  })
  it("returns a valid run", () => {
    const run = {
      id: "r",
      loopID: "l",
      startedAt: 1,
      status: "running" as const,
      ok: false,
    }
    expect(sanitizeRun(run)).toEqual(run)
  })
})

describe("loop/schema · isSandboxed", () => {
  it("sandboxes by default and only opts out on an explicit false", () => {
    expect(isSandboxed({ sandbox: undefined })).toBe(true)
    expect(isSandboxed({ sandbox: true })).toBe(true)
    expect(isSandboxed({ sandbox: false })).toBe(false)
  })
})

describe("loop/schema · definitionFromGenerated", () => {
  it("normalizes a model-authored draft into a full definition", () => {
    const def = definitionFromGenerated({
      stages: [{ objective: "  do the thing  " }, { name: "fix", agent: "ralph", objective: "fix it" }],
      intervalMs: 60_000,
      maxRuns: 5,
    })
    expect(def.stages).toHaveLength(2)
    expect(def.stages[0].name).toBe("do the thing")
    // No agent in the draft => the sandboxed default coding agent.
    expect(def.stages[0].agent).toBe(DEFAULT_LOOP_AGENT)
    expect(def.stages[1].agent).toBe("ralph")
    expect(def.stages[0].objective).toBe("do the thing")
    expect(def.stages[1].name).toBe("fix")
    expect(def.trigger).toEqual({ kind: "interval", everyMs: 60_000 })
    expect(def.maxRuns).toBe(5)
    expect(def.enabled).toBe(true)
    expect(typeof def.id).toBe("string")
    expect(def.createdAt).toBeGreaterThan(0)
  })
  it("throws on empty stages", () => {
    expect(() => definitionFromGenerated({ stages: [] })).toThrow(/no stages/)
  })
  it("ignores invalid token budgets and models", () => {
    const def = definitionFromGenerated({
      stages: [{ objective: "x", model: "noSlash", tokenBudget: -5 }],
    })
    expect(def.stages[0].model).toBeUndefined()
    expect(def.stages[0].tokenBudget).toBeUndefined()
  })
})

describe("loop/schema · definitionFromGeneratedText", () => {
  it("extracts JSON from a clean response", () => {
    const text = JSON.stringify({
      stages: [{ objective: "do it" }],
      intervalMs: 60_000,
    })
    const def = definitionFromGeneratedText(text)
    expect(def.trigger).toEqual({ kind: "interval", everyMs: 60_000 })
  })
  it("handles JSON wrapped in a markdown code fence", () => {
    const text = '```json\n{ "stages": [{ "objective": "do it" }] }\n```'
    const def = definitionFromGeneratedText(text)
    expect(def.stages[0].objective).toBe("do it")
  })
  it("handles JSON with surrounding prose", () => {
    const text = 'Here you go: {"stages":[{"objective":"do it","agent":"build"}]} — done.'
    const def = definitionFromGeneratedText(text)
    expect(def.stages[0].agent).toBe("build")
  })
  it("throws on non-JSON", () => {
    expect(() => definitionFromGeneratedText("no json here")).toThrow(/JSON/)
  })
  it("throws on empty", () => {
    expect(() => definitionFromGeneratedText("")).toThrow(/JSON pipeline/)
  })
  it("rejects nested-brace false positives when no stages key is present", () => {
    expect(() => definitionFromGeneratedText("{ foo: { bar: 1 } }")).toThrow(/JSON/)
  })
})

describe("loop/schema · LOOP_TEMPLATES", () => {
  it("every template passes validateDefinition", () => {
    for (const t of LOOP_TEMPLATES) {
      const def: LoopDefinition = {
        id: `from-${t.id}`,
        name: t.draft.name ?? t.title,
        stages: t.draft.stages.map((s) => ({
          name: s.name ?? "stage",
          agent: s.agent ?? "ralph",
          objective: s.objective,
          ...(s.model ? { model: s.model } : undefined),
          ...(s.tokenBudget ? { tokenBudget: s.tokenBudget } : undefined),
        })),
        trigger: t.draft.intervalMs ? { kind: "interval", everyMs: t.draft.intervalMs } : { kind: "manual" },
        enabled: true,
        createdAt: Date.now(),
        ...(t.draft.maxRuns ? { maxRuns: t.draft.maxRuns } : undefined),
      }
      expect(validateDefinition(def)).toBeUndefined()
    }
  })
  it("every template has a unique id", () => {
    const ids = new Set(LOOP_TEMPLATES.map((t) => t.id))
    expect(ids.size).toBe(LOOP_TEMPLATES.length)
  })
})

describe("loop/schema · isValidModel", () => {
  it("accepts provider/model and rejects others", () => {
    expect(isValidModel("openai/gpt-4o")).toBe(true)
    expect(isValidModel("a/b/c")).toBe(true)
    expect(isValidModel("nope")).toBe(false)
    expect(isValidModel("/missing")).toBe(false)
    expect(isValidModel("trailing/")).toBe(false)
  })
})
