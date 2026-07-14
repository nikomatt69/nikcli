import { createRequire } from "node:module"

/**
 * @napi-rs/canvas is a CJS N-API package. Inside the booted TUI, OpenTUI's
 * runtime Bun plugin (installed by TuiPluginRuntime via
 * `@opentui/solid/runtime-plugin-support`) registers a catch-all async
 * onLoad for every .js/.ts file: after it installs, an ESM import of the
 * package yields an empty namespace and a require() fails with
 * "require() async module is unsupported".
 *
 * The binding is therefore resolved once — before that plugin installs —
 * and cached on globalThis under a Symbol.for key, so it survives even when
 * the plugin's specifier rewriting re-evaluates the frontend modules under
 * new keys. Drive mode calls `preload()` from `cmd/tui/thread.ts` before
 * `./app` (and with it the plugin runtime) is imported.
 *
 * This module must stay dependency-free: it is imported pre-plugin and must
 * not pull a parallel copy of @opentui/core (or anything else the rewritten
 * app graph also loads) into the module cache.
 */
const CanvasBindingKey = Symbol.for("nikcli.simulation.canvas")

type CanvasModule = typeof import("@napi-rs/canvas")
const cache = globalThis as { [CanvasBindingKey]?: CanvasModule }

export function preload(): void {
  cache[CanvasBindingKey] ??= createRequire(import.meta.url)("@napi-rs/canvas") as CanvasModule
}

export function binding(): CanvasModule {
  preload()
  return cache[CanvasBindingKey]!
}
