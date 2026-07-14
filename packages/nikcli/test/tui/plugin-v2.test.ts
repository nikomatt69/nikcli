import { describe, expect, it } from "bun:test"
import { Plugin } from "@nikcli-ai/plugin/v2/tui"
import type { Context } from "@nikcli-ai/plugin/v2/tui/context"
import type { TuiDispose, TuiPluginApi, TuiRouteCurrent, TuiRouteDefinition } from "@nikcli-ai/plugin/tui"
import { readV2TuiPlugin } from "@/cli/cmd/tui/plugin/v2"

function host() {
  const routes: TuiRouteDefinition[] = []
  const slots: Array<Parameters<TuiPluginApi["slots"]["registerDisposable"]>[0]> = []
  const cleanups: TuiDispose[] = []
  let current: TuiRouteCurrent = { name: "home" }
  let routeDisposals = 0
  let slotDisposals = 0

  const api = {
    client: { marker: "client" },
    data: { marker: "data" },
    state: {
      ready: true,
      config: {},
      provider: [],
      path: { state: "", config: "", worktree: "", directory: "" },
      vcs: undefined,
      workspace: { list: () => [], get: () => undefined },
      session: {
        count: () => 0,
        diff: () => [],
        todo: () => [],
        messages: () => [],
        status: () => undefined,
        permission: () => [],
        question: () => [],
      },
      part: () => [],
      lsp: () => [],
      mcp: () => [],
    },
    event: {
      on: () => () => {},
      listen: () => () => {},
    },
    route: {
      register(input: TuiRouteDefinition[]) {
        routes.push(...input)
        return () => {
          routeDisposals++
        }
      },
      navigate(name: string, params?: Record<string, unknown>) {
        current = { name, params }
      },
      get current() {
        return current
      },
    },
    slots: {
      register() {
        return "unused"
      },
      registerDisposable(plugin: Parameters<TuiPluginApi["slots"]["registerDisposable"]>[0]) {
        slots.push(plugin)
        return () => {
          slotDisposals++
        }
      },
    },
    lifecycle: {
      signal: new AbortController().signal,
      onDispose(cleanup: TuiDispose) {
        cleanups.push(cleanup)
        return () => {}
      },
    },
  } as unknown as TuiPluginApi

  return {
    api,
    routes,
    slots,
    cleanups,
    current: () => current,
    routeDisposals: () => routeDisposals,
    slotDisposals: () => slotDisposals,
  }
}

describe("v2 tui plugin compatibility", () => {
  it("loads Plugin.define modules and owns routes, slots, navigation, and cleanup", async () => {
    const runtime = host()
    let context: Context | undefined
    let cleaned = 0
    let routeOff: (() => void) | undefined
    let slotOff: (() => void) | undefined
    const definition = Plugin.define({
      id: "example.plugin",
      setup(input) {
        context = input
        routeOff = input.ui.router.register({
          name: "settings",
          render: ({ data }) => `tab:${String(data?.tab)}`,
        })
        slotOff = input.ui.slot("home.bottom", (props) => `slot:${String(props.label)}`)
        return () => {
          cleaned++
        }
      },
    })

    const module = readV2TuiPlugin({ default: definition }, "file:///example.ts")
    expect(module?.id).toBe("example.plugin")
    await module!.tui(runtime.api, { enabled: true }, {} as never)

    expect(context?.options).toEqual({ enabled: true })
    expect(context?.data).toBe(runtime.api.data)
    expect(runtime.routes).toHaveLength(1)
    expect(runtime.slots).toHaveLength(1)

    context!.ui.router.navigate({ type: "plugin", name: "settings", data: { tab: "general" } })
    expect(runtime.current().name).toBe(runtime.routes[0]!.name)
    expect(context!.ui.router.current()).toEqual({
      type: "plugin",
      id: "example.plugin",
      name: "settings",
      data: { tab: "general" },
    })
    expect(runtime.routes[0]!.render({ params: { tab: "advanced" } })).toBe("tab:advanced")

    const render = Object.values(runtime.slots[0]!.slots)[0]!
    expect(render({} as never, { label: "ready" } as never)).toBe("slot:ready")

    routeOff!()
    slotOff!()
    expect(runtime.routeDisposals()).toBe(1)
    expect(runtime.slotDisposals()).toBe(1)

    await runtime.cleanups[0]!()
    expect(cleaned).toBe(1)
  })

  it("rejects malformed v2 definitions", () => {
    expect(() => readV2TuiPlugin({ default: { id: "", setup() {} } }, "broken")).toThrow("non-empty id")
    expect(() => readV2TuiPlugin({ default: { id: "broken", setup: true } }, "broken")).toThrow("invalid setup export")
  })
})
