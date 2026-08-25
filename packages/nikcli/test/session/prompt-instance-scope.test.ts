import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * `session/prompt.ts` does not thread an `InstanceContext` through its ~40
 * internal signatures. It does not have to, but only because of one premise:
 * every `Service` method that can reach a context-dependent helper first goes
 * through `withInstanceContext`, which resolves the context and re-enters
 * `Instance.provide` with it. The ambient scope those helpers read is then the
 * context the module itself installed, not the caller's.
 *
 * That premise is invisible at the call site and easy to break by adding one
 * service method, so it is checked here rather than trusted. If this fails,
 * either wrap the new method or thread the context into it — do not widen the
 * exemption list without a reason that is true.
 */
const source = readFileSync(join(import.meta.dir, "..", "..", "src", "session", "prompt.ts"), "utf8")

/**
 * Methods that legitimately never reach a helper. Each needs a reason, and the
 * reason has to be checkable by reading the method.
 */
const EXEMPT: Record<string, string> = {
  assertNotBusy: "reads PromptState only; touches no service that needs an instance",
  cancel: "delegates straight to PromptState.cancel",
  resolvePromptParts: "resolves InstanceState.context itself and passes it on explicitly",
}

function serviceMethods() {
  // The `Service.of({ ... })` object literal in the exported layer.
  const start = source.indexOf("Service.of({")
  expect(start).toBeGreaterThan(-1)
  const body = source.slice(start)
  const methods: Record<string, string> = {}
  // Top-level keys of that literal are indented six spaces in this file.
  const re = /\n {6}(\w+): (\(|Effect|InstanceState)/g
  const starts: Array<{ name: string; at: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) starts.push({ name: m[1]!, at: m.index })
  expect(starts.length).toBeGreaterThan(4)
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!.at
    const to = i + 1 < starts.length ? starts[i + 1]!.at : body.indexOf("\n    }),\n", from)
    methods[starts[i]!.name] = body.slice(from, to)
  }
  return methods
}

describe("SessionPrompt service methods install the instance scope", () => {
  const methods = serviceMethods()

  it("finds the service methods it claims to check", () => {
    expect(Object.keys(methods)).toContain("prompt")
    expect(Object.keys(methods)).toContain("loop")
    expect(Object.keys(methods)).toContain("command")
  })

  for (const [name, body] of Object.entries(methods)) {
    it(`${name} installs the scope or is exempt for a stated reason`, () => {
      if (EXEMPT[name]) {
        expect(EXEMPT[name], `${name} is exempt but the reason is empty`).toBeTruthy()
        return
      }
      expect(
        body.includes("withInstanceContext(") || body.includes("InstanceState.context"),
        `${name} reaches the module's helpers without installing the instance scope; ` +
          "wrap it in withInstanceContext or thread the context explicitly",
      ).toBe(true)
    })
  }

  it("the helpers read that installed scope rather than converting ALS themselves", () => {
    // The point of the above: no helper re-derives the context on its own.
    expect(source).not.toContain("withCurrentInstance")
    expect(source).toContain("locallyInstance(currentContext(), effect)")
  })
})
