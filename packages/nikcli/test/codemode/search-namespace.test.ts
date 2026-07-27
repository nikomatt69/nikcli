import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../../src/codemode/index"

// `search({ namespace })` scoped by comparing the *first* path segment, so a
// catalog nesting tools more than one level deep — `cloud.storage.upload` — was
// invisible to `search({ namespace: "cloud.storage" })` and, worse, to any
// namespace query that was not itself a top-level segment. The model's only
// remaining option was an unscoped search over the whole catalog.

const echo = (description: string) =>
  Tool.make({
    description,
    input: Schema.Struct({ value: Schema.String }),
    output: Schema.String,
    run: ({ value }) => Effect.succeed(value),
  })

const tools = {
  cloud: {
    storage: { upload: echo("Upload an object"), download: echo("Download an object") },
    compute: { start: echo("Start an instance") },
  },
  local: { open: echo("Open a local file") },
}

const value = async (code: string) => {
  const result = await Effect.runPromise(CodeMode.execute({ tools, code }))
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}

const paths = async (namespace: string) =>
  ((await value(`return search({ query: "", namespace: ${JSON.stringify(namespace)} })`)) as any).items
    .map((entry: { path: string }) => entry.path)
    .sort()

// Results carry the callable expression, not the bare catalog path.
describe("search namespace scoping", () => {
  test("finds tools nested below a top-level namespace", async () => {
    expect(await paths("cloud")).toEqual([
      "tools.cloud.compute.start",
      "tools.cloud.storage.download",
      "tools.cloud.storage.upload",
    ])
  })

  test("scopes to an intermediate namespace", async () => {
    expect(await paths("cloud.storage")).toEqual(["tools.cloud.storage.download", "tools.cloud.storage.upload"])
  })

  test("does not leak sibling namespaces", async () => {
    expect(await paths("cloud.compute")).toEqual(["tools.cloud.compute.start"])
    expect(await paths("local")).toEqual(["tools.local.open"])
  })

  test("matches a full tool path exactly", async () => {
    expect(await paths("cloud.storage.upload")).toEqual(["tools.cloud.storage.upload"])
  })

  test("does not prefix-match a partial segment", async () => {
    // "clou" must not scope to "cloud.*" — the boundary is the dot.
    expect(await paths("clou")).toEqual([])
  })
})
