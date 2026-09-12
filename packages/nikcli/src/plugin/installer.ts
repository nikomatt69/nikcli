import { BunProc } from "@/bun"
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
  configurePluginInstaller((pkg, version) => BunProc.install(pkg, version))
}
