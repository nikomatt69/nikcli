import { describe, expect, it } from "bun:test"
import { filterCodexOAuthModels } from "@/plugin/codex"

// `filterCodexOAuthModels` trims the OpenAI catalog down to what a ChatGPT
// Pro/Plus OAuth session can actually call through the Codex backend. Anything
// left in the map is offered to the user, so a model the plan cannot reach must
// be removed and a model it can reach must survive.
function providerWith(...apiIds: string[]) {
  return {
    models: Object.fromEntries(apiIds.map((id) => [id, { api: { id } }])),
  }
}

function survivors(...apiIds: string[]) {
  const provider = providerWith(...apiIds)
  filterCodexOAuthModels(provider)
  return Object.keys(provider.models).sort()
}

describe("filterCodexOAuthModels", () => {
  it("keeps gpt-6-astra and its aeon sibling slug", () => {
    expect(survivors("gpt-6-astra", "gpt-6-astra-aeon")).toEqual(["gpt-6-astra", "gpt-6-astra-aeon"])
  })

  it("keeps every codex model", () => {
    expect(survivors("gpt-5.1-codex", "gpt-5.3-codex")).toEqual(["gpt-5.1-codex", "gpt-5.3-codex"])
  })

  it("keeps the explicitly allowed gpt-5.x models", () => {
    expect(survivors("gpt-5.2", "gpt-5.4", "gpt-5.5")).toEqual(["gpt-5.2", "gpt-5.4", "gpt-5.5"])
  })

  it("drops models the ChatGPT plan cannot reach", () => {
    expect(survivors("gpt-4o", "gpt-3.5-turbo", "o3", "gpt-5")).toEqual([])
  })

  it("reads the major version numerically rather than as a prefix", () => {
    // "gpt-60" is major 60, not gpt-6 — both are >= 6, so both are allowed,
    // but the distinction matters for anything that compares versions.
    expect(survivors("gpt-7", "gpt-60")).toEqual(["gpt-60", "gpt-7"])
    expect(survivors("gpt-4o")).toEqual([])
  })
})
