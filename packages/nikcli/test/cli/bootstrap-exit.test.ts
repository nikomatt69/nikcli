import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { bootstrap } from "@/cli/bootstrap"

/**
 * A bootstrap command's exit code has to mean what it says (R3).
 *
 * `withInstanceAsync` runs the body as a fiber on the instance's own `ManagedRuntime`, and
 * `Instance.dispose` tears that runtime down. While `bootstrap` disposed from *inside* the body, the
 * body interrupted itself at the last moment: the fiber's Exit became an interruption, the bridge
 * replayed it faithfully in the caller, and `runPromise` squashed an interrupt-only `Cause` into
 * `Error("All fibers interrupted without error")`. Every bootstrap-based command — `stats`, `api`,
 * and the rest — printed its correct answer and then exited 1.
 *
 * These assertions are about the shape of the outcome, not the message: a successful body must
 * resolve, and a failing body must still reject with *its own* error rather than a teardown artifact.
 */
async function projectDir() {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(require("node:os").tmpdir()), "nikcli-bootstrap-exit-"))
  return fs.realpath(dir)
}

describe("bootstrap teardown", () => {
  it("resolves the body's value instead of failing on its own teardown", async () => {
    const directory = await projectDir()
    await expect(bootstrap(directory, async () => "done")).resolves.toBe("done")
  })

  it("survives a body that touched the instance, which is when the runtime has fibers to interrupt", async () => {
    const directory = await projectDir()
    const result = await bootstrap(directory, async (instance) => instance.directory)
    expect(result).toBe(directory)
  })

  // The other half: teardown must not swallow a real failure into a success either.
  it("still rejects with the body's own error", async () => {
    const directory = await projectDir()
    await expect(bootstrap(directory, async () => Promise.reject(new Error("body exploded")))).rejects.toThrow(
      "body exploded",
    )
  })

  it("never surfaces an interruption as the failure", async () => {
    const directory = await projectDir()
    let message = ""
    try {
      await bootstrap(directory, async () => {
        throw new Error("body exploded")
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe("body exploded")
    expect(message).not.toContain("All fibers interrupted")
  })

  it("can be called twice in a row, so disposal leaves nothing broken behind", async () => {
    const directory = await projectDir()
    await expect(bootstrap(directory, async () => 1)).resolves.toBe(1)
    await expect(bootstrap(directory, async () => 2)).resolves.toBe(2)
  })
})
