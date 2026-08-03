import { preserveTestEnv } from "../helpers/env"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { runPromiseWithLayer, withCurrentInstance } from "@/effect"
import type { Hooks } from "@nikcli-ai/plugin"

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-plugin-effect-home-"))
process.env.NIKCLI_TEST_HOME = testHome
process.env.NIKCLI_DISABLE_PROJECT_CONFIG = "1"

preserveTestEnv(["NIKCLI_TEST_HOME", "NIKCLI_DISABLE_PROJECT_CONFIG"])

const projectDirs: string[] = []

async function withProject<T>(fn: () => Promise<T>): Promise<T> {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "nikcli-plugin-effect-project-"))
  projectDirs.push(projectDir)
  return Instance.provide({
    directory: projectDir,
    fn,
  })
}

function runPlugin<A, E>(effect: Effect.Effect<A, E, Plugin.Service>) {
  return runPromiseWithLayer(Plugin.defaultLayer, withCurrentInstance(effect))
}

afterAll(async () => {
  await Promise.all(projectDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  await fs.rm(testHome, { recursive: true, force: true })
})

describe("Plugin.Service", () => {
  it("loads built-in plugins and runs hooks through the Effect service boundary", async () => {
    await withProject(async () => {
      const result = await runPlugin(
        Effect.gen(function* () {
          const plugin = yield* Plugin.Service
          const hooks = yield* plugin.list()
          const output = { system: ["base"] }
          const transformed = yield* plugin.trigger(
            "experimental.chat.system.transform",
            { sessionID: "ses_plugin_effect" },
            output,
          )
          yield* plugin.init()
          yield* plugin.init()
          return { hooks, transformed }
        }),
      )

      expect(result.hooks.length).toBeGreaterThan(0)
      expect(result.transformed.system).toEqual(["base"])
    })
  })

  it("isolates rejected transform hooks and continues with later plugins", async () => {
    const calls: string[] = []
    const hooks: Hooks[] = [
      {
        async "experimental.chat.system.transform"() {
          calls.push("failed")
          await Promise.resolve()
          throw new Error("plugin failed")
        },
      },
      {
        async "experimental.chat.system.transform"(_input, output) {
          calls.push("continued")
          output.system.push("second plugin")
        },
      },
    ]
    const output = { system: ["base"] }

    const result = await Plugin.triggerHooks(
      hooks,
      "experimental.chat.system.transform",
      { sessionID: "ses_plugin_isolation" },
      output,
    )

    expect(result).toBe(output)
    expect(result.system).toEqual(["base", "second plugin"])
    expect(calls).toEqual(["failed", "continued"])
  })

  it("stops queued and in-flight event dispatch once plugin disposal starts", async () => {
    let disposed = false
    let release = () => {}
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const calls: string[] = []
    const handler = Plugin.createEventHookHandler(
      [
        {
          async event() {
            calls.push("started")
            await blocked
          },
        },
        {
          async event() {
            calls.push("continued")
          },
        },
      ],
      () => disposed,
    )
    const input = { event: {} } as Parameters<NonNullable<Hooks["event"]>>[0]

    const inFlight = handler(input)
    await Promise.resolve()
    disposed = true
    release()
    await inFlight
    await handler(input)

    expect(calls).toEqual(["started"])
  })

  it("unsubscribes when disposal races with event subscription", () => {
    let disposed = false
    let unsubscribed = false

    const unsubscribe = Plugin.subscribeEventHooks({
      hooks: [],
      isDisposed: () => disposed,
      subscribe: () => {
        disposed = true
        return () => {
          unsubscribed = true
        }
      },
    })

    expect(unsubscribe).toBeUndefined()
    expect(unsubscribed).toBe(true)
  })

  it("awaits rejected event hooks and continues dispatching", async () => {
    const calls: string[] = []
    const hooks: Hooks[] = [
      {
        async event() {
          calls.push("failed")
          await Promise.resolve()
          throw new Error("event failed")
        },
      },
      {
        async event() {
          calls.push("continued")
        },
      },
    ]
    const input = { event: {} } as Parameters<NonNullable<Hooks["event"]>>[0]

    await Plugin.runEventHooks(hooks, input)

    expect(calls).toEqual(["failed", "continued"])
  })
})
