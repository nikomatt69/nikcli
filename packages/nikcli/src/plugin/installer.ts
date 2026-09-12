import { configurePluginInstaller } from "@nikcli-ai/util/plugin-shared"

/**
 * Teach the shared plugin helpers how to install a package.
 *
 * `@nikcli-ai/util/plugin-shared` is path and manifest work that both the
 * terminal and the server do; the one thing it cannot do is shell out to
 * `bun install`. Every backend entry point calls this once, explicitly, rather
 * than relying on some module further down the import graph having been loaded
 * first — which is what a re-export module did, and what made the ordering a
 * matter of luck.
 */
export function installPluginInstaller(): void {
  // `@/bun` is imported inside the callback, not at module scope: this runs on
  // every CLI invocation, while the callback only runs when a plugin actually
  // has to be installed. Statically it cost ~16MB of RSS on every `nikcli
  // --version` to register a function nearly no run ever calls (BunProc pulls
  // in effect's Schema). Configuration still happens eagerly, so the ordering
  // guarantee this function exists for is unchanged.
  configurePluginInstaller(async (pkg, version) => {
    const { BunProc } = await import("@/bun")
    return BunProc.install(pkg, version)
  })
}
