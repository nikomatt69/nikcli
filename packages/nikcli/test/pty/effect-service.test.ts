import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import fs from "fs/promises"
import os from "os"
import path from "path"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-pty-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"
process.env.XDG_DATA_HOME = path.join(testHome, "data")
process.env.XDG_CACHE_HOME = path.join(testHome, "cache")
process.env.XDG_CONFIG_HOME = path.join(testHome, "config")
process.env.XDG_STATE_HOME = path.join(testHome, "state")

const { InstanceScope } = await import("@/effect")
const { Instance } = await import("@/project/instance")
const { Pty } = await import("@/pty")
const { PtyEnvironment } = await import("@/pty/environment")

const projectDirs: string[] = []

async function makeProjectDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-pty-effect-project-"))
  const resolved = await fs.realpath(dir)
  projectDirs.push(resolved)
  return resolved
}

describe("Pty.Service", () => {
  it("keeps PTY session state in an InstanceState-backed service", async () => {
    const directory = await makeProjectDir()
    const result = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          const empty = yield* pty.list()
          const created = yield* pty.create({
            command: "/bin/sleep",
            args: ["2"],
            title: "Effect PTY",
          })
          const found = yield* pty.get(created.id)
          const updated = yield* pty.update(created.id, { title: "Updated PTY" })
          yield* pty.remove(created.id)
          const afterRemove = yield* pty.get(created.id)

          return { empty, created, found, updated, afterRemove }
        }).pipe(Effect.provide(Pty.defaultLayer)),
      ),
    )

    expect(result.empty).toEqual([])
    expect(result.created.cwd).toBe(directory)
    expect(result.found?.id).toBe(result.created.id)
    expect(result.updated?.title).toBe("Updated PTY")
    expect(result.afterRemove).toBeUndefined()
  })

  it("applies the plugin environment overlay before forced PTY values", async () => {
    const directory = await makeProjectDir()
    // Overlay overrides the caller's SHARED/TERM and adds PLUGIN; the forced
    // TERM invariant must still win over the overlay.
    const overlayLayer = Layer.succeed(
      PtyEnvironment.Service,
      PtyEnvironment.Service.of({
        get: () => Effect.succeed({ SHARED: "plugin", PLUGIN: "plugin", TERM: "plugin" }),
      }),
    )
    const testLayer = Pty.layer.pipe(Layer.provide(overlayLayer))

    const collected: string[] = []
    // Minimal WSContext stub: subscribers are kept while readyState === 1 and
    // streamed PTY output arrives via send().
    const fakeWs = {
      readyState: 1,
      send: (data: string) => collected.push(data),
      close: () => {},
    }

    const output = await Effect.runPromise(
      InstanceScope.with(
        { directory },
        Effect.gen(function* () {
          const pty = yield* Pty.Service
          const created = yield* pty.create({
            command: "/bin/sh",
            args: ["-c", 'printf "%s|%s|%s\\n" "$SHARED" "$PLUGIN" "$TERM"; sleep 1'],
            env: { SHARED: "caller", TERM: "caller" },
          })
          // Subscribe before the command finishes so its output streams live.
          yield* pty.connect(created.id, fakeWs as never)
          yield* Effect.sleep("500 millis")
          yield* pty.remove(created.id)
          return collected.join("")
        }).pipe(Effect.provide(testLayer)),
      ),
    )

    expect(output).toContain("plugin|plugin|xterm-256color")
  })
})

afterEach(async () => {
  await Instance.disposeAll().catch(() => undefined)
})

afterAll(async () => {
  await Instance.disposeAll().catch(() => undefined)
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})
